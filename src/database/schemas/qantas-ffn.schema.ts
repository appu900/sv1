import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types, Schema as MongooseSchema } from 'mongoose';

export enum QantasLinkStatus {
  ACTIVE = 'active',
  FAILED = 'failed',
  UNLINKED = 'unlinked',
}

@Schema({ timestamps: true })
export class QantasFFN {
  @Prop({ type: Types.ObjectId, ref: 'User', required: true, index: true })
  userId: Types.ObjectId;

  @Prop({ required: true })
  memberId: string;

  @Prop({ required: true })
  surname: string;

  @Prop({ default: false })
  isLinked: boolean;

  @Prop({ type: String, enum: QantasLinkStatus, default: QantasLinkStatus.FAILED })
  linkStatus: QantasLinkStatus;

  @Prop({ type: MongooseSchema.Types.Mixed, default: null })
  linkResponse: Record<string, any> | null;

  @Prop({ type: Date, default: null })
  linkedAt: Date | null;

  @Prop({ default: false })
  isRewarded: boolean;

  @Prop({ default: false })
  isDeleted: boolean;

  @Prop({ type: Date, default: null })
  expirationDate: Date | null;

  @Prop({ type: Date, default: null })
  loyaltyApiContactedAt: Date | null;

  @Prop({ default: 0 })
  surveysCompletedSinceLink: number;

  @Prop({ default: 0 })
  totalPointsAwarded: number;

  @Prop({ default: false })
  greenTierUnlocked: boolean;
}

export type QantasFFNDocument = QantasFFN & Document;
export const QantasFFNSchema = SchemaFactory.createForClass(QantasFFN);

QantasFFNSchema.index({ userId: 1, isDeleted: 1 });
QantasFFNSchema.index({ memberId: 1 });
QantasFFNSchema.index({ isLinked: 1, isRewarded: 1, isDeleted: 1 });
