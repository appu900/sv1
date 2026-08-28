import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { randomUUID } from 'crypto';
import {
  UserInventoryItem,
  UserInventoryItemDocument,
  DiscardReason,
  FreshnessStatus,
  WasteType,
} from '../../database/schemas/user-inventory.schema';
import { NotificationService } from '../notification/notification.service';
import { RedisService } from '../../redis/redis.service';

const CRON_TIME_ZONE = 'Asia/Kolkata';
const DAY_MS = 24 * 60 * 60 * 1000;

/** Items still sitting in the pantry this long after expiry are cleared automatically. */
const EXPIRED_ITEM_RETENTION_DAYS = 30;

/** How far ahead "expiring soon" reaches. */
const EXPIRING_SOON_DAYS = 3;

/** Long enough to outlive a slow run, short enough to self-heal before the next one. */
const CRON_LOCK_TTL_SECONDS = 30 * 60;

/**
 * Guards one reminder per user per calendar day. Outlives the run that set it but
 * expires well before the same job comes round again.
 */
const REMINDER_GUARD_TTL_SECONDS = 20 * 60 * 60;

@Injectable()
export class InventoryExpiryCronService {
  private readonly logger = new Logger(InventoryExpiryCronService.name);

  constructor(
    @InjectModel(UserInventoryItem.name)
    private inventoryModel: Model<UserInventoryItemDocument>,
    private readonly notificationService: NotificationService,
    private readonly redis: RedisService,
  ) {}

  /**
   * The app runs on more than one instance, and `@Cron` fires on every one of them.
   * Without this lock each nightly job sends the same push once per instance — which
   * is what users saw as the same "Expired Items" banner repeated several times.
   */
  private async withLock(
    key: string,
    ttlSeconds: number,
    fn: () => Promise<void>,
  ): Promise<void> {
    const lockKey = `lock:inventory-cron:${key}`;
    const token = randomUUID();

    let acquired: boolean;
    try {
      acquired = await this.redis.setIfAbsent(lockKey, token, ttlSeconds);
    } catch (error: any) {
      // Redis also backs the BullMQ queue these notifications ship through, so if it
      // is unreachable the run could not deliver anything anyway. Skipping beats
      // running unguarded on every instance.
      this.logger.error(
        `Skipping ${key} — could not acquire lock: ${error?.message}`,
      );
      return;
    }

    if (!acquired) {
      this.logger.log(`Skipping ${key} — another instance holds the lock`);
      return;
    }

    try {
      await fn();
    } finally {
      try {
        await this.redis.releaseLock(lockKey, token);
      } catch (error: any) {
        this.logger.warn(
          `Could not release ${key} lock (it expires in ${ttlSeconds}s): ${error?.message}`,
        );
      }
    }
  }

  /**
   * Calendar day in the cron's own timezone. A UTC date would roll over mid-run
   * (02:30 IST is 21:00 UTC the previous day) and let a retry send twice.
   */
  private dayKey(date: Date): string {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: CRON_TIME_ZONE,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(date);
  }

  /**
   * Claims the single reminder slot for this user today. Returns the token to
   * release with if the send fails, or null if someone already sent today.
   */
  private async claimReminderSlot(
    kind: string,
    userId: string,
    dayKey: string,
  ): Promise<{ key: string; token: string } | null> {
    const key = `notif:${kind}:${userId}:${dayKey}`;
    const token = randomUUID();

    const claimed = await this.redis.setIfAbsent(
      key,
      token,
      REMINDER_GUARD_TTL_SECONDS,
    );

    return claimed ? { key, token } : null;
  }

  private buildDailyInventoryReminder(params: {
    expiredCount: number;
    expiringCount: number;
    firstExpiringItemName?: string;
  }): {
    title: string;
    body: string;
    data: Record<string, string>;
  } {
    const { expiredCount, expiringCount, firstExpiringItemName } = params;
    const itemName = firstExpiringItemName?.trim() || 'items';

    if (expiredCount > 0 && expiringCount > 0) {
      const expiredPart =
        expiredCount === 1
          ? '1 item in your pantry has expired'
          : `${expiredCount} items in your pantry have expired`;
      const expiringPart =
        expiringCount === 1
          ? `${itemName} is expiring soon`
          : `${expiringCount} more items are expiring soon, including ${itemName}`;

      return {
        title: '🍽️ Pantry Update',
        body: `${expiredPart}, and ${expiringPart}. Check your kitchen and use what you can first.`,
        data: {
          type: 'inventory_expiry_summary',
          expiredCount: String(expiredCount),
          expiringCount: String(expiringCount),
        },
      };
    }

    if (expiringCount > 0) {
      return {
        title: '⏰ Items Expiring Soon',
        body:
          expiringCount === 1
            ? `Your ${itemName} is expiring soon! Use it before it goes to waste.`
            : `${expiringCount} items are expiring soon — ${itemName} and ${expiringCount - 1} more. Cook something delicious!`,
        data: {
          type: 'expiry_warning',
          count: String(expiringCount),
          expiredCount: String(expiredCount),
          expiringCount: String(expiringCount),
        },
      };
    }

    return {
      title: '🚨 Expired Items',
      body:
        expiredCount === 1
          ? `1 item in your pantry has expired. Discard it or check if it's still usable.`
          : `${expiredCount} items in your pantry have expired. Time to clean up!`,
      data: {
        type: 'expired_items',
        count: String(expiredCount),
        expiredCount: String(expiredCount),
        expiringCount: String(expiringCount),
      },
    };
  }

  /**
   * Clears items nobody acted on within {@link EXPIRED_ITEM_RETENTION_DAYS} of their
   * expiry date, so a forgotten item stops padding the nightly "expired" count forever.
   *
   * They are discarded rather than deleted — an item that sat a month past its date
   * really was wasted, and waste analytics should still see it. `autoDiscarded` keeps
   * them separable from the ones the user discarded by hand.
   */
  private async clearLongExpiredItems(now: Date): Promise<number> {
    const cutoff = new Date(now.getTime() - EXPIRED_ITEM_RETENTION_DAYS * DAY_MS);

    const result = await this.inventoryModel.updateMany(
      {
        isDiscarded: false,
        expiresAt: { $type: 'date', $lt: cutoff },
      },
      [
        {
          $set: {
            isDiscarded: true,
            autoDiscarded: true,
            freshnessStatus: FreshnessStatus.EXPIRED,
            discardReason: DiscardReason.EXPIRED,
            wasteType: WasteType.WET,
            discardedAt: now,
            discardedQuantity: '$quantity',
            discardNotes: `Automatically cleared ${EXPIRED_ITEM_RETENTION_DAYS} days after expiry`,
          },
        },
      ],
    );

    return result.modifiedCount;
  }

  @Cron('0 30 2 * * *', {
    name: 'inventory-expiry-check',
    timeZone: CRON_TIME_ZONE,
  })
  async handleExpiryCron() {
    await this.withLock('expiry-check', CRON_LOCK_TTL_SECONDS, () =>
      this.runExpiryCheck(),
    );
  }

  private async runExpiryCheck(): Promise<void> {
    this.logger.log('Running daily inventory expiry check...');

    const now = new Date();
    const dayKey = this.dayKey(now);
    const threeDaysFromNow = new Date(now.getTime() + EXPIRING_SOON_DAYS * DAY_MS);

    try {
      // Runs before the counts below so cleared items do not show up in tonight's
      // reminder as still-expired.
      const clearedCount = await this.clearLongExpiredItems(now);
      this.logger.log(
        `Auto-cleared ${clearedCount} items expired more than ${EXPIRED_ITEM_RETENTION_DAYS} days ago`,
      );

      const expiredResult = await this.inventoryModel.updateMany(
        {
          isDiscarded: false,
          expiresAt: { $lt: now },
          freshnessStatus: { $ne: FreshnessStatus.EXPIRED },
        },
        { $set: { freshnessStatus: FreshnessStatus.EXPIRED } },
      );
      this.logger.log(`Marked ${expiredResult.modifiedCount} items as EXPIRED`);

      const expiringSoonResult = await this.inventoryModel.updateMany(
        {
          isDiscarded: false,
          expiresAt: { $gte: now, $lte: threeDaysFromNow },
          freshnessStatus: { $ne: FreshnessStatus.EXPIRING_SOON },
        },
        { $set: { freshnessStatus: FreshnessStatus.EXPIRING_SOON } },
      );
      this.logger.log(
        `Marked ${expiringSoonResult.modifiedCount} items as EXPIRING_SOON`,
      );

      const freshResult = await this.inventoryModel.updateMany(
        {
          isDiscarded: false,
          expiresAt: { $gt: threeDaysFromNow },
          freshnessStatus: { $ne: FreshnessStatus.FRESH },
        },
        { $set: { freshnessStatus: FreshnessStatus.FRESH } },
      );
      this.logger.log(`Marked ${freshResult.modifiedCount} items as FRESH`);

      const [usersWithExpiring, usersWithExpired] = await Promise.all([
        this.inventoryModel.aggregate([
          {
            $match: {
              isDiscarded: false,
              expiresAt: { $gte: now, $lte: threeDaysFromNow },
            },
          },
          {
            $group: {
              _id: '$userId',
              expiringItems: {
                $push: {
                  name: '$name',
                  expiresAt: '$expiresAt',
                  quantity: '$quantity',
                  unit: '$unit',
                },
              },
              count: { $sum: 1 },
            },
          },
        ]),
        this.inventoryModel.aggregate([
          {
            $match: {
              isDiscarded: false,
              expiresAt: { $lt: now },
              freshnessStatus: FreshnessStatus.EXPIRED,
            },
          },
          {
            $group: {
              _id: '$userId',
              count: { $sum: 1 },
            },
          },
        ]),
      ]);

      const expiringByUser = new Map<
        string,
        { count: number; firstExpiringItemName?: string }
      >();
      for (const userGroup of usersWithExpiring) {
        expiringByUser.set(userGroup._id.toString(), {
          count: userGroup.count,
          firstExpiringItemName: userGroup.expiringItems?.[0]?.name,
        });
      }

      const expiredByUser = new Map<string, number>();
      for (const userGroup of usersWithExpired) {
        expiredByUser.set(userGroup._id.toString(), userGroup.count);
      }

      const notifiedUserIds = new Set<string>([
        ...expiringByUser.keys(),
        ...expiredByUser.keys(),
      ]);

      let sent = 0;
      let alreadySent = 0;

      for (const userId of notifiedUserIds) {
        const expiring = expiringByUser.get(userId);
        const expiringCount = expiring?.count ?? 0;
        const expiredCount = expiredByUser.get(userId) ?? 0;

        if (expiringCount === 0 && expiredCount === 0) {
          continue;
        }

        // Second line of defence behind the cron lock: even a manual re-trigger or a
        // job retry cannot put a second copy of today's reminder on the device.
        const slot = await this.claimReminderSlot(
          'inventory-expiry',
          userId,
          dayKey,
        );
        if (!slot) {
          alreadySent++;
          continue;
        }

        try {
          const reminder = this.buildDailyInventoryReminder({
            expiredCount,
            expiringCount,
            firstExpiringItemName: expiring?.firstExpiringItemName,
          });

          await this.notificationService.sendToUser(
            userId,
            reminder.title,
            reminder.body,
            reminder.data,
            'inventory',
          );
          sent++;
        } catch (err: any) {
          // Hand the slot back so a later run can still reach this user today.
          await this.redis.releaseLock(slot.key, slot.token).catch(() => {});
          this.logger.warn(
            `Failed to send inventory reminder to user ${userId}: ${err?.message}`,
          );
        }
      }

      this.logger.log(
        `Daily inventory expiry check completed — ${sent} reminders sent, ${alreadySent} skipped as already sent today.`,
      );
    } catch (error) {
      this.logger.error(`Expiry cron failed: ${error.message}`, error.stack);
    }
  }

  @Cron('0 30 3 * * 1', {
    name: 'weekly-waste-summary',
    timeZone: CRON_TIME_ZONE,
  })
  async handleWeeklyWasteSummary() {
    await this.withLock('weekly-waste-summary', CRON_LOCK_TTL_SECONDS, () =>
      this.runWeeklyWasteSummary(),
    );
  }

  private async runWeeklyWasteSummary(): Promise<void> {
    this.logger.log('Running weekly waste summary...');

    const now = new Date();
    const dayKey = this.dayKey(now);
    const oneWeekAgo = new Date(now.getTime() - 7 * DAY_MS);

    try {
      const weeklyWaste = await this.inventoryModel.aggregate([
        {
          $match: {
            isDiscarded: true,
            // Auto-cleared items are not something the user did this week, and
            // counting them would spike the summary the first time cleanup runs.
            autoDiscarded: { $ne: true },
            discardedAt: { $gte: oneWeekAgo },
          },
        },
        {
          $group: {
            _id: '$userId',
            totalDiscarded: { $sum: 1 },
            totalQuantity: { $sum: '$discardedQuantity' },
            wasteTypes: { $push: '$wasteType' },
          },
        },
      ]);

      for (const userWaste of weeklyWaste) {
        const userId = userWaste._id.toString();
        const total = userWaste.totalDiscarded;

        const slot = await this.claimReminderSlot(
          'weekly-waste',
          userId,
          dayKey,
        );
        if (!slot) {
          continue;
        }

        try {
          const body =
            total === 1
              ? `You discarded 1 item this week. Keep tracking to reduce waste!`
              : `You discarded ${total} items this week. Let's try to waste less next week! 💪`;

          await this.notificationService.sendToUser(
            userId,
            '📊 Your Weekly Waste Summary',
            body,
            { type: 'weekly_waste_summary', count: String(total) },
            'track',
          );
        } catch (err) {
          await this.redis.releaseLock(slot.key, slot.token).catch(() => {});
          this.logger.warn(
            `Failed to send weekly summary to user ${userId}: ${err.message}`,
          );
        }
      }

      this.logger.log('Weekly waste summary completed.');
    } catch (error) {
      this.logger.error(
        `Weekly waste summary failed: ${error.message}`,
        error.stack,
      );
    }
  }
}
