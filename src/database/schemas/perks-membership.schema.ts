import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export enum PerksMembershipStatus {
  ACTIVE = 'active',
  PENDING = 'pending',
  FAILED = 'failed',
  UNKNOWN = 'unknown',
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
}

export type PerksMembershipDocument = PerksMembership & Document;
export const PerksMembershipSchema =
  SchemaFactory.createForClass(PerksMembership);
