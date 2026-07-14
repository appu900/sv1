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

@Schema({ _id: false })
export class PerksOrderLine {
  @Prop({ required: true })
  lineId: string;

  @Prop({ required: true })
  idempotencyKey: string;

  @Prop({ required: true })
  orderReference: string;

  @Prop({ required: true })
  ecardId: string;

  @Prop({ required: true })
  ecardName: string;

  @Prop({ type: String, default: null })
  ecardImageUrl: string | null;

  @Prop({ required: true, min: 0 })
  faceValueCents: number;

  @Prop({ required: true, min: 0 })
  purchasePriceCents: number;

  @Prop({ required: true, min: 0 })
  deliveryFeeCents: number;

  @Prop({ required: true, min: 0 })
  totalCents: number;

  @Prop({ required: true, min: 1 })
  quantity: number;

  @Prop({ required: true, min: 0 })
  discountBps: number;

  @Prop({
    type: String,
    enum: PerksOrderStatus,
    default: PerksOrderStatus.STARTED,
  })
  status: PerksOrderStatus;

  @Prop({ type: String, default: null })
  wmadOrderNumber: string | null;

  @Prop({ type: String, default: null })
  cardUrl: string | null;

  @Prop({ type: String, default: null })
  lastErrorCode: string | null;

  @Prop({ type: String, default: null })
  lastErrorMessage: string | null;

  @Prop({ type: Date, default: null })
  completedAt: Date | null;
}

export const PerksOrderLineSchema =
  SchemaFactory.createForClass(PerksOrderLine);

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

  @Prop({ type: [PerksOrderLineSchema], default: [] })
  lines: PerksOrderLine[];

  @Prop({ type: String, default: 'AUD' })
  currency: string;

  @Prop({ type: Number, default: 0, min: 0 })
  faceValueCents: number;

  @Prop({ type: Number, default: 0, min: 0 })
  purchasePriceCents: number;

  @Prop({ type: Number, default: 0, min: 0 })
  deliveryFeeCents: number;

  @Prop({ type: Number, default: 0, min: 0 })
  totalCents: number;

  @Prop({ type: Types.ObjectId, ref: 'PerksCart', default: null })
  cartId: Types.ObjectId | null;

  @Prop({ type: Date, default: null })
  completedAt: Date | null;
}

export type PerksOrderDocument = PerksOrder & Document;
export const PerksOrderSchema = SchemaFactory.createForClass(PerksOrder);

PerksOrderSchema.index({ userId: 1, idempotencyKey: 1 }, { unique: true });
PerksOrderSchema.index({ userId: 1, createdAt: -1 });
PerksOrderSchema.index(
  { userId: 1, 'lines.wmadOrderNumber': 1 },
  { sparse: true },
);
PerksOrderSchema.index(
  { userId: 1, 'lines.idempotencyKey': 1 },
  { unique: true, sparse: true },
);
