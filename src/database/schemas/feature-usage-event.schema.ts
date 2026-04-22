import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export enum FeatureKey {
  MY_KITCHEN = 'mykitchen',
  COOKBOOK = 'cookbook',
  MEAL_PLAN = 'mealplan',
  SHOPPING = 'shopping',
  LEFTOVERS = 'leftovers',
  AI = 'ai',
}

@Schema({ timestamps: false })
export class FeatureUsageEvent {
  @Prop({ type: Types.ObjectId, ref: 'User', required: true, index: true })
  userId: Types.ObjectId;

  @Prop({
    type: String,
    enum: Object.values(FeatureKey),
    required: true,
    index: true,
  })
  feature: FeatureKey;

  @Prop({ type: String, required: true, index: true })
  action: string;

  @Prop({ type: Object, default: {} })
  metadata: Record<string, any>;

  @Prop({ type: Date, default: Date.now, index: true })
  createdAt: Date;
}

export type FeatureUsageEventDocument = FeatureUsageEvent & Document;
export const FeatureUsageEventSchema =
  SchemaFactory.createForClass(FeatureUsageEvent);

FeatureUsageEventSchema.index({ userId: 1, createdAt: -1 });
FeatureUsageEventSchema.index({ feature: 1, createdAt: -1 });
FeatureUsageEventSchema.index({ feature: 1, action: 1, createdAt: -1 });
FeatureUsageEventSchema.index({ userId: 1, feature: 1, createdAt: -1 });
