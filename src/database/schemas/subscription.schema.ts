import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';
import type {
  SubscriptionPlan,
  SubscriptionStatus,
} from '../../modules/subscription/subscription.constants';

@Schema({ timestamps: true })
export class Subscription {
  @Prop({ type: Types.ObjectId, ref: 'User', required: true, unique: true, index: true })
  userId: Types.ObjectId;

  @Prop({ type: String, required: true, default: 'basic' })
  plan: SubscriptionPlan;

  @Prop({ type: String, required: true, default: 'active' })
  status: SubscriptionStatus;

  @Prop({ index: true })
  revenueCatUserId?: string;

  @Prop()
  entitlement?: string;

  @Prop()
  productId?: string;

  @Prop()
  store?: string;

  @Prop()
  periodType?: string; 

  @Prop()
  purchasedAt?: Date;

  @Prop()
  expiresAt?: Date;

  @Prop()
  trialEndsAt?: Date;

  @Prop({ default: false })
  willRenew: boolean;

  @Prop()
  cancelledAt?: Date;

  @Prop({
    type: { hero: Date, legend: Date },
    _id: false,
    default: undefined,
  })
  trialsConsumed?: { hero?: Date; legend?: Date };

  @Prop({ type: Object })
  lastCustomerInfo?: Record<string, unknown>;

  @Prop({
    type: {
      reason: String,
      details: String,
      productId: String,
      plan: String,
      submittedAt: Date,
    },
    _id: false,
  })
  cancelFeedback?: {
    reason: string;
    details?: string;
    productId?: string;
    plan?: string;
    submittedAt: Date;
  };

  @Prop({ index: true })
  lastEventId?: string;

  @Prop()
  lastEventAt?: Date;
}

export type SubscriptionDocument = Subscription & Document;
export const SubscriptionSchema = SchemaFactory.createForClass(Subscription);
