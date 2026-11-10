import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

/**
 * Derived subscription history for the admin Subscriptions dashboard.
 * Rebuilt in full by SubscriptionAnalyticsService from RevenueCat, the raw
 * webhook log (`revenuecatevents`) and the subscription rows. Every row is
 * tagged with the `runId` that produced it; readers use the latest
 * successful run in `subscription_analytics_runs`, so a rebuild swaps data
 * atomically and is reproducible after a backfill.
 */

const MoneyShape = {
  gross: { type: Number, default: null },
  tax: { type: Number, default: null },
  commission: { type: Number, default: null },
  proceeds: { type: Number, default: null },
};

@Schema({ collection: 'subscription_periods', timestamps: false, versionKey: false })
export class SubscriptionPeriod {
  @Prop({ required: true, index: true }) runId: string;
  @Prop({ type: Types.ObjectId, required: true, index: true }) userId: Types.ObjectId;
  @Prop({ required: true }) plan: string;
  @Prop({ required: true }) kind: string;
  @Prop({ required: true }) store: string;
  @Prop({ type: String, default: null }) productId: string | null;
  @Prop({ type: String, default: null }) billingPeriod: string | null;
  @Prop({ required: true }) startAt: Date;
  @Prop({ required: true }) endAt: Date;
  @Prop({ default: false }) isActive: boolean;
  @Prop({ required: true }) startReason: string;
  @Prop({ type: String, default: null }) endReason: string | null;
  @Prop({ type: Date, default: null }) cancelRequestedAt: Date | null;
  @Prop({ default: false }) isFirstPaid: boolean;
  @Prop({ type: [String], default: [] }) transactionKeys: string[];
  @Prop({ required: true }) source: string;
  @Prop({ type: String, default: null }) country: string | null;
}
export type SubscriptionPeriodDocument = SubscriptionPeriod & Document;
export const SubscriptionPeriodSchema = SchemaFactory.createForClass(SubscriptionPeriod);
SubscriptionPeriodSchema.index({ runId: 1, startAt: 1 });

@Schema({ collection: 'subscription_transactions', timestamps: false, versionKey: false })
export class SubscriptionTransaction {
  @Prop({ required: true, index: true }) runId: string;
  @Prop({ required: true }) key: string;
  @Prop({ type: Types.ObjectId, required: true, index: true }) userId: Types.ObjectId;
  @Prop({ type: String, default: null }) rcSubscriptionId: string | null;
  @Prop({ type: String, default: null }) originalTransactionId: string | null;
  @Prop({ required: true }) productId: string;
  @Prop({ required: true }) plan: string;
  @Prop({ required: true }) billingPeriod: string;
  @Prop({ required: true }) store: string;
  @Prop({ required: true }) kind: string;
  @Prop({ required: true }) startAt: Date;
  @Prop({ required: true }) endAt: Date;
  @Prop({ required: true }) effectiveEndAt: Date;
  @Prop({ type: String, default: null }) currency: string | null;
  @Prop({ type: MoneyShape, _id: false }) local: Record<string, number | null>;
  @Prop({ type: MoneyShape, _id: false }) usd: Record<string, number | null>;
  @Prop({ type: MoneyShape, _id: false }) aud: Record<string, number | null>;
  @Prop({ required: true }) fxMethod: string;
  @Prop({ default: false }) refunded: boolean;
  @Prop({ type: Date, default: null }) refundedAt: Date | null;
  @Prop({ required: true }) source: string;
  @Prop({ type: String, default: null }) country: string | null;
  @Prop({ type: String, default: null }) offeringId: string | null;
  @Prop({ type: String, default: null }) autoRenewalStatus: string | null;
}
export type SubscriptionTransactionDocument = SubscriptionTransaction & Document;
export const SubscriptionTransactionSchema = SchemaFactory.createForClass(SubscriptionTransaction);
SubscriptionTransactionSchema.index({ runId: 1, key: 1 }, { unique: true });
SubscriptionTransactionSchema.index({ runId: 1, startAt: 1 });

@Schema({ collection: 'subscription_daily_states', timestamps: false, versionKey: false })
export class SubscriptionDailyState {
  @Prop({ required: true }) runId: string;
  /** Reporting-timezone calendar day, YYYY-MM-DD. */
  @Prop({ required: true }) date: string;
  @Prop({ type: Types.ObjectId, required: true }) userId: Types.ObjectId;
  @Prop({ required: true }) state: string;
  @Prop({ required: true }) plan: string;
  @Prop({ type: String, default: null }) billingPeriod: string | null;
  @Prop({ required: true }) store: string;
  @Prop({ type: Number, default: null }) mrrGrossAud: number | null;
  @Prop({ type: Number, default: null }) mrrExTaxAud: number | null;
  @Prop({ type: Number, default: null }) mrrNetAud: number | null;
  @Prop({ type: String, default: null }) firstPaidDate: string | null;
  @Prop({ required: true }) source: string;
}
export type SubscriptionDailyStateDocument = SubscriptionDailyState & Document;
export const SubscriptionDailyStateSchema = SchemaFactory.createForClass(SubscriptionDailyState);
SubscriptionDailyStateSchema.index({ runId: 1, date: 1 });
SubscriptionDailyStateSchema.index({ runId: 1, userId: 1, date: 1 }, { unique: true });

@Schema({ collection: 'subscription_analytics_runs', timestamps: false, versionKey: false })
export class SubscriptionAnalyticsRun {
  @Prop({ required: true, unique: true }) runId: string;
  @Prop({ required: true }) status: 'running' | 'success' | 'failed';
  @Prop({ required: true }) trigger: string;
  @Prop({ required: true }) startedAt: Date;
  @Prop({ type: Date, default: null }) finishedAt: Date | null;
  @Prop({ type: Number, default: null }) durationMs: number | null;
  @Prop({ type: Object, default: {} }) settings: Record<string, unknown>;
  @Prop({ type: Object, default: {} }) counts: Record<string, unknown>;
  @Prop({ type: Object, default: {} }) quality: Record<string, unknown>;
  @Prop({ type: String, default: null }) error: string | null;
}
export type SubscriptionAnalyticsRunDocument = SubscriptionAnalyticsRun & Document;
export const SubscriptionAnalyticsRunSchema = SchemaFactory.createForClass(SubscriptionAnalyticsRun);
SubscriptionAnalyticsRunSchema.index({ status: 1, finishedAt: -1 });
