import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export enum ReferralAttributionStatus {
  /** Bound to a chef; no subscription started yet. */
  BOUND = 'bound',
  TRIALING = 'trialing',
  PAYING = 'paying',
  /** Cancelled, expired or in billing trouble. Earnings resume on the next paid renewal. */
  LAPSED = 'lapsed',
  /** Voided by an admin; never earns. */
  VOID = 'void',
}

export const REFERRAL_SOURCES = [
  'link',
  'install_referrer',
  'paste',
  'manual',
  'signup',
] as const;
export type ReferralSource = (typeof REFERRAL_SOURCES)[number];

@Schema({ _id: false })
export class ReferralAttributionAudit {
  @Prop({ type: Date, required: true })
  at: Date;

  @Prop({ type: Types.ObjectId, ref: 'User', default: null })
  by: Types.ObjectId | null;

  @Prop({ required: true })
  action: string;

  @Prop({ type: Types.ObjectId, ref: 'User', default: null })
  fromChefUserId: Types.ObjectId | null;

  @Prop({ type: Types.ObjectId, ref: 'User', default: null })
  toChefUserId: Types.ObjectId | null;

  @Prop({ type: String, default: '' })
  note: string;
}

/**
 * Locks one subscriber to the chef who referred them. Created before purchase
 * so later links cannot redirect credit. Chef identifiers are snapshotted so
 * history survives chef deletion.
 */
@Schema({ timestamps: true })
export class ReferralAttribution {
  @Prop({ type: Types.ObjectId, ref: 'User', required: true, unique: true })
  subscriberUserId: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  chefUserId: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'ChefProfile', default: null })
  chefProfileId: Types.ObjectId | null;

  @Prop({ type: String, default: '' })
  chefDisplayName: string;

  @Prop({ type: Types.ObjectId, ref: 'ReferralCode', required: true })
  codeId: Types.ObjectId;

  @Prop({ required: true })
  code: string;

  @Prop({ type: String, enum: REFERRAL_SOURCES, default: 'manual' })
  source: ReferralSource;

  @Prop({ type: Date, required: true })
  boundAt: Date;

  @Prop({
    type: String,
    enum: ReferralAttributionStatus,
    default: ReferralAttributionStatus.BOUND,
  })
  status: ReferralAttributionStatus;

  @Prop({ type: String, default: null })
  store: string | null;

  @Prop({ type: String, default: null })
  productId: string | null;

  /** Store subscription id; survives RevenueCat transfers between app users. */
  @Prop({ type: String, default: null })
  originalTransactionId: string | null;

  @Prop({ type: Date, default: null })
  trialStartedAt: Date | null;

  @Prop({ type: Date, default: null })
  firstPaidAt: Date | null;

  @Prop({ type: Date, default: null })
  lastPaidAt: Date | null;

  /** Snapshot of the commission rate at bind time, in basis points. */
  @Prop({ type: Number, required: true })
  commissionRateBps: number;

  @Prop({ type: [ReferralAttributionAudit], default: [] })
  audit: ReferralAttributionAudit[];

  createdAt?: Date;
  updatedAt?: Date;
}

export type ReferralAttributionDocument = ReferralAttribution & Document;
export const ReferralAttributionSchema =
  SchemaFactory.createForClass(ReferralAttribution);

ReferralAttributionSchema.index({ chefUserId: 1, status: 1 });
ReferralAttributionSchema.index({ originalTransactionId: 1 });
ReferralAttributionSchema.index({ boundAt: -1 });
