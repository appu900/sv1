import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

@Schema({ timestamps: { createdAt: true, updatedAt: false } })
export class ChefFavourite {
  @Prop({ type: Types.ObjectId, ref: 'User', required: true, index: true })
  userId: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'ChefProfile', required: true, index: true })
  chefId: Types.ObjectId;

  @Prop({ type: Date, default: Date.now })
  createdAt: Date;
}

export type ChefFavouriteDocument = ChefFavourite & Document;
export const ChefFavouriteSchema = SchemaFactory.createForClass(ChefFavourite);

ChefFavouriteSchema.index({ userId: 1, chefId: 1 }, { unique: true });
ChefFavouriteSchema.index({ userId: 1, createdAt: -1 });
