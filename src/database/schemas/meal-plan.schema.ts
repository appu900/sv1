import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export enum MealPlanStatus {
  ACTIVE = 'active',
  ARCHIVED = 'archived',
}

export enum MealSlotType {
  BREAKFAST = 'breakfast',
  LUNCH = 'lunch',
  SNACK = 'snack',
  DINNER = 'dinner',
}

@Schema({ _id: false })
export class MealNutritionEstimate {
  @Prop({ default: 0 })
  kcal: number;

  @Prop({ default: 0 })
  protein_g: number;

  @Prop({ default: 0 })
  carbs_g: number;

  @Prop({ default: 0 })
  fat_g: number;

  @Prop({ default: 0 })
  fiber_g: number;
}

@Schema({ _id: false })
export class PlanMeal {
  @Prop({
    type: String,
    enum: Object.values(MealSlotType),
    required: true,
  })
  slot: MealSlotType;

  @Prop({ required: true })
  title: string;

  @Prop({ default: '' })
  description: string;

  @Prop({ type: MealNutritionEstimate })
  estimatedNutrition: MealNutritionEstimate;

  @Prop({ type: [String], default: [] })
  ingredients: string[];

  @Prop({ type: [String], default: [] })
  inventoryMatches: string[];

  @Prop({ type: [String], default: [] })
  missingIngredients: string[];

  @Prop({ default: false })
  fromInventory: boolean;

  @Prop({ type: Types.ObjectId, ref: 'userRecipe' })
  generatedRecipeId?: Types.ObjectId;
}

@Schema({ _id: false })
export class PlanDay {
  @Prop({ required: true, min: 1 })
  dayNumber: number;

  @Prop()
  date?: string;

  @Prop({ required: true })
  label: string;

  @Prop({ type: [PlanMeal], default: [] })
  meals: PlanMeal[];

  @Prop({ type: MealNutritionEstimate })
  daySummary: MealNutritionEstimate;
}

@Schema({ timestamps: true })
export class MealPlan {
  @Prop({ type: Types.ObjectId, ref: 'User', required: true, index: true })
  userId: Types.ObjectId;

  @Prop({ required: true })
  title: string;

  @Prop({ required: true, min: 1, max: 14 })
  totalDays: number;

  @Prop({ type: [PlanDay], default: [] })
  days: PlanDay[];

  @Prop({ default: '' })
  healthGoal: string;

  @Prop({ default: '' })
  country: string;

  @Prop({
    type: String,
    enum: Object.values(MealPlanStatus),
    default: MealPlanStatus.ACTIVE,
    index: true,
  })
  status: MealPlanStatus;

  @Prop({ type: Number })
  targetKcal?: number;

  @Prop({ type: Object, default: {} })
  dietarySnapshot: Record<string, any>;
}

export type MealPlanDocument = MealPlan & Document;
export const MealPlanSchema = SchemaFactory.createForClass(MealPlan);
