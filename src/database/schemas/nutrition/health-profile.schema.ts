import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export enum Gender {
  MALE = 'male',
  FEMALE = 'female',
  OTHER = 'other',
}

export enum BodyType {
  ECTOMORPH = 'ectomorph',
  MESOMORPH = 'mesomorph',
  ENDOMORPH = 'endomorph',
}

export enum GoalType {
  MAINTAIN = 'maintain',
  LOSE_WEIGHT = 'lose_weight',
  GAIN_WEIGHT = 'gain_weight',
  HEALTH_CONDITION = 'health_condition',
}

export enum ActivityLevel {
  SEDENTARY = 'sedentary',
  LIGHT = 'light',
  MODERATE = 'moderate',
  ACTIVE = 'active',
  VERY_ACTIVE = 'very_active',
}

@Schema({ _id: false })
export class HeightData {
  @Prop({ required: true, min: 50, max: 300 })
  cm: number;

  @Prop({ min: 1, max: 9 })
  feet?: number;

  @Prop({ min: 0, max: 11 })
  inches?: number;
}
export const HeightDataSchema = SchemaFactory.createForClass(HeightData);

@Schema({ _id: false })
export class WeightData {
  @Prop({ required: true, min: 20, max: 500 })
  kg: number;

  @Prop({ min: 44, max: 1100 })
  lbs?: number;
}
export const WeightDataSchema = SchemaFactory.createForClass(WeightData);

@Schema({ _id: false })
export class HealthConditionData {
  @Prop({ type: [String], default: [] })
  conditions: string[];

  @Prop({ type: String, trim: true, maxlength: 500, default: '' })
  doctorRecommendation: string;
}
export const HealthConditionDataSchema =
  SchemaFactory.createForClass(HealthConditionData);

@Schema({ _id: false })
export class NutritionTargets {
  @Prop({ required: true, min: 800, max: 6000 })
  kcal: number;

  @Prop({ required: true, min: 0 })
  protein_g: number;

  @Prop({ required: true, min: 0 })
  carbs_g: number;

  @Prop({ required: true, min: 0 })
  fat_g: number;

  @Prop({ required: true, min: 0 })
  fiber_g: number;

  @Prop({ required: true, min: 500, max: 8000 })
  water_ml: number;
}
export const NutritionTargetsSchema =
  SchemaFactory.createForClass(NutritionTargets);

@Schema({ _id: false })
export class GoalTimeline {
  @Prop({ type: Number })
  targetWeightKg?: number;

  @Prop({ type: Number })
  startWeightKg?: number;

  @Prop({ type: Number, min: 1, max: 104 })
  estimatedWeeks?: number;

  @Prop({ type: Number })
  weeklyChangeKg?: number;

  @Prop({ type: String })
  startDate?: string;

  @Prop({ type: String })
  targetDate?: string;
}
export const GoalTimelineSchema = SchemaFactory.createForClass(GoalTimeline);


@Schema({ _id: false })
export class MonthlySnapshot {
  @Prop({ required: true, match: /^\d{4}-\d{2}$/ })
  month: string; 

  @Prop({ required: true, min: 0 })
  avgDailyKcal: number;

  @Prop({ required: true, min: 0 })
  avgProtein_g: number;

  @Prop({ required: true, min: 0 })
  avgCarbs_g: number;

  @Prop({ required: true, min: 0 })
  avgFat_g: number;

  @Prop({ required: true, min: 0 })
  avgFiber_g: number;

  @Prop({ required: true, min: 0 })
  avgWater_ml: number;

  @Prop({ required: true, min: 0 })
  daysLogged: number;

  @Prop({ required: true, min: 0 })
  daysOnTarget: number;

  @Prop({ type: Number })
  weightKg?: number;

  @Prop({ type: Number })
  bmi?: number;

  @Prop({ type: NutritionTargetsSchema })
  targetSnapshot?: NutritionTargets;

  @Prop({ type: [String], default: [] })
  aiRecommendations: string[];

  @Prop({ type: String, default: '' })
  cacheKey?: string;

  @Prop({ type: Date, default: null })
  generatedAt?: Date | null;
}
export const MonthlySnapshotSchema =
  SchemaFactory.createForClass(MonthlySnapshot);

@Schema({ timestamps: true, collection: 'health_profiles' })
export class HealthProfile {
  @Prop({ type: Types.ObjectId, ref: 'User', required: true, index: true })
  userId: Types.ObjectId;

  @Prop({ type: String, enum: Gender, required: true })
  gender: Gender;

  @Prop({ type: Number, required: true, min: 10, max: 120 })
  age: number;

  @Prop({ type: HeightDataSchema, required: true })
  height: HeightData;

  @Prop({ type: WeightDataSchema, required: true })
  weight: WeightData;

  @Prop({ type: String, enum: BodyType, required: true })
  bodyType: BodyType;

  @Prop({ type: String, enum: ActivityLevel, default: ActivityLevel.MODERATE })
  activityLevel: ActivityLevel;

  @Prop({ type: String, enum: GoalType, required: true })
  goal: GoalType;

  @Prop({ type: Number, min: 20, max: 500 })
  targetWeightKg?: number;

  @Prop({ type: HealthConditionDataSchema, default: () => ({}) })
  healthCondition: HealthConditionData;

  @Prop({ type: NutritionTargetsSchema })
  targets: NutritionTargets;

  @Prop({ type: GoalTimelineSchema })
  timeline: GoalTimeline;

  @Prop({ type: String, maxlength: 2000, default: '' })
  aiRationale: string;

  @Prop({ type: [MonthlySnapshotSchema], default: [] })
  monthlySnapshots: MonthlySnapshot[];

  @Prop({ type: Boolean, default: true })
  isActive: boolean;
}

export type HealthProfileDocument = HealthProfile & Document;
export const HealthProfileSchema = SchemaFactory.createForClass(HealthProfile);
