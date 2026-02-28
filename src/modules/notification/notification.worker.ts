import { Processor, WorkerHost, OnWorkerEvent } from '@nestjs/bullmq';
import { Inject } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Job } from 'bullmq';
import { WINSTON_MODULE_PROVIDER } from 'nest-winston';
import { Logger } from 'winston';
import {
  Notification,
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
import {
  NotificationJobData,
  FanOutJobData,
  SendBatchJobData,
  FirebaseMessagePayload,
  BatchSendResult,
} from './interfaces';
import {
  NOTIFICATION_QUEUE_NAME,
  WORKER_CONCURRENCY,
  TOKEN_FAILURE_THRESHOLD,
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
  async onFailed(
    job: Job<NotificationJobData> | undefined,
    error: Error,
  ) {
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
        await this.notifModel.findByIdAndUpdate(job.data.notificationId, {
          $set: {
            status: NotificationStatus.FAILED,
            lastError: `Job permanently failed after ${job.attemptsMade} attempts: ${error.message}`,
            completedAt: new Date(),
          },
        });
        this.logger.warn('Notification marked as FAILED after max retries', {
          service: 'NotificationWorker',
          notificationId: job.data.notificationId,
          attempts: job.attemptsMade,
        });
      } catch (dbErr) {
        this.logger.error('Failed to update notification status on final failure', {
          service: 'NotificationWorker',
          error: dbErr instanceof Error ? dbErr.message : String(dbErr),
        });
      }
    }
  }

  private async handleFanOut(job: Job<FanOutJobData>): Promise<void> {
    const { notificationId } = job.data;

    const notif = await this.notifModel.findById(notificationId);
    if (!notif) {
      this.logger.error('Notification not found — skipping', {
        service: 'NotificationWorker',
        notificationId,
      });
      return;
    }

    notif.status = NotificationStatus.PROCESSING;
    await notif.save();

    const tokens = await this.resolveTokens(notif);

    if (tokens.length === 0) {
      notif.status = NotificationStatus.FAILED;
      notif.lastError = 'No active device tokens found for targets';
      notif.completedAt = new Date();
      await notif.save();
      return;
    }

    notif.totalTargets = tokens.length;
    await notif.save();

    if (tokens.length <= 1000) {
      await this.sendTokens(notif, tokens);
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
    const { notificationId, tokens, batchIndex, totalBatches } = job.data;

    const notif = await this.notifModel.findById(notificationId);
    if (!notif) {
      this.logger.error('Notification not found for batch — skipping', {
        service: 'NotificationWorker',
        notificationId,
        batchIndex,
      });
      return;
    }

    await this.sendTokens(notif, tokens);
  }

  private async sendTokens(
    notif: NotificationDocument,
    tokens: string[],
  ): Promise<void> {
    const payload: FirebaseMessagePayload = {
      title: notif.title,
      body: notif.body,
      data: {
        ...(notif.data ?? {}),
        ...(notif.deepLink ? { deepLink: notif.deepLink } : {}),
        notificationId: String(notif._id),
      },
      imageUrl: notif.imageUrl,
    };

    const expoTokens = tokens.filter((t) => t.startsWith('ExponentPushToken[') || t.startsWith('ExpoPushToken['));
    const fcmTokens = tokens.filter((t) => !t.startsWith('ExponentPushToken[') && !t.startsWith('ExpoPushToken['));

    const [expoResult, firebaseResult] = await Promise.all([
      expoTokens.length > 0
        ? this.expo.sendToTokens(expoTokens, payload)
        : Promise.resolve<BatchSendResult>({ successTokens: [], retryableTokens: [], invalidTokens: [] }),
      fcmTokens.length > 0
        ? this.firebase.sendToTokens(fcmTokens, payload)
        : Promise.resolve<BatchSendResult>({ successTokens: [], retryableTokens: [], invalidTokens: [] }),
    ]);

    const result: BatchSendResult = {
      successTokens: [...expoResult.successTokens, ...firebaseResult.successTokens],
      retryableTokens: [...expoResult.retryableTokens, ...firebaseResult.retryableTokens],
      invalidTokens: [...expoResult.invalidTokens, ...firebaseResult.invalidTokens],
    };

    await this.updateTokenHealth(result.successTokens, result.invalidTokens);

    if (result.invalidTokens.length > 0) {
      await this.tokenModel.updateMany(
        { token: { $in: result.invalidTokens } },
        { $set: { isActive: false, deactivationReason: 'unregistered', lastFailureAt: new Date() } },
      );
    }

    await this.notifModel.findOneAndUpdate(
      { _id: notif._id },
      { $inc: { successCount: result.successTokens.length, failureCount: result.invalidTokens.length } },
    );

    if (result.retryableTokens.length > 0 && result.successTokens.length === 0) {
      throw new Error(`${result.retryableTokens.length} tokens need retry — all failed with transient errors`);
    }

    await this.finalizeIfComplete(notif._id);
  }

  private async finalizeIfComplete(notificationId: any): Promise<void> {
    const latest = await this.notifModel.findById(notificationId);
    if (!latest) return;

    const totalProcessed = (latest.successCount || 0) + (latest.failureCount || 0);
    const totalTargets = latest.totalTargets || 0;

    if (totalProcessed < totalTargets || totalTargets === 0) return;

    if (latest.successCount === 0) {
      latest.status = NotificationStatus.FAILED;
    } else if (latest.failureCount > 0) {
      latest.status = NotificationStatus.PARTIALLY_SENT;
    } else {
      latest.status = NotificationStatus.SENT;
    }
    latest.completedAt = new Date();
    await latest.save();

    this.logger.info('Notification fully complete', {
      service: 'NotificationWorker',
      notificationId: String(notificationId),
      status: latest.status,
      successCount: latest.successCount,
      failureCount: latest.failureCount,
    });
  }

  private async resolveTokens(notif: NotificationDocument): Promise<string[]> {
    const filter: any = { isActive: true };

    if (!notif.isBroadcast && notif.targetUserIds?.length > 0) {
      filter.userId = { $in: notif.targetUserIds };
    } else if (!notif.isBroadcast) {
      return [];
    }

    const tokens: string[] = [];
    const cursor = this.tokenModel.find(filter).select('token').lean().cursor();
    for await (const doc of cursor) {
      tokens.push(doc.token);
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
        { token: { $in: failedTokens }, failureCount: { $gte: TOKEN_FAILURE_THRESHOLD } },
        { $set: { isActive: false, deactivationReason: 'consecutive_failures' } },
      );
    }
  }
}