import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

@Schema({ timestamps: true })
export class PerksFavourite {
  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  userId: Types.ObjectId;

  @Prop({ required: true, trim: true })
  ecardId: string;
}

export type PerksFavouriteDocument = PerksFavourite & Document;
export const PerksFavouriteSchema =
  SchemaFactory.createForClass(PerksFavourite);

PerksFavouriteSchema.index({ userId: 1, ecardId: 1 }, { unique: true });
PerksFavouriteSchema.index({ userId: 1, createdAt: -1 });
