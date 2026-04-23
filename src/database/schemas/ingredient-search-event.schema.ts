import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

@Schema({ timestamps: { createdAt: true, updatedAt: false } })
export class IngredientSearchEvent {
  @Prop({ type: Types.ObjectId, ref: 'User', required: true, index: true })
  userId: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'Ingredient', default: null, index: true })
  ingredientId: Types.ObjectId | null;

  @Prop({ type: String, default: null, maxlength: 80 })
  query: string | null;

  @Prop({ type: String, default: null })
  source: string | null;

  @Prop({ type: Date, default: Date.now, index: true })
  createdAt: Date;
}

export type IngredientSearchEventDocument = IngredientSearchEvent & Document;
export const IngredientSearchEventSchema =
  SchemaFactory.createForClass(IngredientSearchEvent);

IngredientSearchEventSchema.index({ ingredientId: 1, createdAt: -1 });
IngredientSearchEventSchema.index({ userId: 1, createdAt: -1 });
IngredientSearchEventSchema.index({ userId: 1, ingredientId: 1, createdAt: -1 });
