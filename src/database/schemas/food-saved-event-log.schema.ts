import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';


@Schema({ timestamps: { createdAt: true, updatedAt: false } })
export class FoodSavedEventLog {
  @Prop({ type: Types.ObjectId, ref: 'User', required: true, index: true })
  userId: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'Recipe', default: null, index: true })
  frameworkId: Types.ObjectId | null;

  @Prop({ type: [{ type: Types.ObjectId, ref: 'Ingredient' }], default: [] })
  ingredientIds: Types.ObjectId[];

  @Prop({ type: Number, default: 0, min: 0 })
  foodSavedInGrams: number;

  @Prop({ type: Number, default: 0, min: 0 })
  moneySaved: number;

  @Prop({ type: String, default: null })
  currency: string | null;

  @Prop({ type: Number, default: 0, min: 0 })
  co2SavedInGrams: number;

  @Prop({ type: String, default: null, index: true })
  country: string | null;

  @Prop({ type: String, default: null })
  idempotencyKey: string | null;

  @Prop({ type: Date, default: Date.now, index: true })
  createdAt: Date;
}

export type FoodSavedEventLogDocument = FoodSavedEventLog & Document;
export const FoodSavedEventLogSchema =
  SchemaFactory.createForClass(FoodSavedEventLog);

FoodSavedEventLogSchema.index({ userId: 1, createdAt: -1 });
FoodSavedEventLogSchema.index({ frameworkId: 1, createdAt: -1 });
FoodSavedEventLogSchema.index({ userId: 1, frameworkId: 1, createdAt: -1 });
FoodSavedEventLogSchema.index(
  { userId: 1, idempotencyKey: 1 },
  { unique: true, partialFilterExpression: { idempotencyKey: { $type: 'string' } } },
);
