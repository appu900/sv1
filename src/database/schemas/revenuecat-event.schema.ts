import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

/**
 * Raw log of every RevenueCat webhook event, keyed by RevenueCat's event id
 * (retries reuse it). Referral earnings are derived from this log rather than
 * from the subscription document, whose ordering filter drops late events.
 */
@Schema({ timestamps: false })
export class RevenueCatEvent {
  @Prop({ required: true, unique: true })
  eventId: string;

  @Prop({ type: String, default: null })
  type: string | null;

  @Prop({ type: String, default: null, index: true })
  appUserId: string | null;

  @Prop({ type: String, default: null })
  originalAppUserId: string | null;

  @Prop({ type: [String], default: [] })
  aliases: string[];

  @Prop({ type: String, default: null })
  transactionId: string | null;

  @Prop({ type: String, default: null, index: true })
  originalTransactionId: string | null;

  @Prop({ type: String, default: null })
  environment: string | null;

  @Prop({ type: Date, default: null })
  eventAt: Date | null;

  @Prop({ type: Object, required: true })
  payload: Record<string, any>;

  @Prop({ type: Date, required: true })
  receivedAt: Date;

  @Prop({ type: Date, default: null })
  referralProcessedAt: Date | null;

  @Prop({ type: String, default: null })
  referralError: string | null;

  @Prop({ type: Number, default: 0 })
  attempts: number;
}

export type RevenueCatEventDocument = RevenueCatEvent & Document;
export const RevenueCatEventSchema = SchemaFactory.createForClass(RevenueCatEvent);

RevenueCatEventSchema.index({ referralProcessedAt: 1, receivedAt: 1 });
