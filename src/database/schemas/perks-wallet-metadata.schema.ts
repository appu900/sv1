import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

@Schema({ timestamps: true })
export class PerksWalletMetadata {
  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  userId: Types.ObjectId;

  @Prop({ required: true })
  cardKey: string;

  @Prop({ type: Boolean, default: false })
  archived: boolean;

  @Prop({ type: Boolean, default: false })
  hidden: boolean;

  @Prop({ type: Date, default: null })
  archivedAt: Date | null;
}

export type PerksWalletMetadataDocument = PerksWalletMetadata & Document;
export const PerksWalletMetadataSchema =
  SchemaFactory.createForClass(PerksWalletMetadata);

PerksWalletMetadataSchema.index({ userId: 1, cardKey: 1 }, { unique: true });
PerksWalletMetadataSchema.index({ userId: 1, archived: 1, hidden: 1 });
