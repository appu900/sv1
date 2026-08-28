import { Types } from 'mongoose';
import { FreshnessStatus } from '../../database/schemas/user-inventory.schema';
import { InventoryExpiryCronService } from './inventory-expiry-cron.service';

const userId = new Types.ObjectId().toString();

function buildService(overrides: {
  expiring?: any[];
  expired?: any[];
  lockHeld?: boolean;
} = {}) {
  const inventoryModel = {
    updateMany: jest.fn().mockResolvedValue({ modifiedCount: 0 }),
    aggregate: jest
      .fn()
      // usersWithExpiring, then usersWithExpired — the order they are awaited in.
      .mockResolvedValueOnce(overrides.expiring ?? [])
      .mockResolvedValueOnce(overrides.expired ?? []),
  };

  const notificationService = {
    sendToUser: jest.fn().mockResolvedValue({ notificationId: 'n1' }),
  };

  // A real Redis SET NX: the first caller for a key wins, everyone after is refused.
  const claimed = new Set<string>();
  const redis = {
    setIfAbsent: jest.fn(async (key: string) => {
      if (overrides.lockHeld && key.startsWith('lock:')) return false;
      if (claimed.has(key)) return false;
      claimed.add(key);
      return true;
    }),
    releaseLock: jest.fn(async (key: string) => claimed.delete(key)),
  };

  const service = new InventoryExpiryCronService(
    inventoryModel as any,
    notificationService as any,
    redis as any,
  );

  return { service, inventoryModel, notificationService, redis, claimed };
}

describe('InventoryExpiryCronService', () => {
  describe('handleExpiryCron', () => {
    it('sends one reminder per user', async () => {
      const { service, notificationService } = buildService({
        expired: [{ _id: new Types.ObjectId(userId), count: 23 }],
      });

      await service.handleExpiryCron();

      expect(notificationService.sendToUser).toHaveBeenCalledTimes(1);
      expect(notificationService.sendToUser).toHaveBeenCalledWith(
        userId,
        '🚨 Expired Items',
        '23 items in your pantry have expired. Time to clean up!',
        expect.objectContaining({ type: 'expired_items' }),
        'inventory',
      );
    });

    it('does not send twice when the job runs again the same day', async () => {
      const { service, inventoryModel, notificationService } = buildService({
        expired: [{ _id: new Types.ObjectId(userId), count: 23 }],
      });

      await service.handleExpiryCron();

      // Second pass — a retry, a manual trigger, or another instance whose lock has
      // since expired. The per-user guard still holds.
      inventoryModel.aggregate
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([{ _id: new Types.ObjectId(userId), count: 23 }]);
      await service.handleExpiryCron();

      expect(notificationService.sendToUser).toHaveBeenCalledTimes(1);
    });

    it('sends nothing when another instance holds the cron lock', async () => {
      const { service, notificationService, inventoryModel } = buildService({
        expired: [{ _id: new Types.ObjectId(userId), count: 23 }],
        lockHeld: true,
      });

      await service.handleExpiryCron();

      expect(notificationService.sendToUser).not.toHaveBeenCalled();
      expect(inventoryModel.updateMany).not.toHaveBeenCalled();
    });

    it('frees the day slot when the send fails, so a later run can retry', async () => {
      const { service, notificationService, redis, claimed } = buildService({
        expired: [{ _id: new Types.ObjectId(userId), count: 23 }],
      });
      notificationService.sendToUser.mockRejectedValueOnce(
        new Error('No active mobile device tokens found for this audience'),
      );

      await service.handleExpiryCron();

      expect(redis.releaseLock).toHaveBeenCalledWith(
        expect.stringContaining(`notif:inventory-expiry:${userId}:`),
        expect.any(String),
      );
      expect([...claimed].some((k) => k.startsWith('notif:'))).toBe(false);
    });

    it('clears items more than 30 days past expiry before counting', async () => {
      const { service, inventoryModel } = buildService();

      await service.handleExpiryCron();

      const [filter, update] = inventoryModel.updateMany.mock.calls[0];
      expect(filter.isDiscarded).toBe(false);
      expect(filter.expiresAt.$type).toBe('date');

      const cutoff: Date = filter.expiresAt.$lt;
      const daysBack = (Date.now() - cutoff.getTime()) / (24 * 60 * 60 * 1000);
      expect(daysBack).toBeCloseTo(30, 1);

      expect(update[0].$set).toEqual(
        expect.objectContaining({
          isDiscarded: true,
          autoDiscarded: true,
          freshnessStatus: FreshnessStatus.EXPIRED,
          discardedQuantity: '$quantity',
        }),
      );
    });

    it('leaves items inside the 30 day window alone', async () => {
      const { service, inventoryModel } = buildService();

      await service.handleExpiryCron();

      const [filter] = inventoryModel.updateMany.mock.calls[0];
      const twentyNineDaysAgo = new Date(
        Date.now() - 29 * 24 * 60 * 60 * 1000,
      );
      expect(twentyNineDaysAgo.getTime()).toBeGreaterThan(
        filter.expiresAt.$lt.getTime(),
      );
    });
  });

  describe('handleWeeklyWasteSummary', () => {
    it('excludes auto-cleared items from the weekly count', async () => {
      const { service, inventoryModel } = buildService();
      inventoryModel.aggregate.mockReset();
      inventoryModel.aggregate.mockResolvedValue([]);

      await service.handleWeeklyWasteSummary();

      const [pipeline] = inventoryModel.aggregate.mock.calls[0];
      expect(pipeline[0].$match).toEqual(
        expect.objectContaining({
          isDiscarded: true,
          autoDiscarded: { $ne: true },
        }),
      );
    });

    it('sends one summary per user per run', async () => {
      const { service, inventoryModel, notificationService } = buildService();
      inventoryModel.aggregate.mockReset();
      inventoryModel.aggregate.mockResolvedValue([
        { _id: new Types.ObjectId(userId), totalDiscarded: 4 },
      ]);

      await service.handleWeeklyWasteSummary();
      await service.handleWeeklyWasteSummary();

      expect(notificationService.sendToUser).toHaveBeenCalledTimes(1);
    });
  });
});
