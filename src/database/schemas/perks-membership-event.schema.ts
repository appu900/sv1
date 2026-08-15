import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export enum PerksMembershipEventType {
  REGISTERED = 'registered',
  REGISTRATION_FAILED = 'registration_failed',
  CANCELLED = 'cancelled',
  RESUMED = 'resumed',
  CHECKOUT_STARTED = 'checkout_started',
  /** Membership from the retired WeMAD product, cleared so the user re-joins. */
  LEGACY_RESET = 'legacy_reset',
}

/**
 * Append-only audit trail of membership transitions. Kept separate from the
 * membership document so history survives status changes — this is what
 * answers "when did this user join / unsubscribe / come back?".
 */
@Schema({ timestamps: { createdAt: 'at', updatedAt: false } })
export class PerksMembershipEvent {
  @Prop({ type: Types.ObjectId, ref: 'User', required: true, index: true })
  userId: Types.ObjectId;

  @Prop({ type: String, enum: PerksMembershipEventType, required: true })
  type: PerksMembershipEventType;

  @Prop({ type: Object, default: null })
  metadata: Record<string, unknown> | null;

  at?: Date;
}

export type PerksMembershipEventDocument = PerksMembershipEvent & Document;
export const PerksMembershipEventSchema = SchemaFactory.createForClass(
  PerksMembershipEvent,
);

PerksMembershipEventSchema.index({ userId: 1, at: -1 });
