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

      const usersWithExpiring = await this.inventoryModel.aggregate([
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
      ]);

      for (const userGroup of usersWithExpiring) {
        const userId = userGroup._id.toString();
        const count = userGroup.count;
        const firstItem = userGroup.expiringItems[0];

        try {
          const itemName = firstItem?.name ?? 'items';
          const body =
            count === 1
              ? `Your ${itemName} is expiring soon! Use it before it goes to waste.`
              : `${count} items are expiring soon — ${itemName} and ${count - 1} more. Cook something delicious!`;

          await this.notificationService.sendToUser(
            userId,
            '⏰ Items Expiring Soon',
            body,
            { type: 'expiry_warning', count: String(count) },
            'inventory',
          );
        } catch (err) {
          this.logger.warn(
            `Failed to send expiry notification to user ${userId}: ${err.message}`,
          );
        }
      }

      const usersWithExpired = await this.inventoryModel.aggregate([
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
      ]);

      for (const userGroup of usersWithExpired) {
        const userId = userGroup._id.toString();
        const count = userGroup.count;

        try {
          const body =
            count === 1
              ? `1 item in your pantry has expired. Discard it or check if it's still usable.`
              : `${count} items in your pantry have expired. Time to clean up!`;

          await this.notificationService.sendToUser(
            userId,
            '🚨 Expired Items',
            body,
            { type: 'expired_items', count: String(count) },
            'inventory',
          );
        } catch (err) {
          this.logger.warn(
            `Failed to send expired notification to user ${userId}: ${err.message}`,
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
