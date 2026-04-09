import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

/**
 * A private food entry owned by a single user.
 *
 * This is the flexibility escape hatch for the calorie tracker. When a user
 * eats something that isn't — and shouldn't be — in the global catalog
 * (e.g. "Mum's rajma", "Cafeteria thali Tuesday"), they define it once here
 * and reuse it from their log forever.
 *
 * Nutrition can be provided in EITHER form and the service resolves to a
 * canonical per100g representation at read time:
 *   - per100g: classic "nutrition label" style
 *   - perServing + servingGrams: convenient when users only know "this bowl
 *     is ~450 kcal"
 *
 * At least one of (per100g, perServing) must be present — enforced in the
 * service layer, not via a Mongoose validator, so we can return a
 * friendlier 400 response.
 */

@Schema({ _id: false })
export class CustomFoodNutrition {
  @Prop({ required: true, min: 0 })
  kcal: number;

  @Prop({ default: 0, min: 0 })
  protein_g: number;

  @Prop({ default: 0, min: 0 })
  carbs_g: number;

  @Prop({ default: 0, min: 0 })
  fat_g: number;

  @Prop({ default: 0, min: 0 })
  fiber_g: number;

  @Prop({ default: 0, min: 0 })
  sugar_g: number;

  @Prop({ default: 0, min: 0 })
  sodium_mg: number;
}
export const CustomFoodNutritionSchema =
  SchemaFactory.createForClass(CustomFoodNutrition);

@Schema({ timestamps: true, collection: 'user_custom_foods' })
export class UserCustomFood {
  @Prop({ type: Types.ObjectId, ref: 'User', required: true, index: true })
  userId: Types.ObjectId;

  /** Human-readable name, as the user typed it. */
  @Prop({ required: true, trim: true, maxlength: 120 })
  name: string;

  /** Lower-cased name for duplicate detection + search. */
  @Prop({ required: true, trim: true, lowercase: true, maxlength: 120 })
  normalizedName: string;

  /** Label for the default serving, e.g. "1 bowl", "1 small plate". */
  @Prop({ required: true, trim: true, maxlength: 60 })
  servingLabel: string;

  /** Grams in one serving, if the user knows. Optional — many won't. */
  @Prop({ type: Number, min: 0, default: null })
  servingGrams?: number | null;

  /** Per-100g nutrition facts, if provided. */
  @Prop({ type: CustomFoodNutritionSchema, default: null })
  per100g?: CustomFoodNutrition | null;

  /** Per-serving nutrition facts, if provided. */
  @Prop({ type: CustomFoodNutritionSchema, default: null })
  perServing?: CustomFoodNutrition | null;

  @Prop({ trim: true, maxlength: 500, default: '' })
  notes: string;

  /** Source of the numbers — lets the UI show a confidence chip. */
  @Prop({
    type: String,
    enum: ['user_entered', 'ai_estimated', 'label_ocr', 'photo_ai'],
    default: 'user_entered',
  })
  origin: 'user_entered' | 'ai_estimated' | 'label_ocr' | 'photo_ai';

  /** URL of the user's photo (S3), only set for photo-based entries. */
  @Prop({ type: String, default: null, maxlength: 500 })
  imageUrl?: string | null;

  @Prop({ default: true })
  isActive: boolean;
}

export type UserCustomFoodDocument = UserCustomFood & Document;
export const UserCustomFoodSchema =
  SchemaFactory.createForClass(UserCustomFood);

// One normalized name per user (soft-dedupe).
UserCustomFoodSchema.index(
  { userId: 1, normalizedName: 1 },
  { unique: true, name: 'user_custom_food_unique_per_user' },
);

// Fast listing, newest first.
UserCustomFoodSchema.index({ userId: 1, isActive: 1, updatedAt: -1 });
