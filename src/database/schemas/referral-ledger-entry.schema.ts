import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export enum ReferralLedgerType {
  EARNING = 'earning',
  REVERSAL = 'reversal',
  ADJUSTMENT = 'adjustment',
}

export enum ReferralLedgerStatus {
  /** Counts toward the chef's balance; not yet in a payout. */
  PENDING = 'pending',
  /** Financial fields were missing; needs finance review before it counts. */
  HELD = 'held',
  IN_PAYOUT = 'in_payout',
  PAID = 'paid',
  /** Cancelled out by a refund before payout; never counts. */
  REVERSED = 'reversed',
}

/**
 * Append-only commission ledger. Amounts are integer minor units of
 * `currency`; reversals and negative adjustments carry negative amounts.
 */
@Schema({ timestamps: true })
export class ReferralLedgerEntry {
  @Prop({ type: String, enum: ReferralLedgerType, required: true })
  type: ReferralLedgerType;

  @Prop({ type: String, enum: ReferralLedgerStatus, required: true })
  status: ReferralLedgerStatus;

  /**
   * Uniqueness key per business fact: `earn:<transactionId>` for an earning,
   * `rev:<earningId>` for its reversal. Absent on manual adjustments.
   */
  @Prop({ type: String })
  dedupeKey?: string;

  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  chefUserId: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'ReferralAttribution', default: null })
  attributionId: Types.ObjectId | null;

  @Prop({ type: Types.ObjectId, ref: 'User', default: null })
  subscriberUserId: Types.ObjectId | null;

  @Prop({ type: String })
  rcEventId?: string;

  @Prop({ type: String, default: null })
  rcEventType: string | null;

  @Prop({ type: String, default: null })
  transactionId: string | null;

  @Prop({ type: String, default: null })
  originalTransactionId: string | null;

  @Prop({ type: String, default: null })
  store: string | null;

  @Prop({ type: String, default: 'PRODUCTION' })
  environment: string;

  @Prop({ type: String, default: null })
  productId: string | null;

  @Prop({ type: String, default: null })
  periodType: string | null;

  @Prop({ type: Number, default: null })
  renewalNumber: number | null;

  @Prop({ type: String, default: null })
  offerCode: string | null;

  @Prop({ type: String, default: null })
  currency: string | null;

  @Prop({ type: Number, default: null })
  grossMinor: number | null;

  @Prop({ type: Number, default: null })
  taxRate: number | null;

  @Prop({ type: Number, default: null })
  storeFeeRate: number | null;

  @Prop({ type: Number, default: null })
  netMinor: number | null;

  @Prop({ type: Number, required: true })
  commissionRateBps: number;

  @Prop({ type: Number, default: null })
  commissionMinor: number | null;

  @Prop({ type: Number, default: null })
  commissionUsdCents: number | null;

  @Prop({ type: Date, required: true })
  eventAt: Date;

  @Prop({ type: String, default: null })
  holdReason: string | null;

  @Prop({ type: Types.ObjectId, ref: 'ReferralLedgerEntry', default: null })
  reversesEntryId: Types.ObjectId | null;

  @Prop({ type: Types.ObjectId, ref: 'ReferralPayout', default: null })
  payoutId: Types.ObjectId | null;

  @Prop({ type: String, default: '' })
  note: string;

  @Prop({ type: Types.ObjectId, ref: 'User', default: null })
  createdBy: Types.ObjectId | null;

  @Prop({ type: Types.ObjectId, ref: 'User', default: null })
  resolvedBy: Types.ObjectId | null;

  @Prop({ type: Date, default: null })
  resolvedAt: Date | null;

  createdAt?: Date;
  updatedAt?: Date;
}

export type ReferralLedgerEntryDocument = ReferralLedgerEntry & Document;
export const ReferralLedgerEntrySchema =
  SchemaFactory.createForClass(ReferralLedgerEntry);

ReferralLedgerEntrySchema.index(
  { dedupeKey: 1 },
  { unique: true, partialFilterExpression: { dedupeKey: { $type: 'string' } } },
);
ReferralLedgerEntrySchema.index(
  { rcEventId: 1 },
  { unique: true, partialFilterExpression: { rcEventId: { $type: 'string' } } },
);
ReferralLedgerEntrySchema.index({ chefUserId: 1, status: 1, eventAt: 1 });
ReferralLedgerEntrySchema.index({ transactionId: 1 });
ReferralLedgerEntrySchema.index({ originalTransactionId: 1 });
ReferralLedgerEntrySchema.index({ payoutId: 1 });
ReferralLedgerEntrySchema.index({ status: 1, environment: 1, eventAt: 1 });
