import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export enum ReferralCodeStatus {
  ACTIVE = 'active',
  DISABLED = 'disabled',
}

/**
 * A chef's shareable referral code. The same code is the path of the referral
 * link (`/r/<code>`), what the QR encodes, and what a customer types manually.
 */
@Schema({ timestamps: true })
export class ReferralCode {
  /** Stored uppercase; matched case-insensitively by normalising input. */
  @Prop({ required: true, unique: true, trim: true, uppercase: true })
  code: string;

  @Prop({ type: Types.ObjectId, ref: 'User', required: true, index: true })
  chefUserId: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'ChefProfile', default: null })
  chefProfileId: Types.ObjectId | null;

  /** The code shown to the chef in the portal. One per chef. */
  @Prop({ default: true })
  isPrimary: boolean;

  @Prop({
    type: String,
    enum: ReferralCodeStatus,
    default: ReferralCodeStatus.ACTIVE,
  })
  status: ReferralCodeStatus;

  @Prop({ type: Types.ObjectId, ref: 'User', default: null })
  createdBy: Types.ObjectId | null;

  @Prop({ type: Date, default: null })
  disabledAt: Date | null;

  createdAt?: Date;
  updatedAt?: Date;
}

export type ReferralCodeDocument = ReferralCode & Document;
export const ReferralCodeSchema = SchemaFactory.createForClass(ReferralCode);

ReferralCodeSchema.index({ chefUserId: 1, isPrimary: -1, createdAt: -1 });
