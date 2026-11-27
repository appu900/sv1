import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

/**
 * Our copy of a member's WeMAD order, kept for reporting.
 *
 * WeMAD hosts checkout and sends no webhook, so the only place an order exists
 * is their API, readable only as that member. Every time we read a member's
 * orders (Orders screen, dashboard savings, the background sync) we upsert them
 * here, with the card's category resolved at that moment, so the admin
 * dashboard can report spend by category without calling WeMAD per member.
 *
 * Amounts are integer cents in `currency` (AUD in practice).
 */
@Schema({ _id: false })
export class PerksOrderSnapshotLine {
  @Prop({ type: String, default: '' })
  lineId: string;

  @Prop({ type: String, default: '' })
  ecardId: string;

  @Prop({ type: String, default: '' })
  ecardName: string;

  @Prop({ type: Number, default: 0 })
  faceValueCents: number;

  @Prop({ type: Number, default: 0 })
  purchasePriceCents: number;

  @Prop({ type: Number, default: 0 })
  discountCents: number;

  @Prop({ type: Number, default: 0 })
  deliveryFeeCents: number;

  @Prop({ type: Number, default: 0 })
  totalCents: number;

  @Prop({ type: String, default: 'unknown' })
  status: string;

  /** `self` or `gift`. */
  @Prop({ type: String, default: 'self' })
  purchaseType: string;

  /** WeMAD category slug / name and its parent group, when known. */
  @Prop({ type: String, default: null })
  category: string | null;

  @Prop({ type: String, default: null })
  categoryName: string | null;

  @Prop({ type: String, default: null })
  categoryGroup: string | null;

  @Prop({ type: String, default: null })
  categoryGroupName: string | null;

  /** Our own Perks category key (groceries, fuel, …) when it can be matched. */
  @Prop({ type: String, default: null })
  perksCategory: string | null;
}

export const PerksOrderSnapshotLineSchema = SchemaFactory.createForClass(
  PerksOrderSnapshotLine,
);

@Schema({ collection: 'perksordersnapshots', timestamps: true })
export class PerksOrderSnapshot {
  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  userId: Types.ObjectId;

  /** Stable key for the order: WeMAD's order reference, else number, else id. */
  @Prop({ type: String, required: true })
  orderKey: string;

  @Prop({ type: String, default: null })
  orderReference: string | null;

  @Prop({ type: String, default: null })
  orderNumber: string | null;

  @Prop({ type: String, default: 'unknown' })
  status: string;

  @Prop({ type: String, default: null })
  paymentStatus: string | null;

  @Prop({ type: String, default: 'AUD' })
  currency: string;

  /** When the member placed the order (WeMAD `created_at`). */
  @Prop({ type: Date, default: null })
  orderedAt: Date | null;

  @Prop({ type: Number, default: 0 })
  faceValueCents: number;

  @Prop({ type: Number, default: 0 })
  purchasePriceCents: number;

  @Prop({ type: Number, default: 0 })
  savingsCents: number;

  @Prop({ type: Number, default: 0 })
  deliveryFeeCents: number;

  @Prop({ type: Number, default: 0 })
  totalCents: number;

  @Prop({ type: Number, default: 0 })
  cashbackCents: number;

  @Prop({ type: [PerksOrderSnapshotLineSchema], default: [] })
  lines: PerksOrderSnapshotLine[];

  /** Last time this order was read from WeMAD. */
  @Prop({ type: Date, required: true })
  lastSyncedAt: Date;
}

export type PerksOrderSnapshotDocument = PerksOrderSnapshot & Document;
export const PerksOrderSnapshotSchema =
  SchemaFactory.createForClass(PerksOrderSnapshot);

PerksOrderSnapshotSchema.index({ userId: 1, orderKey: 1 }, { unique: true });
PerksOrderSnapshotSchema.index({ orderedAt: -1 });
