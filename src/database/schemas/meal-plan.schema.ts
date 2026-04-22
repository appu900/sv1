import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export enum MealPlanStatus {
  ACTIVE = 'active',
  ARCHIVED = 'archived',
  CREATED = 'created',
  STARTED = 'started',
  COMPLETED = 'completed',
}

export enum MealPlanDuration {
  THREE = '3',
  FIVE = '5',
  SEVEN = '7',
  CUSTOM = 'custom',
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

@Schema({ _id: false })
export class MealPlanRecipe {
  @Prop({ type: Types.ObjectId, ref: 'Recipe', required: true })
  recipeId: Types.ObjectId;

  @Prop({ type: Number, required: true, min: 0 })
  dayIndex: number;

  @Prop({ type: String, required: true })
  mealSlot: string;

  @Prop({ type: Boolean, default: false })
  isCooked: boolean;

  @Prop({ type: Boolean, default: false })
  isSwapped: boolean;

  @Prop({ type: Date })
  cookedAt?: Date;
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

  @Prop({
    type: String,
    enum: Object.values(MealPlanDuration),
    index: true,
  })
  duration?: MealPlanDuration;

  @Prop({ type: Number, min: 1, max: 60 })
  customDurationDays?: number;

  @Prop({ type: String, default: 'unspecified', index: true })
  planType: string;

  @Prop({ type: [MealPlanRecipe], default: [] })
  recipes: MealPlanRecipe[];

  @Prop({ type: Date })
  startedAt?: Date;

  @Prop({ type: Date })
  completedAt?: Date;
}

export type MealPlanDocument = MealPlan & Document;
export const MealPlanSchema = SchemaFactory.createForClass(MealPlan);

MealPlanSchema.index({ userId: 1, createdAt: -1 });
MealPlanSchema.index({ planType: 1, createdAt: -1 });
MealPlanSchema.index({ status: 1, createdAt: -1 });
