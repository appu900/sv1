import { Types } from 'mongoose';
import {
  NotificationChannel,
  NotificationStatus,
} from '../../database/schemas/notification.schema';
import { MAX_BATCH_REQUEUE_DEPTH } from './constants';
import { NotificationWorker } from './notification.worker';

const notificationId = new Types.ObjectId().toString();
const TOKEN = 'ExponentPushToken[abc]';

const emptyResult = {
  successTokens: [],
  retryableTokens: [],
  invalidTokens: [],
};

function buildWorker(
  overrides: {
    expoResult?: any;
    status?: NotificationStatus;
    lockAcquired?: boolean;
    lockOwner?: string | null;
  } = {},
) {
  const tokenDocs = [{ token: TOKEN, tokenType: 'expo' }];
  const notif: any = {
    _id: new Types.ObjectId(notificationId),
    title: '🚨 Expired Items',
    body: '23 items in your pantry have expired. Time to clean up!',
    data: { type: 'expired_items' },
    priority: 'high',
    totalTargets: 1,
    successCount: 0,
    failureCount: 0,
    retryCount: 0,
    failedTokens: [],
    completedDeliveryKeys: [],
    status: overrides.status ?? NotificationStatus.PROCESSING,
    createdAt: new Date(),
    save: jest.fn().mockResolvedValue(undefined),
  };

  const applyUpdate = (update: any) => {
    for (const [key, value] of Object.entries(update?.$set ?? {})) {
      notif[key] = value;
    }
    for (const key of Object.keys(update?.$unset ?? {})) {
      delete notif[key];
    }
    for (const [key, value] of Object.entries(update?.$inc ?? {})) {
      notif[key] = (Number(notif[key]) || 0) + Number(value);
    }
    for (const [key, value] of Object.entries(update?.$max ?? {})) {
      notif[key] = Math.max(Number(notif[key]) || 0, Number(value));
    }
    for (const [key, value] of Object.entries(update?.$addToSet ?? {})) {
      const values =
        value && typeof value === 'object' && '$each' in value
          ? (value as any).$each
          : [value];
      notif[key] = [...new Set([...(notif[key] ?? []), ...values])];
    }
  };

  const notifModel = {
    findById: jest.fn().mockResolvedValue(notif),
    findOneAndUpdate: jest.fn(async (filter: any, update: any) => {
      if (filter?.$or) {
        const canClaim =
          notif.status === NotificationStatus.QUEUED ||
          (notif.status === NotificationStatus.PROCESSING &&
            filter.$or.some(
              (condition: any) =>
                condition.processingJobId === notif.processingJobId,
            ));
        if (!canClaim) return null;
      }
      if (
        filter?.status &&
        typeof filter.status === 'string' &&
        notif.status !== filter.status
      ) {
        return null;
      }
      if (
        filter?.completedDeliveryKeys?.$ne &&
        notif.completedDeliveryKeys.includes(filter.completedDeliveryKeys.$ne)
      ) {
        return null;
      }
      applyUpdate(update);
      return notif;
    }),
    findByIdAndUpdate: jest.fn(async (_id: any, update: any) => {
      applyUpdate(update);
      return notif;
    }),
    updateOne: jest.fn(async (_filter: any, update: any) => {
      if (update?.$pull?.failedTokens?.$in) {
        const removed = new Set(update.$pull.failedTokens.$in);
        notif.failedTokens = notif.failedTokens.filter(
          (token: string) => !removed.has(token),
        );
      }
      applyUpdate(update);
      return { modifiedCount: 1 };
    }),
  };

  const leanQuery: any = {
    cursor: jest.fn(() => ({
      async *[Symbol.asyncIterator]() {
        for (const doc of tokenDocs) yield doc;
      },
    })),
    then: (resolve: (value: any) => unknown, reject: (error: any) => unknown) =>
      Promise.resolve(tokenDocs).then(resolve, reject),
  };
  const tokenModel = {
    updateMany: jest.fn().mockResolvedValue({ modifiedCount: 0 }),
    find: jest.fn().mockReturnValue({
      select: jest.fn().mockReturnValue({
        lean: jest.fn().mockReturnValue(leanQuery),
      }),
    }),
  };

  const expo = {
    sendToTokens: jest
      .fn()
      .mockResolvedValue(
        overrides.expoResult ?? { ...emptyResult, successTokens: [TOKEN] },
      ),
  };
  const firebase = { sendToTokens: jest.fn().mockResolvedValue(emptyResult) };
  const producer = { enqueueBatches: jest.fn().mockResolvedValue(1) };
  const redis = {
    setIfAbsent: jest.fn().mockResolvedValue(overrides.lockAcquired ?? true),
    getRaw: jest.fn().mockResolvedValue(overrides.lockOwner ?? null),
    releaseLock: jest.fn().mockResolvedValue(true),
  };
  const logger = {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  };

  const worker = new NotificationWorker(
    notifModel as any,
    tokenModel as any,
    firebase as any,
    expo as any,
    producer as any,
    redis as any,
    logger as any,
  );

  return {
    worker,
    notif,
    notifModel,
    tokenModel,
    expo,
    firebase,
    producer,
    redis,
  };
}

function batchJob(
  tokens: { token: string; tokenType: string }[],
  retryDepth?: number,
  id = 'batch-job-1',
) {
  return {
    id,
    data: {
      type: 'send-batch' as const,
      notificationId,
      tokens,
      batchIndex: 0,
      totalBatches: 1,
      ...(retryDepth === undefined ? {} : { retryDepth }),
    },
  } as any;
}

function fanOutJob(id = 'fanout-job-1') {
  return {
    id,
    data: { type: 'fan-out' as const, notificationId },
  } as any;
}

describe('NotificationWorker', () => {
  it('sends a token once even when the batch lists it twice', async () => {
    const { worker, expo, notif } = buildWorker();

    await worker.process(
      batchJob([
        { token: TOKEN, tokenType: 'expo' },
        { token: TOKEN, tokenType: 'expo' },
      ]),
    );

    expect(expo.sendToTokens).toHaveBeenCalledTimes(1);
    expect(expo.sendToTokens.mock.calls[0][0]).toEqual([TOKEN]);
    expect(notif.successCount).toBe(1);
    expect(notif.totalTargets).toBe(1);
  });

  it('does not send or increment counters when a duplicate batch runs', async () => {
    const { worker, expo, notif } = buildWorker();
    const job = batchJob([{ token: TOKEN, tokenType: 'expo' }]);

    await worker.process(job);
    await worker.process(job);

    expect(expo.sendToTokens).toHaveBeenCalledTimes(1);
    expect(notif.successCount).toBe(1);
    expect(notif.failureCount).toBe(0);
  });

  it('does not fail the job when bookkeeping fails after the push went out', async () => {
    const { worker, notifModel, expo } = buildWorker();
    notifModel.findOneAndUpdate.mockRejectedValue(new Error('mongo timeout'));

    // A throw here would make BullMQ retry the job and deliver the push a second time.
    await expect(
      worker.process(batchJob([{ token: TOKEN, tokenType: 'expo' }])),
    ).resolves.toBeUndefined();

    expect(expo.sendToTokens).toHaveBeenCalledTimes(1);
  });

  it('requeues transient tokens without counting them as failures yet', async () => {
    const { worker, producer, notif } = buildWorker({
      expoResult: { ...emptyResult, retryableTokens: [TOKEN] },
    });

    await worker.process(batchJob([{ token: TOKEN, tokenType: 'expo' }], 0));

    expect(producer.enqueueBatches).toHaveBeenCalledWith(
      notificationId,
      [{ token: TOKEN, tokenType: 'expo' }],
      'low',
      1,
    );
    expect(notif.successCount).toBe(0);
    expect(notif.failureCount).toBe(0);
    expect(notif.retryCount).toBe(1);
    expect(notif.status).toBe(NotificationStatus.PROCESSING);
  });

  it('counts a transient token once when the retry limit is reached', async () => {
    const { worker, producer, notif } = buildWorker({
      expoResult: { ...emptyResult, retryableTokens: [TOKEN] },
    });

    await worker.process(
      batchJob([{ token: TOKEN, tokenType: 'expo' }], MAX_BATCH_REQUEUE_DEPTH),
    );

    expect(producer.enqueueBatches).not.toHaveBeenCalled();
    expect(notif.successCount).toBe(0);
    expect(notif.failureCount).toBe(1);
    expect(notif.status).toBe(NotificationStatus.FAILED);
  });

  it('sends Expo-shaped tokens through Expo even if they were stored as fcm', async () => {
    const { worker, expo, firebase } = buildWorker();

    await worker.process(
      batchJob([{ token: 'ExponentPushToken[mislabelled]', tokenType: 'fcm' }]),
    );

    expect(expo.sendToTokens).toHaveBeenCalledWith(
      ['ExponentPushToken[mislabelled]'],
      expect.any(Object),
    );
    expect(firebase.sendToTokens).not.toHaveBeenCalled();
  });

  it('counts tokens no gateway can deliver so the notification can finalize', async () => {
    const { worker, notif, expo, firebase } = buildWorker();

    await worker.process(
      batchJob([{ token: 'raw-apns-token', tokenType: 'apns' }]),
    );

    expect(expo.sendToTokens).not.toHaveBeenCalled();
    expect(firebase.sendToTokens).not.toHaveBeenCalled();
    expect(notif.failureCount).toBe(1);
  });

  it('skips a recovery fan-out when another job already owns delivery', async () => {
    const { worker, notif, expo, firebase } = buildWorker({
      status: NotificationStatus.PROCESSING,
    });
    notif.processingJobId = 'original-job';

    await worker.process(fanOutJob('recovery-job'));

    expect(expo.sendToTokens).not.toHaveBeenCalled();
    expect(firebase.sendToTokens).not.toHaveBeenCalled();
  });

  it('skips a batch while another job holds its delivery lock', async () => {
    const { worker, expo, firebase } = buildWorker({
      lockAcquired: false,
      lockOwner: 'other-job',
    });

    await worker.process(
      batchJob([{ token: TOKEN, tokenType: 'expo' }], 0, 'duplicate-job'),
    );

    expect(expo.sendToTokens).not.toHaveBeenCalled();
    expect(firebase.sendToTokens).not.toHaveBeenCalled();
  });

  it('never sends an email/newsletter row through the push worker', async () => {
    const { worker, notif, expo, firebase } = buildWorker();
    notif.channel = NotificationChannel.EMAIL;

    await worker.process(
      batchJob([{ token: TOKEN, tokenType: 'expo' }]),
    );

    expect(expo.sendToTokens).not.toHaveBeenCalled();
    expect(firebase.sendToTokens).not.toHaveBeenCalled();
  });
});
