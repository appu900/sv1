import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { WINSTON_MODULE_PROVIDER } from 'nest-winston';
import { Logger } from 'winston';
import {
  DeviceToken,
  DeviceTokenDocument,
  TokenMode,
  TokenPlatform,
  TokenType,
} from 'src/database/schemas/device-token.schema';
import {
  Notification,
  NotificationDocument,
  NotificationPriority,
  NotificationStatus,
  PRIORITY_WEIGHT,
} from 'src/database/schemas/notification.schema';
import { RedisService } from 'src/redis/redis.service';
import { NotificationProducer } from './notification.producer';
import {
  BROADCAST_COOLDOWN_SECONDS,
  BROADCAST_RATE_KEY,
} from './constants';

export interface RegisterTokenInput {
  token: string;
  platform: 'ios' | 'android';
  tokenType: 'apns' | 'fcm' | 'expo';
  tokenMode?: 'prod' | 'dev';
  appVersion?: string;
  appBuild?: string;
  appBundle?: string;
}

export interface SendNotificationInput {
  title: string;
  body: string;
  data?: Record<string, string>;
  deepLink?: string;
  imageUrl?: string;
  priority?: 'low' | 'normal' | 'high';
  targetUserIds?: string[];
  topic?: string;
  isBroadcast?: boolean;
  scheduledAt?: string;
}

@Injectable()
export class NotificationService {
  constructor(
    @InjectModel(DeviceToken.name)
    private readonly tokenModel: Model<DeviceTokenDocument>,
    @InjectModel(Notification.name)
    private readonly notifModel: Model<NotificationDocument>,
    private readonly redis: RedisService,
    private readonly producer: NotificationProducer,
    @Inject(WINSTON_MODULE_PROVIDER) private readonly logger: Logger,
  ) {}

  async registerToken(
    userId: string,
    input: RegisterTokenInput,
  ): Promise<{ message: string }> {
    const existing = await this.tokenModel.findOne({ token: input.token });

    if (existing) {
      existing.userId = new Types.ObjectId(userId);
      existing.platform = input.platform as TokenPlatform;
      existing.tokenType = input.tokenType as TokenType;
      existing.tokenMode = (input.tokenMode ?? 'prod') as TokenMode;
      existing.appVersion = input.appVersion;
      existing.appBuild = input.appBuild;
      existing.appBundle = input.appBundle;
      existing.isActive = true;
      existing.failureCount = 0;
      existing.deactivationReason = undefined;
      await existing.save();

      this.logger.info('Device token re-registered', {
        service: 'NotificationService',
        userId,
        platform: input.platform,
      });
      return { message: 'Token updated' };
    }

    await this.tokenModel.create({
      userId: new Types.ObjectId(userId),
      token: input.token,
      platform: input.platform,
      tokenType: input.tokenType,
      tokenMode: input.tokenMode ?? 'prod',
      appVersion: input.appVersion,
      appBuild: input.appBuild,
      appBundle: input.appBundle,
    });

    this.logger.info('Device token registered', {
      service: 'NotificationService',
      userId,
      platform: input.platform,
    });
    return { message: 'Token registered' };
  }

  async unregisterToken(
    userId: string,
    token: string,
  ): Promise<{ message: string }> {
    const result = await this.tokenModel.updateOne(
      { userId: new Types.ObjectId(userId), token },
      {
        $set: {
          isActive: false,
          deactivationReason: 'user_disabled',
          lastFailureAt: new Date(),
        },
      },
    );

    if (result.matchedCount === 0) {
      throw new NotFoundException('Token not found for this user');
    }

    return { message: 'Token unregistered' };
  }

  async unregisterAllTokens(userId: string): Promise<{ count: number }> {
    const result = await this.tokenModel.updateMany(
      { userId: new Types.ObjectId(userId), isActive: true },
      {
        $set: {
          isActive: false,
          deactivationReason: 'user_disabled_all',
          lastFailureAt: new Date(),
        },
      },
    );
    return { count: result.modifiedCount };
  }

  async send(
    input: SendNotificationInput,
    createdBy?: string,
  ): Promise<{ notificationId: string; message: string }> {
    if (
      !input.isBroadcast &&
      (!input.targetUserIds || input.targetUserIds.length === 0) &&
      !input.topic
    ) {
      throw new BadRequestException(
        'Must specify targetUserIds, topic, or set isBroadcast = true',
      );
    }

    if (input.isBroadcast) {
      const lastBroadcast = await this.redis.get<number>(BROADCAST_RATE_KEY);
      if (lastBroadcast) {
        const elapsed = (Date.now() - lastBroadcast) / 1000;
        if (elapsed < BROADCAST_COOLDOWN_SECONDS) {
          throw new ConflictException(
            `Broadcast cooldown: wait ${Math.ceil(BROADCAST_COOLDOWN_SECONDS - elapsed)}s before sending another broadcast`,
          );
        }
      }
      await this.redis.set(
        BROADCAST_RATE_KEY,
        Date.now(),
        BROADCAST_COOLDOWN_SECONDS,
      );
    }

    const priority = (input.priority ?? 'normal') as NotificationPriority;

    const notif = await this.notifModel.create({
      title: input.title,
      body: input.body,
      data: input.data,
      deepLink: input.deepLink,
      imageUrl: input.imageUrl,
      priority,
      priorityWeight: PRIORITY_WEIGHT[priority] ?? 1,
      targetUserIds:
        input.targetUserIds?.map((id) => new Types.ObjectId(id)) ?? [],
      topic: input.topic,
      isBroadcast: input.isBroadcast ?? false,
      scheduledAt: input.scheduledAt ? new Date(input.scheduledAt) : undefined,
      createdBy: createdBy ? new Types.ObjectId(createdBy) : undefined,
      status: NotificationStatus.QUEUED,
    });


    const delayMs = input.scheduledAt
      ? Math.max(0, new Date(input.scheduledAt).getTime() - Date.now())
      : 0;

    await this.producer.enqueueNotification(
      String(notif._id),
      priority,
      delayMs > 0 ? delayMs : undefined,
    );

    this.logger.info('Notification queued to BullMQ', {
      service: 'NotificationService',
      notificationId: notif._id,
      isBroadcast: input.isBroadcast,
      targetCount: input.targetUserIds?.length ?? 'broadcast',
      scheduled: !!input.scheduledAt,
    });

    return {
      notificationId: String(notif._id),
      message: input.scheduledAt
        ? `Notification scheduled for ${input.scheduledAt}`
        : 'Notification queued for delivery',
    };
  }

  async sendToUser(
    userId: string,
    title: string,
    body: string,
    data?: Record<string, string>,
    deepLink?: string,
  ): Promise<{ notificationId: string }> {
    const result = await this.send({
      title,
      body,
      data,
      deepLink,
      targetUserIds: [userId],
      priority: 'high',
    });
    return { notificationId: result.notificationId };
  }

  async getNotificationById(id: string): Promise<NotificationDocument> {
    const notif = await this.notifModel.findById(id).exec();
    if (!notif) throw new NotFoundException('Notification not found');
    return notif;
  }

  async getNotifications(
    page = 1,
    limit = 20,
    status?: NotificationStatus,
  ): Promise<{
    notifications: NotificationDocument[];
    total: number;
    page: number;
    pages: number;
  }> {
    const filter: any = {};
    if (status) filter.status = status;

    const [notifications, total] = await Promise.all([
      this.notifModel
        .find(filter)
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .exec(),
      this.notifModel.countDocuments(filter),
    ]);

    return {
      notifications,
      total,
      page,
      pages: Math.ceil(total / limit),
    };
  }

  async getStats(): Promise<{
    totalTokens: number;
    activeTokens: number;
    iosTokens: number;
    androidTokens: number;
    queuedNotifications: number;
    sentToday: number;
    queue: {
      waiting: number;
      active: number;
      completed: number;
      failed: number;
      delayed: number;
    };
  }> {
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);

    const [
      totalTokens,
      activeTokens,
      iosTokens,
      androidTokens,
      queuedNotifications,
      sentToday,
      queueStats,
    ] = await Promise.all([
      this.tokenModel.countDocuments(),
      this.tokenModel.countDocuments({ isActive: true }),
      this.tokenModel.countDocuments({ isActive: true, platform: 'ios' }),
      this.tokenModel.countDocuments({ isActive: true, platform: 'android' }),
      this.notifModel.countDocuments({
        status: {
          $in: [NotificationStatus.QUEUED, NotificationStatus.PROCESSING],
        },
      }),
      this.notifModel.countDocuments({
        status: {
          $in: [NotificationStatus.SENT, NotificationStatus.PARTIALLY_SENT],
        },
        completedAt: { $gte: todayStart },
      }),
      this.producer.getQueueStats(),
    ]);

    return {
      totalTokens,
      activeTokens,
      iosTokens,
      androidTokens,
      queuedNotifications,
      sentToday,
      queue: queueStats,
    };
  }
}