import { Processor, WorkerHost, OnWorkerEvent } from '@nestjs/bullmq';
import { Inject } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Job } from 'bullmq';
import { createHash } from 'crypto';
import { WINSTON_MODULE_PROVIDER } from 'nest-winston';
import { Logger } from 'winston';
import {
  Notification,
  NotificationChannel,
  NotificationDocument,
  NotificationStatus,
} from 'src/database/schemas/notification.schema';
import {
  DeviceToken,
  DeviceTokenDocument,
} from 'src/database/schemas/device-token.schema';
import { FirebaseGateway } from './firebase.gateway';
import { ExpoGateway } from './expo.gateway';
import { NotificationProducer } from './notification.producer';
import { RedisService } from '../../redis/redis.service';
import {
  NotificationJobData,
  FanOutJobData,
  SendBatchJobData,
  FirebaseMessagePayload,
  BatchSendResult,
  TokenWithType,
} from './interfaces';
import {
  NOTIFICATION_QUEUE_NAME,
  WORKER_CONCURRENCY,
  TOKEN_FAILURE_THRESHOLD,
  FAN_OUT_BATCH_SIZE,
  MAX_BATCH_REQUEUE_DEPTH,
  DELIVERY_LOCK_TTL_SECONDS,
} from './constants';

@Processor(NOTIFICATION_QUEUE_NAME, {
  concurrency: WORKER_CONCURRENCY,
})
export class NotificationWorker extends WorkerHost {
  constructor(
    @InjectModel(Notification.name)
    private readonly notifModel: Model<NotificationDocument>,
    @InjectModel(DeviceToken.name)
    private readonly tokenModel: Model<DeviceTokenDocument>,
    private readonly firebase: FirebaseGateway,
    private readonly expo: ExpoGateway,
    private readonly producer: NotificationProducer,
    private readonly redis: RedisService,
    @Inject(WINSTON_MODULE_PROVIDER) private readonly logger: Logger,
  ) {
    super();
  }

  async process(job: Job<NotificationJobData>): Promise<any> {
    switch (job.data.type) {
      case 'fan-out':
        return this.handleFanOut(job as Job<FanOutJobData>);
      case 'send-batch':
        return this.handleSendBatch(job as Job<SendBatchJobData>);
      default:
        throw new Error(`Unknown job type: ${(job.data as any).type}`);
    }
  }

  @OnWorkerEvent('active')
  onActive(job: Job<NotificationJobData>) {
    this.logger.info('Job started processing', {
      service: 'NotificationWorker',
      jobId: job.id,
      jobName: job.name,
      type: job.data.type,
      attempt: job.attemptsMade + 1,
    });
  }

  @OnWorkerEvent('completed')
  onCompleted(job: Job<NotificationJobData>) {
    this.logger.info('Job completed', {
      service: 'NotificationWorker',
      jobId: job.id,
      jobName: job.name,
      type: job.data.type,
      durationMs: Date.now() - job.timestamp,
    });
  }

  @OnWorkerEvent('failed')
  async onFailed(job: Job<NotificationJobData> | undefined, error: Error) {
    if (!job) return;

    this.logger.error('Job failed', {
      service: 'NotificationWorker',
      jobId: job.id,
      jobName: job.name,
      type: job.data.type,
      attempt: job.attemptsMade,
      maxAttempts: job.opts.attempts,
      error: error.message,
    });

    if (job.attemptsMade >= (job.opts.attempts ?? 3)) {
      try {
        const lastError = `Job permanently failed after ${job.attemptsMade} attempts: ${error.message}`;

        if (job.data.type === 'fan-out') {
          const failed = await this.notifModel.findOneAndUpdate(
            {
              _id: job.data.notificationId,
              channel: { $in: [NotificationChannel.PUSH, null] },
              $or: [
                { status: NotificationStatus.QUEUED },
                {
                  status: NotificationStatus.PROCESSING,
                  processingJobId: String(job.id),
                },
              ],
            },
            {
              $set: {
                status: NotificationStatus.FAILED,
                lastError,
                completedAt: new Date(),
              },
            },
          );
          if (failed) {
            this.logger.warn(
              'Notification marked as FAILED after max retries',
              {
                service: 'NotificationWorker',
                notificationId: job.data.notificationId,
                attempts: job.attemptsMade,
              },
            );
          }
        } else {
          const tokens = this.dedupeTokens(job.data.tokens);
          const deliveryKey = this.deliveryKey(
            tokens,
            job.data.retryDepth ?? 0,
          );
          const tokenValues = tokens.map(({ token }) => token);
          await this.notifModel.findOneAndUpdate(
            {
              _id: job.data.notificationId,
              channel: { $in: [NotificationChannel.PUSH, null] },
              status: NotificationStatus.PROCESSING,
              completedDeliveryKeys: { $ne: deliveryKey },
            },
            {
              $inc: { failureCount: tokenValues.length },
              $addToSet: {
                completedDeliveryKeys: deliveryKey,
                failedTokens: { $each: tokenValues },
              },
              $set: { lastError },
            },
          );
          await this.finalizeIfComplete(job.data.notificationId);
        }
      } catch (dbErr) {
        this.logger.error(
          'Failed to update notification status on final failure',
          {
            service: 'NotificationWorker',
            error: dbErr instanceof Error ? dbErr.message : String(dbErr),
          },
        );
      }
    }
  }

  private async handleFanOut(job: Job<FanOutJobData>): Promise<void> {
    const { notificationId } = job.data;
    const jobId = String(job.id);

    const notif = await this.notifModel.findOneAndUpdate(
      {
        _id: notificationId,
        channel: { $in: [NotificationChannel.PUSH, null] },
        $or: [
          { status: NotificationStatus.QUEUED },
          {
            status: NotificationStatus.PROCESSING,
            processingJobId: jobId,
          },
        ],
      },
      {
        $set: {
          status: NotificationStatus.PROCESSING,
          processingJobId: jobId,
          processingStartedAt: new Date(),
        },
        $unset: { lastError: 1 },
      },
      { new: true },
    );

    if (!notif) {
      this.logger.info('Fan-out already claimed or completed — skipping', {
        service: 'NotificationWorker',
        notificationId,
        jobId,
      });
      return;
    }

    if (notif.channel && notif.channel !== NotificationChannel.PUSH) {
      this.logger.warn('Non-push notification reached push worker — skipping', {
        service: 'NotificationWorker',
        notificationId,
        channel: notif.channel,
      });
      return;
    }

    const tokens = this.dedupeTokens(await this.resolveTokens(notif));

    if (tokens.length === 0) {
      notif.status = NotificationStatus.FAILED;
      notif.lastError = 'No active device tokens found for targets';
      notif.completedAt = new Date();
      await notif.save();
      return;
    }

    notif.totalTargets = tokens.length;
    await notif.save();

    if (tokens.length <= FAN_OUT_BATCH_SIZE) {
      await this.sendTokens(notif, tokens, 0, jobId);
      return;
    }

    const priority = notif.priority || 'normal';
    const totalBatches = await this.producer.enqueueBatches(
      notificationId,
      tokens,
      priority as 'high' | 'normal' | 'low',
    );

    this.logger.info('Fan-out complete — batch jobs enqueued', {
      service: 'NotificationWorker',
      notificationId,
      totalTokens: tokens.length,
      totalBatches,
    });
  }

  private async handleSendBatch(job: Job<SendBatchJobData>): Promise<void> {
    const { notificationId, tokens, batchIndex, retryDepth } = job.data;

    const notif = await this.notifModel.findById(notificationId);
    if (!notif) {
      this.logger.error('Notification not found for batch — skipping', {
        service: 'NotificationWorker',
        notificationId,
        batchIndex,
      });
      return;
    }

    if (notif.channel && notif.channel !== NotificationChannel.PUSH) {
      this.logger.warn('Non-push notification reached push worker — skipping', {
        service: 'NotificationWorker',
        notificationId,
        channel: notif.channel,
      });
      return;
    }

    if (this.isTerminalStatus(notif.status)) {
      this.logger.info('Notification already complete — skipping batch', {
        service: 'NotificationWorker',
        notificationId,
        batchIndex,
        status: notif.status,
      });
      return;
    }

    await this.sendTokens(notif, tokens, retryDepth ?? 0, String(job.id));
  }

  private async sendTokens(
    notif: NotificationDocument,
    tokens: TokenWithType[],
    retryDepth = 0,
    jobId: string,
  ): Promise<void> {
    const payload: FirebaseMessagePayload = {
      title: notif.title,
      body: notif.body,
      data: this.stringifyData({
        ...(notif.data ?? {}),
        ...(notif.deepLink ? { deepLink: notif.deepLink } : {}),
        notificationId: String(notif._id),
      }),
      imageUrl: notif.imageUrl,
    };

    // One device can only hold one active row per token, but a batch can still arrive
    // with the same token twice (a re-queue overlapping the original fan-out). Sending
    // the list as-is would put the same banner on the phone twice.
    const uniqueTokens = this.dedupeTokens(tokens);
    const deliveryKey = this.deliveryKey(uniqueTokens, retryDepth);

    if (notif.completedDeliveryKeys?.includes(deliveryKey)) {
      this.logger.info('Delivery batch already recorded — skipping', {
        service: 'NotificationWorker',
        notificationId: String(notif._id),
        deliveryKey,
      });
      return;
    }

    const lockKey = `lock:notification-delivery:${String(notif._id)}:${deliveryKey}`;
    const acquired = await this.redis.setIfAbsent(
      lockKey,
      jobId,
      DELIVERY_LOCK_TTL_SECONDS,
    );
    if (!acquired) {
      const owner = await this.redis.getRaw(lockKey);
      if (owner !== jobId) {
        this.logger.info('Delivery batch owned by another job — skipping', {
          service: 'NotificationWorker',
          notificationId: String(notif._id),
          deliveryKey,
          jobId,
        });
        return;
      }
    }

    try {
      const latest = await this.notifModel.findById(notif._id);
      if (
        !latest ||
        this.isTerminalStatus(latest.status) ||
        latest.completedDeliveryKeys?.includes(deliveryKey)
      ) {
        return;
      }

      const expoTokens = uniqueTokens
        .filter((t) => this.gatewayFor(t) === 'expo')
        .map((t) => t.token);
      const fcmTokens = uniqueTokens
        .filter((t) => this.gatewayFor(t) === 'fcm')
        .map((t) => t.token);
      const unsupportedTokens = uniqueTokens.filter(
        (t) => this.gatewayFor(t) === 'none',
      );

      if (unsupportedTokens.length > 0) {
        this.logger.warn('Skipping tokens with no delivery gateway', {
          service: 'NotificationWorker',
          notificationId: String(notif._id),
          count: unsupportedTokens.length,
          tokenTypes: Array.from(
            new Set(unsupportedTokens.map((t) => t.tokenType)),
          ),
        });
      }

      const [expoResult, firebaseResult] = await Promise.all([
        expoTokens.length > 0
          ? this.expo.sendToTokens(expoTokens, payload)
          : Promise.resolve<BatchSendResult>({
              successTokens: [],
              retryableTokens: [],
              invalidTokens: [],
            }),
        fcmTokens.length > 0
          ? this.firebase.sendToTokens(fcmTokens, payload)
          : Promise.resolve<BatchSendResult>({
              successTokens: [],
              retryableTokens: [],
              invalidTokens: [],
            }),
      ]);

      const result: BatchSendResult = {
        successTokens: [
          ...expoResult.successTokens,
          ...firebaseResult.successTokens,
        ],
        retryableTokens: [
          ...expoResult.retryableTokens,
          ...firebaseResult.retryableTokens,
        ],
        invalidTokens: [
          ...expoResult.invalidTokens,
          ...firebaseResult.invalidTokens,
        ],
      };
      try {
        await this.recordSendResult(
          latest,
          result,
          unsupportedTokens,
          retryDepth,
          deliveryKey,
        );
      } catch (error) {
        this.logger.error(
          'Post-send bookkeeping failed — not retrying the delivery',
          {
            service: 'NotificationWorker',
            notificationId: String(notif._id),
            error: error instanceof Error ? error.message : String(error),
          },
        );
      }
    } finally {
      await this.redis.releaseLock(lockKey, jobId).catch((error) => {
        this.logger.warn('Failed to release notification delivery lock', {
          service: 'NotificationWorker',
          notificationId: String(notif._id),
          deliveryKey,
          error: error instanceof Error ? error.message : String(error),
        });
      });
    }
  }

  private isTerminalStatus(status: NotificationStatus): boolean {
    return [
      NotificationStatus.SENT,
      NotificationStatus.PARTIALLY_SENT,
      NotificationStatus.FAILED,
    ].includes(status);
  }

  private deliveryKey(tokens: TokenWithType[], retryDepth: number): string {
    const hash = createHash('sha256')
      .update(
        tokens
          .map(({ token }) => token)
          .sort()
          .join('\0'),
      )
      .digest('hex')
      .slice(0, 24);
    return `${retryDepth}-${hash}`;
  }

  private gatewayFor(token: TokenWithType): 'expo' | 'fcm' | 'none' {
    if (
      token.token.startsWith('ExponentPushToken[') ||
      token.token.startsWith('ExpoPushToken[') ||
      token.tokenType === 'expo'
    ) {
      return 'expo';
    }
    if (token.tokenType === 'fcm') return 'fcm';
    return 'none';
  }

  private stringifyData(data: Record<string, unknown>): Record<string, string> {
    const next: Record<string, string> = {};
    for (const [key, value] of Object.entries(data)) {
      if (value == null) continue;
      next[key] = typeof value === 'string' ? value : String(value);
    }
    return next;
  }

  private dedupeTokens(tokens: TokenWithType[]): TokenWithType[] {
    const seen = new Set<string>();
    return tokens.filter((t) => {
      if (seen.has(t.token)) return false;
      seen.add(t.token);
      return true;
    });
  }

  private async recordSendResult(
    notif: NotificationDocument,
    result: BatchSendResult,
    unsupportedTokens: TokenWithType[],
    retryDepth: number,
    deliveryKey: string,
  ): Promise<void> {
    const successTokens = Array.from(new Set(result.successTokens));
    const invalidTokens = Array.from(new Set(result.invalidTokens));
    const retryableTokens = Array.from(new Set(result.retryableTokens));

    await this.updateTokenHealth(successTokens, invalidTokens);

    if (invalidTokens.length > 0) {
      await this.tokenModel.updateMany(
        { token: { $in: invalidTokens } },
        {
          $set: {
            isActive: false,
            deactivationReason: 'unregistered',
            lastFailureAt: new Date(),
          },
        },
      );
    }

    const requeuedTokens =
      retryableTokens.length > 0
        ? await this.requeueRetryableTokens(notif, retryableTokens, retryDepth)
        : [];
    const requeuedSet = new Set(requeuedTokens);
    const exhaustedTokens = retryableTokens.filter(
      (token) => !requeuedSet.has(token),
    );
    const permanentFailedTokens = Array.from(
      new Set([
        ...invalidTokens,
        ...unsupportedTokens.map(({ token }) => token),
        ...exhaustedTokens,
      ]),
    );

    const addToSet: Record<string, unknown> = {
      completedDeliveryKeys: deliveryKey,
    };
    if (permanentFailedTokens.length > 0) {
      addToSet.failedTokens = { $each: permanentFailedTokens };
    }

    const update: Record<string, unknown> = {
      $inc: {
        successCount: successTokens.length,
        // A transient result is pending, not a failure. It is counted only if
        // no retry can be queued or the retry limit is exhausted.
        failureCount: permanentFailedTokens.length,
      },
      $addToSet: addToSet,
    };
    if (requeuedTokens.length > 0) {
      update.$max = { retryCount: retryDepth + 1 };
    }

    const recorded = await this.notifModel.findOneAndUpdate(
      {
        _id: notif._id,
        status: NotificationStatus.PROCESSING,
        completedDeliveryKeys: { $ne: deliveryKey },
      },
      update,
      { new: true },
    );
    if (!recorded) {
      this.logger.info(
        'Delivery result already recorded — ignoring duplicate',
        {
          service: 'NotificationWorker',
          notificationId: String(notif._id),
          deliveryKey,
        },
      );
      return;
    }

    if (successTokens.length > 0) {
      await this.notifModel.updateOne(
        { _id: notif._id },
        { $pull: { failedTokens: { $in: successTokens } } },
      );
    }

    await this.finalizeIfComplete(notif._id);
  }

  /**
   * Re-queues tokens the gateway said to try again later — but only a bounded number of
   * times. An outage that marks every token retryable used to re-queue itself endlessly,
   * re-delivering the same notification on each pass.
   */
  private async requeueRetryableTokens(
    notif: NotificationDocument,
    retryableTokens: string[],
    retryDepth: number,
  ): Promise<string[]> {
    const nextDepth = retryDepth + 1;

    if (nextDepth > MAX_BATCH_REQUEUE_DEPTH) {
      this.logger.warn('Retryable tokens dropped — requeue limit reached', {
        service: 'NotificationWorker',
        notificationId: String(notif._id),
        retryCount: retryableTokens.length,
        retryDepth,
        maxDepth: MAX_BATCH_REQUEUE_DEPTH,
      });
      return [];
    }

    const retryDocs = await this.tokenModel
      .find({ token: { $in: retryableTokens }, isActive: true })
      .select('token tokenType')
      .lean();

    if (retryDocs.length === 0) return [];

    const retryTokens: TokenWithType[] = retryDocs.map((d) => ({
      token: d.token,
      tokenType: d.tokenType,
    }));

    try {
      await this.producer.enqueueBatches(
        String(notif._id),
        retryTokens,
        'low',
        nextDepth,
      );
    } catch (error) {
      this.logger.error('Failed to enqueue retryable notification tokens', {
        service: 'NotificationWorker',
        notificationId: String(notif._id),
        retryCount: retryTokens.length,
        retryDepth: nextDepth,
        error: error instanceof Error ? error.message : String(error),
      });
      return [];
    }

    this.logger.info('Retryable tokens requeued', {
      service: 'NotificationWorker',
      notificationId: String(notif._id),
      retryCount: retryTokens.length,
      retryDepth: nextDepth,
    });
    return retryTokens.map(({ token }) => token);
  }

  private async finalizeIfComplete(notificationId: any): Promise<void> {
    const latest = await this.notifModel.findById(notificationId);
    if (!latest) return;

    const totalTargets = Math.max(0, Number(latest.totalTargets) || 0);
    if (totalTargets === 0) return;

    // Clamp legacy/duplicate increments so persisted counts always obey
    // success + failure <= totalTargets.
    const successCount = Math.min(
      totalTargets,
      Math.max(0, Number(latest.successCount) || 0),
    );
    let failureCount = Math.min(
      totalTargets - successCount,
      Math.max(0, Number(latest.failureCount) || 0),
    );
    const totalProcessed = successCount + failureCount;

    if (totalProcessed < totalTargets) {
      const createdAt =
        (latest as any).createdAt ?? latest['_id'].getTimestamp();
      const ageMs = Date.now() - new Date(createdAt).getTime();
      if (ageMs < 30 * 60 * 1000) return;

      // No more result can arrive after the timeout. Account for missing tokens
      // as failures rather than reporting a misleading fully-sent status.
      failureCount += totalTargets - totalProcessed;
      this.logger.warn(
        'Notification timed out — finalizing with partial results',
        {
          service: 'NotificationWorker',
          notificationId: String(notificationId),
          totalProcessed,
          totalTargets,
          ageMs,
        },
      );
    }

    const status =
      successCount === 0
        ? NotificationStatus.FAILED
        : failureCount > 0
          ? NotificationStatus.PARTIALLY_SENT
          : NotificationStatus.SENT;
    const finalized = await this.notifModel.findOneAndUpdate(
      { _id: notificationId, status: NotificationStatus.PROCESSING },
      {
        $set: {
          successCount,
          failureCount,
          status,
          completedAt: new Date(),
        },
      },
      { new: true },
    );
    if (!finalized) return;

    this.logger.info('Notification fully complete', {
      service: 'NotificationWorker',
      notificationId: String(notificationId),
      status,
      successCount,
      failureCount,
    });
  }

  private async resolveTokens(
    notif: NotificationDocument,
  ): Promise<TokenWithType[]> {
    const filter: any = { isActive: true };

    if (!notif.isBroadcast && notif.targetUserIds?.length > 0) {
      filter.userId = { $in: notif.targetUserIds };
    } else if (!notif.isBroadcast) {
      return [];
    }

    const targetPlatform = (notif as any).targetPlatform;
    if (targetPlatform && targetPlatform !== 'all') {
      filter.platform = targetPlatform;
    }

    const tokens: TokenWithType[] = [];
    const cursor = this.tokenModel
      .find(filter)
      .select('token tokenType')
      .lean()
      .cursor({ batchSize: 500 });
    for await (const doc of cursor) {
      tokens.push({ token: doc.token, tokenType: doc.tokenType });
    }
    return tokens;
  }

  private async updateTokenHealth(
    successTokens: string[],
    failedTokens: string[],
  ): Promise<void> {
    const now = new Date();

    if (successTokens.length > 0) {
      await this.tokenModel.updateMany(
        { token: { $in: successTokens } },
        { $set: { failureCount: 0, lastSuccessAt: now } },
      );
    }

    if (failedTokens.length > 0) {
      await this.tokenModel.updateMany(
        { token: { $in: failedTokens } },
        { $inc: { failureCount: 1 }, $set: { lastFailureAt: now } },
      );

      await this.tokenModel.updateMany(
        {
          token: { $in: failedTokens },
          failureCount: { $gte: TOKEN_FAILURE_THRESHOLD },
        },
        {
          $set: { isActive: false, deactivationReason: 'consecutive_failures' },
        },
      );
    }
  }
}
