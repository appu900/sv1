import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export enum PerksMembershipStatus {
  ACTIVE = 'active',
  PENDING = 'pending',
  FAILED = 'failed',
  UNKNOWN = 'unknown',
  CANCELLED = 'cancelled',
}

export enum PerksMembershipPlan {
  FREE = 'free',
  FREE_REGION = 'free_region',
  PAID = 'paid',
}

export enum PerksBillingStatus {
  NONE = 'none',
  INCOMPLETE = 'incomplete',
  ACTIVE = 'active',
  PAST_DUE = 'past_due',
  CANCELED = 'canceled',
}

@Schema({ timestamps: true })
export class PerksMembership {
  @Prop({ type: Types.ObjectId, ref: 'User', required: true, unique: true })
  userId: Types.ObjectId;

  @Prop({ required: true, lowercase: true, trim: true, index: true })
  email: string;

  @Prop({ type: String, default: null })
  wmadUserId: string | null;

  @Prop({
    type: String,
    enum: PerksMembershipStatus,
    default: PerksMembershipStatus.PENDING,
  })
  status: PerksMembershipStatus;

  @Prop({ type: Date, default: null })
  registeredAt: Date | null;

  @Prop({ type: String, default: null })
  lastErrorCode: string | null;

  @Prop({ type: String, default: null })
  lastErrorMessage: string | null;

 
  @Prop({ type: Number, default: 1 })
  credentialVersion: number;

  @Prop({ type: String, default: null, lowercase: true, trim: true })
  wmadEmail: string | null;

  @Prop({
    type: String,
    enum: PerksMembershipPlan,
    default: PerksMembershipPlan.FREE,
  })
  plan: PerksMembershipPlan;

  @Prop({ type: Date, default: null })
  cancelledAt: Date | null;

  @Prop({ type: String, default: null })
  cancellationReason: string | null;

  @Prop({ type: Date, default: null })
  accessEndsAt: Date | null;

  @Prop({ type: String, default: null, index: true })
  stripeCustomerId: string | null;

  @Prop({ type: String, default: null, index: true })
  stripeSubscriptionId: string | null;

  @Prop({
    type: String,
    enum: PerksBillingStatus,
    default: PerksBillingStatus.NONE,
  })
  billingStatus: PerksBillingStatus;

  @Prop({ type: Boolean, default: false })
  cancelAtPeriodEnd: boolean;

  @Prop({ type: String, default: null })
  lastStripeEventId: string | null;

  @Prop({ type: Date, default: null })
  lastStripeEventAt: Date | null;
}

export type PerksMembershipDocument = PerksMembership & Document;
export const PerksMembershipSchema =
  SchemaFactory.createForClass(PerksMembership);
