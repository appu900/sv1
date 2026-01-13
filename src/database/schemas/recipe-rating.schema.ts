import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export type RecipeRatingDocument = RecipeRating & Document;

@Schema({ timestamps: true })
export class RecipeRating {
  @Prop({ type: Types.ObjectId, ref: 'User', required: true, index: true })
  userId: Types.ObjectId;

  @Prop({ type: Types.ObjectId, required: true, index: true })
  recipeId: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'RatingTag', required: true })
  ratingTagId: Types.ObjectId;

  @Prop({ type: String })
  review?: string;
}

export const RecipeRatingSchema = SchemaFactory.createForClass(RecipeRating);

// Create compound index for user and recipe to ensure one rating per user per recipe
RecipeRatingSchema.index({ userId: 1, recipeId: 1 }, { unique: true });
