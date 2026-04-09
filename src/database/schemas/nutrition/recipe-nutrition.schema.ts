import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

@Schema({ _id: false })
export class MacroNutrients {
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
export const MacroNutrientsSchema = SchemaFactory.createForClass(MacroNutrients);

@Schema({ _id: false })
export class IngredientNutrition {
  @Prop({ type: Types.ObjectId, ref: 'Ingredient', required: true })
  ingredientId: Types.ObjectId;

  @Prop({ required: true })
  name: string;

  @Prop({ required: true })
  quantity: string;

  @Prop({ type: MacroNutrientsSchema })
  nutrition: MacroNutrients;
}
export const IngredientNutritionSchema =
  SchemaFactory.createForClass(IngredientNutrition);

@Schema({ timestamps: true, collection: 'recipe_nutritions' })
export class RecipeNutrition {
  @Prop({ type: Types.ObjectId, ref: 'Recipe', required: true, unique: true })
  recipeId: Types.ObjectId;

  /** Number of servings this recipe makes (parsed from recipe.portions) */
  @Prop({ required: true, min: 1, default: 1 })
  totalServings: number;

  /** Nutrition for the entire recipe */
  @Prop({ type: MacroNutrientsSchema, required: true })
  totalNutrition: MacroNutrients;

  /** Nutrition per single serving */
  @Prop({ type: MacroNutrientsSchema, required: true })
  perServing: MacroNutrients;

  /** Estimated grams per serving */
  @Prop({ default: 0, min: 0 })
  servingGrams: number;

  /** Per-ingredient breakdown */
  @Prop({ type: [IngredientNutritionSchema], default: [] })
  ingredientBreakdown: IngredientNutrition[];

  /** AI confidence level */
  @Prop({
    type: String,
    enum: ['high', 'medium', 'low'],
    default: 'medium',
  })
  confidence: string;

  /** Hash of recipe ingredients to detect when recalculation is needed */
  @Prop({ required: true })
  ingredientHash: string;

  @Prop({ default: 'AI estimate based on IFCT / USDA references' })
  source: string;
}

export type RecipeNutritionDocument = RecipeNutrition & Document;
export const RecipeNutritionSchema =
  SchemaFactory.createForClass(RecipeNutrition);

RecipeNutritionSchema.index({ recipeId: 1 }, { unique: true });
