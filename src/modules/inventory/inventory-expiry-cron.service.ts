import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import {
  UserInventoryItem,
  UserInventoryItemDocument,
  FreshnessStatus,
} from '../../database/schemas/user-inventory.schema';
import { NotificationService } from '../notification/notification.service';

@Injectable()
export class InventoryExpiryCronService {
  private readonly logger = new Logger(InventoryExpiryCronService.name);

  constructor(
    @InjectModel(UserInventoryItem.name)
    private inventoryModel: Model<UserInventoryItemDocument>,
    private readonly notificationService: NotificationService,
  ) {}

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

  @Cron('0 30 2 * * *', { name: 'inventory-expiry-check', timeZone: 'Asia/Kolkata' })
  async handleExpiryCron() {
    this.logger.log('Running daily inventory expiry check...');

    const now = new Date();
    const oneDayFromNow = new Date();
    oneDayFromNow.setDate(now.getDate() + 1);
    const threeDaysFromNow = new Date();
    threeDaysFromNow.setDate(now.getDate() + 3);

    try {
      const expiredResult = await this.inventoryModel.updateMany(
        {
          isDiscarded: false,
          expiresAt: { $lt: now },
          freshnessStatus: { $ne: FreshnessStatus.EXPIRED },
        },
        { $set: { freshnessStatus: FreshnessStatus.EXPIRED } },
      );
      this.logger.log(
        `Marked ${expiredResult.modifiedCount} items as EXPIRED`,
      );

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
      this.logger.log(
        `Marked ${freshResult.modifiedCount} items as FRESH`,
      );

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

      for (const userId of notifiedUserIds) {
        const expiring = expiringByUser.get(userId);
        const expiringCount = expiring?.count ?? 0;
        const expiredCount = expiredByUser.get(userId) ?? 0;

        if (expiringCount === 0 && expiredCount === 0) {
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
        } catch (err: any) {
          this.logger.warn(
            `Failed to send inventory reminder to user ${userId}: ${err?.message}`,
          );
        }
      }

      this.logger.log('Daily inventory expiry check completed successfully.');
    } catch (error) {
      this.logger.error(
        `Expiry cron failed: ${error.message}`,
        error.stack,
      );
    }
  }

  @Cron('0 30 3 * * 1', { name: 'weekly-waste-summary', timeZone: 'Asia/Kolkata' })
  async handleWeeklyWasteSummary() {
    this.logger.log('Running weekly waste summary...');

    const oneWeekAgo = new Date();
    oneWeekAgo.setDate(oneWeekAgo.getDate() - 7);

    try {
      const weeklyWaste = await this.inventoryModel.aggregate([
        {
          $match: {
            isDiscarded: true,
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
