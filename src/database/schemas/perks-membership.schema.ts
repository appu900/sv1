import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export enum PerksMembershipStatus {
  ACTIVE = 'active',
  PENDING = 'pending',
  FAILED = 'failed',
  UNKNOWN = 'unknown',
  /** User opted out. Blocks cart + checkout until resumed. */
  CANCELLED = 'cancelled',
}

export enum PerksMembershipPlan {
  /** No billing attached yet. Stripe will introduce paid plans later. */
  FREE = 'free',
  PAID = 'paid',
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

  /**
   * Bumped to rotate the derived WeMAD password (see PerksCorpSessionService).
   * The password itself is never stored.
   */
  @Prop({ type: Number, default: 1 })
  credentialVersion: number;

  /** Email actually registered upstream — may lag the Saveful email. */
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

  /**
   * When paid access lapses. Null while unbilled; Stripe will populate this so
   * a cancelled member keeps access until the period ends.
   */
  @Prop({ type: Date, default: null })
  accessEndsAt: Date | null;
}

export type PerksMembershipDocument = PerksMembership & Document;
export const PerksMembershipSchema =
  SchemaFactory.createForClass(PerksMembership);
