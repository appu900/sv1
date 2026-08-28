import { Types } from 'mongoose';
import { NotificationStatus } from '../../database/schemas/notification.schema';
import { MAX_BATCH_REQUEUE_DEPTH } from './constants';
import { NotificationWorker } from './notification.worker';

const notificationId = new Types.ObjectId().toString();
const TOKEN = 'ExponentPushToken[abc]';

const emptyResult = {
  successTokens: [],
  retryableTokens: [],
  invalidTokens: [],
};

function buildWorker(overrides: { expoResult?: any } = {}) {
  const notif = {
    _id: notificationId,
    title: '🚨 Expired Items',
    body: '23 items in your pantry have expired. Time to clean up!',
    data: { type: 'expired_items' },
    priority: 'high',
    totalTargets: 1,
    successCount: 0,
    failureCount: 0,
    status: NotificationStatus.PROCESSING,
    save: jest.fn().mockResolvedValue(undefined),
  };

  const notifModel = {
    findById: jest.fn().mockResolvedValue(notif),
    findOneAndUpdate: jest.fn().mockResolvedValue(notif),
    findByIdAndUpdate: jest.fn().mockResolvedValue(notif),
  };

  const tokenModel = {
    updateMany: jest.fn().mockResolvedValue({ modifiedCount: 0 }),
    find: jest.fn().mockReturnValue({
      select: jest.fn().mockReturnValue({
        lean: jest.fn().mockResolvedValue([{ token: TOKEN, tokenType: 'expo' }]),
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
    logger as any,
  );

  return { worker, notif, notifModel, tokenModel, expo, firebase, producer };
}

function batchJob(tokens: { token: string; tokenType: string }[], retryDepth?: number) {
  return {
    id: '1',
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

describe('NotificationWorker', () => {
  it('sends a token once even when the batch lists it twice', async () => {
    const { worker, expo } = buildWorker();

    await worker.process(
      batchJob([
        { token: TOKEN, tokenType: 'expo' },
        { token: TOKEN, tokenType: 'expo' },
      ]),
    );

    expect(expo.sendToTokens).toHaveBeenCalledTimes(1);
    expect(expo.sendToTokens.mock.calls[0][0]).toEqual([TOKEN]);
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

  it('requeues retryable tokens with an incremented depth', async () => {
    const { worker, producer } = buildWorker({
      expoResult: { ...emptyResult, retryableTokens: [TOKEN] },
    });

    await worker.process(batchJob([{ token: TOKEN, tokenType: 'expo' }], 0));

    expect(producer.enqueueBatches).toHaveBeenCalledWith(
      notificationId,
      [{ token: TOKEN, tokenType: 'expo' }],
      'low',
      1,
    );
  });

  it('stops requeueing once the depth limit is reached', async () => {
    const { worker, producer } = buildWorker({
      expoResult: { ...emptyResult, retryableTokens: [TOKEN] },
    });

    await worker.process(
      batchJob([{ token: TOKEN, tokenType: 'expo' }], MAX_BATCH_REQUEUE_DEPTH),
    );

    expect(producer.enqueueBatches).not.toHaveBeenCalled();
  });

  it('counts tokens no gateway can deliver so the notification can finalize', async () => {
    const { worker, notifModel, expo, firebase } = buildWorker();

    await worker.process(batchJob([{ token: 'raw-apns-token', tokenType: 'apns' }]));

    expect(expo.sendToTokens).not.toHaveBeenCalled();
    expect(firebase.sendToTokens).not.toHaveBeenCalled();
    expect(notifModel.findOneAndUpdate).toHaveBeenCalledWith(
      { _id: notificationId },
      { $inc: { successCount: 0, failureCount: 1 } },
    );
  });
});
