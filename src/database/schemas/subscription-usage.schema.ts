import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

@Schema({ timestamps: true })
export class SubscriptionUsage {
  @Prop({ type: Types.ObjectId, ref: 'User', required: true, index: true })
  userId: Types.ObjectId;

  @Prop({ required: true, index: true })
  periodKey: string;

  @Prop({ default: 0 })
  aiMealsUsed: number;

  @Prop({ default: 0 })
  ingredientsCount: number;

  @Prop({ default: 0 })
  cookbooksCount: number;

  @Prop({ default: 0 })
  shoppingListsCount: number;

  @Prop({ default: 0 })
  kitchenScansUsed: number;

  @Prop({ required: true })
  periodStart: Date;

  @Prop({ required: true })
  periodEnd: Date;
}

export type SubscriptionUsageDocument = SubscriptionUsage & Document;
export const SubscriptionUsageSchema =
  SchemaFactory.createForClass(SubscriptionUsage);

SubscriptionUsageSchema.index({ userId: 1, periodKey: 1 }, { unique: true });
