import { Document } from 'mongoose';
import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';

export const SAVEFUL_FOCUS_AREAS = [
  'save_money',
  'use_what_i_already_have',
  'solve_whats_for_dinner',
  'plan_meals_and_shopping',
  'healthy_eating',
  'earn_rewards',
] as const;

export const SAVEFUL_CADENCES = [
  'getting_started',
  'saveful_regular',
  'on_a_roll',
  'all_in',
] as const;

export const SAVEFUL_EXPERIENCES = ['basic', 'hero', 'legend'] as const;

export const SAVEFUL_WEEKDAYS = [
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
  'sunday',
] as const;

export type SavefulFocusArea = (typeof SAVEFUL_FOCUS_AREAS)[number];
export type SavefulCadence = (typeof SAVEFUL_CADENCES)[number];
export type SavefulExperience = (typeof SAVEFUL_EXPERIENCES)[number];
export type SavefulWeekday = (typeof SAVEFUL_WEEKDAYS)[number];

@Schema({ _id: false })
export class UserSavefulPreferences {
  @Prop({ type: [String], enum: SAVEFUL_FOCUS_AREAS, default: [] })
  focusAreas: SavefulFocusArea[];

  @Prop({ enum: SAVEFUL_CADENCES })
  cadence?: SavefulCadence;

  @Prop()
  personalPlanKey?: string;

  @Prop()
  personalPlanVersion?: number;

  @Prop({ enum: SAVEFUL_EXPERIENCES })
  recommendedExperience?: SavefulExperience;

  @Prop({ enum: SAVEFUL_EXPERIENCES })
  selectedExperience?: SavefulExperience;

  @Prop()
  onboardingArchitectureTrack?: string;

  @Prop({ enum: SAVEFUL_WEEKDAYS })
  weeklySurveyDay?: SavefulWeekday;

  @Prop()
  updatedAt?: Date;
}

export const UserSavefulPreferencesSchema =
  SchemaFactory.createForClass(UserSavefulPreferences);

export type UserSavefulPreferencesDocument = UserSavefulPreferences & Document;
