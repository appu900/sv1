import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export enum RecipeViewSource {
  SEARCH = 'search',
  RECOMMENDATION = 'recommendation',
  MEALPLAN = 'mealplan',
  LEFTOVER = 'leftover',
  COOKBOOK = 'cookbook',
  INVENTORY = 'inventory',
  SHARED = 'shared',
  OTHER = 'other',
}

@Schema({ timestamps: false })
export class RecipeView {
  @Prop({ type: Types.ObjectId, ref: 'Recipe', required: true, index: true })
  recipeId: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'User', required: true, index: true })
  userId: Types.ObjectId;

  @Prop({
    type: String,
    enum: Object.values(RecipeViewSource),
    default: RecipeViewSource.OTHER,
    index: true,
  })
  source: RecipeViewSource;

  @Prop({ type: Date, default: Date.now, index: true })
  viewedAt: Date;
}

export type RecipeViewDocument = RecipeView & Document;
export const RecipeViewSchema = SchemaFactory.createForClass(RecipeView);

RecipeViewSchema.index({ recipeId: 1, viewedAt: -1 });
RecipeViewSchema.index({ userId: 1, viewedAt: -1 });
RecipeViewSchema.index({ recipeId: 1, userId: 1, viewedAt: -1 });
