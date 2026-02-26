import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types, Schema as MongooseSchema } from 'mongoose';

export enum QantasAllocationStatus {
  PENDING = 'pending',
  ACCEPTED = 'accepted',
  REJECTED = 'rejected',
  USER_ALREADY_CLAIMED = 'user_already_claimed',
  FAILED = 'failed',
}

@Schema({ timestamps: true })
export class QantasPointsAllocation {
  @Prop({ type: Types.ObjectId, ref: 'QantasFFN', required: true, index: true })
  userQantasProfileId: Types.ObjectId;

  @Prop({ required: true, default: 'challenge_complete' })
  reason: string;

  @Prop({ type: [String], default: [] })
  referenceIds: string[];

  @Prop({
    type: String,
    enum: QantasAllocationStatus,
    default: QantasAllocationStatus.PENDING,
  })
  status: QantasAllocationStatus;

  @Prop({ type: Date, default: null })
  processedAt: Date | null;

  @Prop({ type: MongooseSchema.Types.Mixed, default: null })
  qantasResponse: Record<string, any> | null;

  @Prop({ default: false })
  isDeleted: boolean;

  @Prop({ default: 0 })
  retryCount: number;
}

export type QantasPointsAllocationDocument = QantasPointsAllocation & Document;
export const QantasPointsAllocationSchema =
  SchemaFactory.createForClass(QantasPointsAllocation);

QantasPointsAllocationSchema.index({ status: 1, isDeleted: 1 });
QantasPointsAllocationSchema.index({ userQantasProfileId: 1, isDeleted: 1 });
