import { Inject, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Cron } from '@nestjs/schedule';
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
import { RedisService } from 'src/redis/redis.service';
import { FirebaseGateway } from './firebase.gateway';
import { FirebaseMessagePayload } from './interfaces';
import {
  LOCK_PREFIX,
  LOCK_TTL_SECONDS,
  MAX_RETRIES,
  PROCESSOR_CRON,
  RETRY_DELAYS_MS,
  TOKEN_FAILURE_THRESHOLD,
} from './constants';

@Injectable()
export class NotificationProcessor {
  constructor(
    @InjectModel(Notification.name)
    private readonly notifModel: Model<NotificationDocument>,
    @InjectModel(DeviceToken.name)
    private readonly tokenModel: Model<DeviceTokenDocument>,
    private readonly firebase: FirebaseGateway,
    private readonly redis: RedisService,
    @Inject(WINSTON_MODULE_PROVIDER) private readonly logger: Logger,
  ) {}


  @Cron(PROCESSOR_CRON)
  async processQueue(): Promise<void> {
    if (!this.firebase.isReady()) {
      // Mark stuck PROCESSING notifications as FAILED when Firebase is down
      await this.failStuckNotifications();
      return;
    }

    const now = new Date();

    const pending = await this.notifModel
      .find({
        $or: [
          {
            status: NotificationStatus.QUEUED,
            $or: [
              { scheduledAt: { $exists: false } },
              { scheduledAt: null },
              { scheduledAt: { $lte: now } },
            ],
          },
          {
            status: NotificationStatus.PROCESSING,
            nextRetryAt: { $lte: now },
            retryCount: { $lte: MAX_RETRIES },
          },
        ],
      })
      .sort({ priorityWeight: -1, createdAt: 1 }) 
      .limit(10)
      .exec();

    if (pending.length === 0) return;

    this.logger.info(`Processing ${pending.length} notification(s)`, {
      service: 'NotificationProcessor',
    });

    for (const notif of pending) {
      await this.processNotification(notif);
    }
  }


  async processNotification(notif: NotificationDocument): Promise<void> {
    const lockKey = `${LOCK_PREFIX}${notif._id}`;

    const acquired = await this.acquireLock(lockKey);
    if (!acquired) {
      this.logger.warn('Skipping — another instance holds the lock', {
        service: 'NotificationProcessor',
        notificationId: notif._id,
      });
      return;
    }

    try {
      notif.status = NotificationStatus.PROCESSING;
      await notif.save();

      const tokens = await this.resolveTokens(notif);

      if (tokens.length === 0) {
        this.logger.warn('No active tokens for notification — marking failed', {
          service: 'NotificationProcessor',
          notificationId: notif._id,
        });
        notif.status = NotificationStatus.FAILED;
        notif.lastError = 'No active device tokens found for targets';
        notif.completedAt = new Date();
        await notif.save();
        return;
      }

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

      const result = await this.firebase.sendToTokens(tokens, payload);

      await this.updateTokenHealth(result.successTokens, result.invalidTokens);

      if (result.invalidTokens.length > 0) {
        await this.tokenModel.updateMany(
          { token: { $in: result.invalidTokens } },
          {
            $set: {
              isActive: false,
              deactivationReason: 'unregistered',
              lastFailureAt: new Date(),
            },
          },
        );
      }

      const totalSent = (notif.successCount || 0) + result.successTokens.length;
      const totalFailed =
        (notif.failureCount || 0) +
        result.invalidTokens.length;

      notif.successCount = totalSent;
      notif.failureCount = totalFailed;
      notif.totalTargets = notif.totalTargets || tokens.length;

      if (result.retryableTokens.length > 0 && notif.retryCount < notif.maxRetries) {
        const delayMs =
          RETRY_DELAYS_MS[Math.min(notif.retryCount, RETRY_DELAYS_MS.length - 1)];
        notif.retryCount += 1;
        notif.nextRetryAt = new Date(Date.now() + delayMs);
        notif.failedTokens = result.retryableTokens;
        notif.status = NotificationStatus.PROCESSING; // stays in processing for retry
        notif.lastError = `${result.retryableTokens.length} tokens need retry (attempt ${notif.retryCount}/${notif.maxRetries})`;

        this.logger.info('Scheduling retry', {
          service: 'NotificationProcessor',
          notificationId: notif._id,
          retryCount: notif.retryCount,
          retryableTokens: result.retryableTokens.length,
          nextRetryAt: notif.nextRetryAt,
        });
      } else {
        notif.failedTokens = [];
        notif.nextRetryAt = undefined;
        notif.completedAt = new Date();

        if (totalSent === 0) {
          notif.status = NotificationStatus.FAILED;
        } else if (totalFailed > 0 || result.retryableTokens.length > 0) {
          notif.failureCount += result.retryableTokens.length;
          notif.status = NotificationStatus.PARTIALLY_SENT;
        } else {
          notif.status = NotificationStatus.SENT;
        }

        this.logger.info('Notification processing complete', {
          service: 'NotificationProcessor',
          notificationId: notif._id,
          status: notif.status,
          successCount: notif.successCount,
          failureCount: notif.failureCount,
        });
      }

      await notif.save();
    } catch (error) {
      this.logger.error('Notification processing crashed', {
        service: 'NotificationProcessor',
        notificationId: notif._id,
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
      });

      notif.lastError = error instanceof Error ? error.message : String(error);
      if (notif.retryCount < notif.maxRetries) {
        const delayMs =
          RETRY_DELAYS_MS[Math.min(notif.retryCount, RETRY_DELAYS_MS.length - 1)];
        notif.retryCount += 1;
        notif.nextRetryAt = new Date(Date.now() + delayMs);
      } else {
        notif.status = NotificationStatus.FAILED;
        notif.completedAt = new Date();
      }
      await notif.save();
    } finally {
      await this.releaseLock(lockKey);
    }
  }

  private async resolveTokens(notif: NotificationDocument): Promise<string[]> {
    if (notif.failedTokens && notif.failedTokens.length > 0) {
      const activeTokens = await this.tokenModel
        .find({ token: { $in: notif.failedTokens }, isActive: true })
        .select('token')
        .lean()
        .exec();
      return activeTokens.map((t) => t.token);
    }

    const filter: any = { isActive: true };

    if (!notif.isBroadcast && notif.targetUserIds?.length > 0) {
      filter.userId = { $in: notif.targetUserIds };
    } else if (!notif.isBroadcast) {
      return []; 
    }

    const tokens: string[] = [];
    const cursor = this.tokenModel
      .find(filter)
      .select('token')
      .lean()
      .cursor();

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
        {
          $inc: { failureCount: 1 },
          $set: { lastFailureAt: now },
        },
      );

      await this.tokenModel.updateMany(
        {
          token: { $in: failedTokens },
          failureCount: { $gte: TOKEN_FAILURE_THRESHOLD },
        },
        {
          $set: {
            isActive: false,
            deactivationReason: 'consecutive_failures',
          },
        },
      );
    }
  }

  /**
   * When Firebase is not initialised, any PROCESSING notifications
   * that have exhausted their retries need to be moved to FAILED so
   * they don't sit in limbo forever.
   */
  private async failStuckNotifications(): Promise<void> {
    const stuck = await this.notifModel.updateMany(
      {
        status: NotificationStatus.PROCESSING,
        retryCount: { $gte: MAX_RETRIES },
      },
      {
        $set: {
          status: NotificationStatus.FAILED,
          lastError: 'Firebase Admin SDK not initialised — check credentials',
          completedAt: new Date(),
        },
      },
    );
    if (stuck.modifiedCount > 0) {
      this.logger.warn(`Marked ${stuck.modifiedCount} stuck notification(s) as FAILED (Firebase not ready)`, {
        service: 'NotificationProcessor',
      });
    }
  }

  private async acquireLock(key: string): Promise<boolean> {
    try {
      const result = await this.redis.setNX(key, '1', LOCK_TTL_SECONDS);
      return result;
    } catch {
      return false;
    }
  }

  private async releaseLock(key: string): Promise<void> {
    try {
      await this.redis.del(key);
    } catch {
    }
  }
}
