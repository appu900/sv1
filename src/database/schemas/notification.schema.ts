import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';


export enum NotificationStatus {
  QUEUED = 'queued',
  PROCESSING = 'processing',
  SENT = 'sent',
  PARTIALLY_SENT = 'partially_sent',
  FAILED = 'failed',
}

export enum NotificationPriority {
  LOW = 'low',
  NORMAL = 'normal',
  HIGH = 'high',
}

/** Numeric weight for DB sorting (higher = more urgent) */
export const PRIORITY_WEIGHT: Record<NotificationPriority, number> = {
  [NotificationPriority.LOW]: 0,
  [NotificationPriority.NORMAL]: 1,
  [NotificationPriority.HIGH]: 2,
};

@Schema({ timestamps: true })
export class Notification {
  @Prop({ required: true })
  title: string;

  @Prop({ required: true })
  body: string;

  @Prop({ type: Object })
  data?: Record<string, string>;

  @Prop()
  deepLink?: string;

  @Prop()
  imageUrl?: string;

  @Prop({
    required: true,
    enum: NotificationStatus,
    default: NotificationStatus.QUEUED,
    index: true,
  })
  status: NotificationStatus;

  @Prop({
    required: true,
    enum: NotificationPriority,
    default: NotificationPriority.NORMAL,
  })
  priority: NotificationPriority;

  /** Numeric weight for DB sorting — set automatically when priority is assigned */
  @Prop({ default: 1 })
  priorityWeight: number;

  @Prop({ type: [Types.ObjectId], ref: 'User', default: [] })
  targetUserIds: Types.ObjectId[];

  @Prop()
  topic?: string;

  @Prop({ default: false })
  isBroadcast: boolean;

  @Prop({ default: 0 })
  totalTargets: number;

  @Prop({ default: 0 })
  successCount: number;

  @Prop({ default: 0 })
  failureCount: number;

  @Prop({ default: 0 })
  retryCount: number;

  @Prop({ default: 3 })
  maxRetries: number;

  @Prop({ type: Date })
  nextRetryAt?: Date;

  @Prop()
  completedAt?: Date;

  @Prop({ type: Types.ObjectId, ref: 'User' })
  createdBy?: Types.ObjectId;

  @Prop({ type: Date })
  scheduledAt?: Date;

  @Prop()
  lastError?: string;

  @Prop({ type: [String], default: [] })
  failedTokens: string[];
}

export type NotificationDocument = Notification & Document;
export const NotificationSchema = SchemaFactory.createForClass(Notification);

NotificationSchema.index({ status: 1, nextRetryAt: 1 });
NotificationSchema.index({ status: 1, scheduledAt: 1 });
NotificationSchema.index({ createdAt: -1 });
NotificationSchema.index({ createdBy: 1, createdAt: -1 });
