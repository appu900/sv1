import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export enum LogRefKind {
  FOOD = 'food',              
  CUSTOM = 'custom',          
  RECIPE = 'recipe',          
  USER_RECIPE = 'user_recipe',
  FREEFORM = 'freeform',      
}

export enum PortionMode {
  SERVING = 'serving',
  GRAMS = 'grams',     
  ML = 'ml',          
  COUNT = 'count',     
}

export enum MealSlot {
  BREAKFAST = 'breakfast',
  LUNCH = 'lunch',
  SNACK = 'snack',
  DINNER = 'dinner',
}

export enum ConfidenceLevel {
  VERIFIED = 'verified',       
  ESTIMATED = 'estimated',    
  USER_ENTERED = 'user_entered',
}

@Schema({ _id: false })
export class EntryRef {
  @Prop({ type: String, enum: LogRefKind, required: true })
  kind: LogRefKind;

  @Prop({ type: Types.ObjectId, ref: 'FoodItem', default: null })
  foodItemId?: Types.ObjectId | null;

  @Prop({ type: Types.ObjectId, ref: 'UserCustomFood', default: null })
  customFoodId?: Types.ObjectId | null;

  @Prop({ type: Types.ObjectId, ref: 'Recipe', default: null })
  recipeId?: Types.ObjectId | null;

  @Prop({ type: Types.ObjectId, ref: 'userRecipe', default: null })
  userRecipeId?: Types.ObjectId | null;

  @Prop({ type: String, trim: true, maxlength: 200, default: null })
  freeformText?: string | null;
}
export const EntryRefSchema = SchemaFactory.createForClass(EntryRef);

@Schema({ _id: false })
export class EntryPortion {
  @Prop({ type: String, enum: PortionMode, required: true })
  mode: PortionMode;

  @Prop({ type: String, trim: true, maxlength: 60, default: null })
  label?: string | null;

  @Prop({ type: Number, min: 0, default: null })
  servings?: number | null;

  @Prop({ type: Number, min: 0, default: null })
  grams?: number | null;

  @Prop({ type: Number, min: 0, default: null })
  ml?: number | null;
}
export const EntryPortionSchema = SchemaFactory.createForClass(EntryPortion);

@Schema({ _id: false })
export class EntryComputed {
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
  resolvedGrams: number;

  @Prop({
    type: String,
    enum: ConfidenceLevel,
    default: ConfidenceLevel.ESTIMATED,
  })
  confidence: ConfidenceLevel;

  @Prop({ trim: true, maxlength: 60, default: '' })
  sourceLabel: string;
}
export const EntryComputedSchema = SchemaFactory.createForClass(EntryComputed);

@Schema({ _id: false })
export class DayTotals {
  @Prop({ default: 0, min: 0 })
  kcal: number;

  @Prop({ default: 0, min: 0 })
  protein_g: number;

  @Prop({ default: 0, min: 0 })
  carbs_g: number;

  @Prop({ default: 0, min: 0 })
  fat_g: number;

  @Prop({ default: 0, min: 0 })
  fiber_g: number;
}
export const DayTotalsSchema = SchemaFactory.createForClass(DayTotals);

@Schema({ _id: false })
export class DayTargets {
  @Prop({ min: 0, default: 0 })
  kcal: number;

  @Prop({ min: 0, default: 0 })
  protein_g: number;

  @Prop({ min: 0, default: 0 })
  carbs_g: number;

  @Prop({ min: 0, default: 0 })
  fat_g: number;
}
export const DayTargetsSchema = SchemaFactory.createForClass(DayTargets);

@Schema({ timestamps: true })
export class DailyIntakeEntry {
  @Prop({ required: true, default: () => new Date() })
  at: Date;

  @Prop({ type: String, enum: MealSlot, default: null })
  mealSlot?: MealSlot | null;

  @Prop({ type: EntryRefSchema, required: true })
  ref: EntryRef;

  @Prop({ type: EntryPortionSchema, required: true })
  portion: EntryPortion;

  @Prop({ type: EntryComputedSchema, required: true })
  computed: EntryComputed;
}
export const DailyIntakeEntrySchema =
  SchemaFactory.createForClass(DailyIntakeEntry);

@Schema({ timestamps: true, collection: 'daily_intakes' })
export class DailyIntake {
  @Prop({ type: Types.ObjectId, ref: 'User', required: true, index: true })
  userId: Types.ObjectId;

  @Prop({ required: true, match: /^\d{4}-\d{2}-\d{2}$/ })
  date: string;

  @Prop({ type: [DailyIntakeEntrySchema], default: [] })
  entries: DailyIntakeEntry[];

  @Prop({ type: DayTotalsSchema, default: () => ({}) })
  totals: DayTotals;

  @Prop({ type: DayTargetsSchema, default: null })
  targets?: DayTargets | null;
}

export type DailyIntakeDocument = DailyIntake & Document;
export const DailyIntakeSchema = SchemaFactory.createForClass(DailyIntake);

DailyIntakeSchema.index(
  { userId: 1, date: 1 },
  { unique: true, name: 'daily_intake_user_date_unique' },
);
DailyIntakeSchema.index({ userId: 1, date: -1 });
