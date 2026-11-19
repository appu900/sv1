import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export type GiftPlan = 'hero' | 'legend';

/**
 * Free plan time granted by Saveful itself (not through Apple, Google or
 * RevenueCat), e.g. the Christmas Food Report thank-you. While active, the
 * user's effective plan is the higher of their store plan and the gift.
 * Store syncs and webhooks never touch this collection.
 */
@Schema({ timestamps: true, collection: 'plan_gifts' })
export class PlanGift {
  @Prop({ type: Types.ObjectId, ref: 'User', required: true, index: true })
  userId: Types.ObjectId;

  @Prop({ type: String, required: true, enum: ['hero', 'legend'] })
  plan: GiftPlan;

  /** What granted it, e.g. "christmas-2026". One gift per user per source. */
  @Prop({ type: String, required: true })
  source: string;

  @Prop({ type: Date, required: true })
  startsAt: Date;

  @Prop({ type: Date, required: true, index: true })
  expiresAt: Date;
}

export type PlanGiftDocument = PlanGift & Document;
export const PlanGiftSchema = SchemaFactory.createForClass(PlanGift);
PlanGiftSchema.index({ userId: 1, source: 1 }, { unique: true });
