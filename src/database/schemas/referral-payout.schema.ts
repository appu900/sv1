import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export enum ReferralPayoutStatus {
  DRAFT = 'draft',
  /** Chef payment details are not verified yet. */
  ON_HOLD = 'on_hold',
  APPROVED = 'approved',
  PAID = 'paid',
  VOID = 'void',
}

@Schema({ _id: false })
export class ReferralPayoutCurrencyTotal {
  @Prop({ required: true })
  currency: string;

  @Prop({ type: Number, required: true })
  commissionMinor: number;

  @Prop({ type: Number, required: true })
  entryCount: number;
}

/** One chef's quarterly referral payout. */
@Schema({ timestamps: true })
export class ReferralPayout {
  @Prop({ type: Types.ObjectId, ref: 'User', required: true, index: true })
  chefUserId: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'ChefProfile', default: null })
  chefProfileId: Types.ObjectId | null;

  @Prop({ type: String, default: '' })
  chefDisplayName: string;

  /** e.g. `2026-Q4`. Includes every unpaid entry dated before the quarter ends. */
  @Prop({ required: true, index: true })
  quarter: string;

  /**
   * `<chefUserId>:<quarter>` while the payout is live; removed on void so the
   * quarter can be regenerated. Unique among live payouts.
   */
  @Prop({ type: String })
  activeKey?: string;

  @Prop({
    type: String,
    enum: ReferralPayoutStatus,
    default: ReferralPayoutStatus.DRAFT,
  })
  status: ReferralPayoutStatus;

  @Prop({ type: [ReferralPayoutCurrencyTotal], default: [] })
  totalsByCurrency: ReferralPayoutCurrencyTotal[];

  @Prop({ type: Number, default: 0 })
  totalUsdCents: number;

  @Prop({ type: Number, default: 0 })
  entryCount: number;

  @Prop({ type: String, default: null })
  holdReason: string | null;

  @Prop({ type: Types.ObjectId, ref: 'User', default: null })
  generatedBy: Types.ObjectId | null;

  @Prop({ type: Types.ObjectId, ref: 'User', default: null })
  approvedBy: Types.ObjectId | null;

  @Prop({ type: Date, default: null })
  approvedAt: Date | null;

  @Prop({ type: Types.ObjectId, ref: 'User', default: null })
  paidBy: Types.ObjectId | null;

  @Prop({ type: Date, default: null })
  paidAt: Date | null;

  @Prop({ type: Number, default: null })
  paidAmountMinor: number | null;

  @Prop({ type: String, default: null })
  paidCurrency: string | null;

  @Prop({ type: String, default: '' })
  fxNote: string;

  @Prop({ type: String, default: '' })
  paymentReference: string;

  @Prop({ type: Types.ObjectId, ref: 'User', default: null })
  voidedBy: Types.ObjectId | null;

  @Prop({ type: Date, default: null })
  voidedAt: Date | null;

  @Prop({ type: String, default: '' })
  voidReason: string;

  @Prop({ type: Date, default: null })
  statementEmailedAt: Date | null;

  createdAt?: Date;
  updatedAt?: Date;
}

export type ReferralPayoutDocument = ReferralPayout & Document;
export const ReferralPayoutSchema = SchemaFactory.createForClass(ReferralPayout);

ReferralPayoutSchema.index({ activeKey: 1 }, { unique: true, sparse: true });
ReferralPayoutSchema.index({ quarter: 1, status: 1 });
