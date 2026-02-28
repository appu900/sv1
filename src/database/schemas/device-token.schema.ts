import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

// ─── Enums ──────────────────────────────────────────────────────────────────

export enum TokenPlatform {
  IOS = 'ios',
  ANDROID = 'android',
}

export enum TokenType {
  APNS = 'apns',
  FCM = 'fcm',
}

export enum TokenMode {
  PROD = 'prod',
  DEV = 'dev',
}

// ─── Schema ─────────────────────────────────────────────────────────────────

@Schema({ timestamps: true })
export class DeviceToken {
  @Prop({ required: true, type: Types.ObjectId, ref: 'User', index: true })
  userId: Types.ObjectId;

  /** The native APNs/FCM token string (unique per device) */
  @Prop({ required: true, unique: true })
  token: string;

  @Prop({ required: true, enum: TokenPlatform })
  platform: TokenPlatform;

  @Prop({ required: true, enum: TokenType })
  tokenType: TokenType;

  @Prop({ required: true, enum: TokenMode, default: TokenMode.PROD })
  tokenMode: TokenMode;

  @Prop()
  appVersion?: string;

  @Prop()
  appBuild?: string;

  @Prop()
  appBundle?: string;

  /** false = token is dead (unregistered / 3 consecutive failures) */
  @Prop({ default: true, index: true })
  isActive: boolean;

  /** Consecutive delivery failures — deactivated after reaching 3 */
  @Prop({ default: 0 })
  failureCount: number;

  @Prop()
  lastSuccessAt?: Date;

  @Prop()
  lastFailureAt?: Date;

  /** Why the token was deactivated (e.g. 'unregistered', 'invalid_token') */
  @Prop()
  deactivationReason?: string;
}

export type DeviceTokenDocument = DeviceToken & Document;
export const DeviceTokenSchema = SchemaFactory.createForClass(DeviceToken);

// Fast lookup: all active tokens for a user
DeviceTokenSchema.index({ userId: 1, isActive: 1 });

// Auto-cleanup: deactivated tokens are removed after 90 days
DeviceTokenSchema.index(
  { lastFailureAt: 1 },
  {
    expireAfterSeconds: 90 * 24 * 60 * 60,
    partialFilterExpression: { isActive: false },
  },
);
