import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export enum PerksCartStatus {
  ACTIVE = 'active',
  CHECKING_OUT = 'checking_out',
  CHECKED_OUT = 'checked_out',
}

@Schema({ _id: false })
export class PerksCartItem {
  @Prop({ required: true })
  itemId: string;

  @Prop({ required: true })
  ecardId: string;

  @Prop({ required: true, min: 1 })
  quantity: number;

  @Prop({ required: true, min: 1 })
  faceValueCents: number;

  @Prop({ type: Boolean, default: false })
  sendAsGift: boolean;

  @Prop({ type: Object, default: null })
  gift: Record<string, string> | null;
}

export const PerksCartItemSchema = SchemaFactory.createForClass(PerksCartItem);

@Schema({ timestamps: true })
export class PerksCart {
  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  userId: Types.ObjectId;

  @Prop({
    type: String,
    enum: PerksCartStatus,
    default: PerksCartStatus.ACTIVE,
  })
  status: PerksCartStatus;

  @Prop({ type: [PerksCartItemSchema], default: [] })
  items: PerksCartItem[];

  @Prop({ type: String, default: null })
  checkoutIdempotencyKey: string | null;

  @Prop({ type: Types.ObjectId, ref: 'PerksOrder', default: null })
  orderId: Types.ObjectId | null;

  @Prop({ type: Date, default: null })
  checkedOutAt: Date | null;
}

export type PerksCartDocument = PerksCart & Document;
export const PerksCartSchema = SchemaFactory.createForClass(PerksCart);

PerksCartSchema.index(
  { userId: 1 },
  {
    unique: true,
    partialFilterExpression: {
      status: {
        $in: [PerksCartStatus.ACTIVE, PerksCartStatus.CHECKING_OUT],
      },
    },
  },
);
PerksCartSchema.index({ userId: 1, createdAt: -1 });
