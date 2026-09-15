import { NotificationProducer } from './notification.producer';

const notificationId = '6aa9938dc712b94705427786';
const tokens = [
  { token: 'token-b', tokenType: 'fcm' as const },
  { token: 'token-a', tokenType: 'expo' as const },
];

function buildProducer() {
  const queue = {
    add: jest.fn(async (_name: string, _data: unknown, opts: any) => ({
      id: opts.jobId,
    })),
    addBulk: jest.fn().mockResolvedValue([]),
    getJob: jest.fn().mockResolvedValue(null),
  };
  const logger = {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  };
  return {
    producer: new NotificationProducer(queue as any, logger as any),
    queue,
  };
}

describe('NotificationProducer', () => {
  it('uses a valid stable fan-out job ID', async () => {
    const { producer, queue } = buildProducer();

    await producer.enqueueNotification(notificationId);
    await producer.enqueueNotification(notificationId);

    const firstOptions = queue.add.mock.calls[0][2];
    const secondOptions = queue.add.mock.calls[1][2];
    expect(firstOptions.jobId).toBe(`fanout-${notificationId}`);
    expect(firstOptions.jobId).not.toContain(':');
    expect(secondOptions.jobId).toBe(firstOptions.jobId);
  });

  it('uses deterministic batch IDs and separates retry depths', async () => {
    const { producer, queue } = buildProducer();

    await producer.enqueueBatches(notificationId, tokens, 'normal', 0);
    const firstId = queue.addBulk.mock.calls[0][0][0].opts.jobId;

    await producer.enqueueBatches(
      notificationId,
      [...tokens].reverse(),
      'normal',
      0,
    );
    const reorderedId = queue.addBulk.mock.calls[1][0][0].opts.jobId;

    await producer.enqueueBatches(notificationId, tokens, 'low', 1);
    const retryId = queue.addBulk.mock.calls[2][0][0].opts.jobId;

    expect(firstId).toBe(reorderedId);
    expect(firstId).not.toContain(':');
    expect(retryId).not.toBe(firstId);
  });
});
