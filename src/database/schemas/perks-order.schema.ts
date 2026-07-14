import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export enum PerksOrderStatus {
  STARTED = 'started',
  PROCESSING = 'processing',
  COMPLETED = 'completed',
  REFUNDED = 'refunded',
  FAILED = 'failed',
  UNKNOWN = 'unknown',
}

@Schema({ timestamps: true })
export class PerksOrder {
  @Prop({ type: Types.ObjectId, ref: 'User', required: true, index: true })
  userId: Types.ObjectId;

  @Prop({ required: true })
  idempotencyKey: string;

  @Prop({ required: true })
  requestHash: string;

  @Prop({ required: true, unique: true })
  orderReference: string;

  @Prop({ type: String, default: null, index: true })
  wmadOrderNumber: string | null;

  @Prop({
    type: String,
    enum: PerksOrderStatus,
    default: PerksOrderStatus.STARTED,
  })
  status: PerksOrderStatus;

  @Prop({ type: String, default: null })
  cardUrl: string | null;

  @Prop({ type: String, default: null })
  receiptUrl: string | null;

  @Prop({ type: String, default: null })
  lastErrorCode: string | null;

  @Prop({ type: String, default: null })
  lastErrorMessage: string | null;
}

export type PerksOrderDocument = PerksOrder & Document;
export const PerksOrderSchema = SchemaFactory.createForClass(PerksOrder);

PerksOrderSchema.index({ userId: 1, idempotencyKey: 1 }, { unique: true });
