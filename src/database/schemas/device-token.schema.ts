import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export enum TokenPlatform {
  IOS = 'ios',
  ANDROID = 'android',
}

export enum TokenType {
  APNS = 'apns',
  FCM = 'fcm',
  EXPO = 'expo',
}

export enum TokenMode {
  PROD = 'prod',
  DEV = 'dev',
}

@Schema({ timestamps: true })
export class DeviceToken {
  @Prop({ required: true, type: Types.ObjectId, ref: 'User', index: true })
  userId: Types.ObjectId;

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

  @Prop({ default: true, index: true })
  isActive: boolean;

  @Prop({ default: 0 })
  failureCount: number;

  @Prop()
  lastSuccessAt?: Date;

  @Prop()
  lastFailureAt?: Date;

  @Prop()
  deactivationReason?: string;
}

export type DeviceTokenDocument = DeviceToken & Document;
export const DeviceTokenSchema = SchemaFactory.createForClass(DeviceToken);

DeviceTokenSchema.index({ userId: 1, isActive: 1 });

DeviceTokenSchema.index(
  { lastFailureAt: 1 },
  {
    expireAfterSeconds: 90 * 24 * 60 * 60,
    partialFilterExpression: { isActive: false },
  },
);
