import {
  NotificationChannel,
  NotificationStatus,
} from '../../database/schemas/notification.schema';
import { NotificationService } from './notification.service';

function queryChain<T>(value: T) {
  const chain: any = {
    sort: jest.fn(() => chain),
    select: jest.fn(() => chain),
    limit: jest.fn(() => chain),
    exec: jest.fn().mockResolvedValue(value),
    lean: jest.fn().mockResolvedValue(value),
  };
  return chain;
}

function buildService(rows: any[] = []) {
  const findChain = queryChain(rows);
  const notifModel = {
    find: jest.fn().mockReturnValue(findChain),
    findByIdAndUpdate: jest.fn().mockResolvedValue({}),
    updateOne: jest.fn().mockResolvedValue({ modifiedCount: 1 }),
  };
  const producer = {
    enqueueNotification: jest.fn().mockResolvedValue(undefined),
  };
  const logger = {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  };
  const service = new NotificationService(
    {} as any,
    notifModel as any,
    {} as any,
    producer as any,
    logger as any,
  );
  return { service, notifModel, producer, findChain };
}

describe('NotificationService maintenance', () => {
  it('only recovers push rows that were never confirmed as enqueued', async () => {
    const orphan = {
      _id: 'notification-id',
      priority: 'normal',
    };
    const { service, notifModel, producer } = buildService([orphan]);

    await service.requeueOrphaned();

    expect(notifModel.find).toHaveBeenCalledWith(
      expect.objectContaining({
        channel: { $in: [NotificationChannel.PUSH, null] },
        status: NotificationStatus.QUEUED,
        enqueuedAt: { $exists: false },
      }),
    );
    expect(producer.enqueueNotification).toHaveBeenCalledWith(
      orphan._id,
      'normal',
    );
    expect(notifModel.findByIdAndUpdate).toHaveBeenCalledWith(
      orphan._id,
      expect.objectContaining({
        $set: { enqueuedAt: expect.any(Date) },
      }),
    );
  });

  it('repairs impossible success and failure totals', async () => {
    const row = {
      _id: 'notification-id',
      totalTargets: 2,
      successCount: 4,
      failureCount: 1,
    };
    const { service, notifModel } = buildService([row]);

    const repaired = await service.repairImpossibleCounters();

    expect(repaired).toBe(1);
    expect(notifModel.updateOne).toHaveBeenCalledWith(
      { _id: row._id },
      { $set: { successCount: 2, failureCount: 0 } },
    );
  });

  it('finalizes stale processing rows without exceeding target totals', async () => {
    const row = {
      _id: 'notification-id',
      totalTargets: 2,
      successCount: 1,
      failureCount: 0,
    };
    const { service, notifModel } = buildService([row]);

    const finalized = await service.finalizeStaleProcessing();

    expect(finalized).toBe(1);
    expect(notifModel.updateOne).toHaveBeenCalledWith(
      {
        _id: row._id,
        status: NotificationStatus.PROCESSING,
      },
      {
        $set: {
          successCount: 1,
          failureCount: 1,
          status: NotificationStatus.PARTIALLY_SENT,
          completedAt: expect.any(Date),
        },
      },
    );
  });
});
