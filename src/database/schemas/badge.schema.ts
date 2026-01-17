import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export enum BadgeCategory {
  ONBOARDING = 'ONBOARDING',
  USAGE = 'USAGE',
  COOKING = 'COOKING',
  MONEY_SAVED = 'MONEY_SAVED',
  FOOD_SAVED = 'FOOD_SAVED',
  PLANNING = 'PLANNING',
  BONUS = 'BONUS',
  SPONSOR = 'SPONSOR', 
  CHALLENGE_WINNER = 'CHALLENGE_WINNER', 
  SPECIAL = 'SPECIAL', 
}

export enum MilestoneType {

  FIRST_RECIPE_COOKED = 'FIRST_RECIPE_COOKED', 
  
  TOTAL_APP_SESSIONS_3 = 'TOTAL_APP_SESSIONS_3', 
  TOTAL_APP_SESSIONS_7 = 'TOTAL_APP_SESSIONS_7', 
  TOTAL_APP_SESSIONS_20 = 'TOTAL_APP_SESSIONS_20',
  TOTAL_APP_SESSIONS_50 = 'TOTAL_APP_SESSIONS_50', 
  
  RECIPES_COOKED_5 = 'RECIPES_COOKED_5', 
  RECIPES_COOKED_10 = 'RECIPES_COOKED_10',
  RECIPES_COOKED_25 = 'RECIPES_COOKED_25', 
  RECIPES_COOKED_50 = 'RECIPES_COOKED_50', 
  
  MONEY_SAVED_25 = 'MONEY_SAVED_25', 
  MONEY_SAVED_50 = 'MONEY_SAVED_50', 
  MONEY_SAVED_100 = 'MONEY_SAVED_100', 
  MONEY_SAVED_250 = 'MONEY_SAVED_250', 
  MONEY_SAVED_500 = 'MONEY_SAVED_500', 
  
  FIRST_FOOD_SAVED = 'FIRST_FOOD_SAVED', 
  FOOD_SAVED_5KG = 'FOOD_SAVED_5KG', 
  FOOD_SAVED_10KG = 'FOOD_SAVED_10KG',
  FOOD_SAVED_15KG = 'FOOD_SAVED_15KG',
  FOOD_SAVED_20KG = 'FOOD_SAVED_20KG',
  
  SHOPPING_LIST_1 = 'SHOPPING_LIST_1', 
  SHOPPING_LIST_5 = 'SHOPPING_LIST_5', 
  SHOPPING_LIST_10 = 'SHOPPING_LIST_10', 
  SHOPPING_LIST_25 = 'SHOPPING_LIST_25', 
  
  
  WEEKDAY_MEALS_5 = 'WEEKDAY_MEALS_5', 
  
  COOKING_STREAK = 'COOKING_STREAK',
  CHALLENGE_PARTICIPATION = 'CHALLENGE_PARTICIPATION',
}

export enum MetricType {
  RECIPES_COOKED = 'RECIPES_COOKED',
  APP_SESSIONS = 'APP_SESSIONS',
  MONEY_SAVED_CUMULATIVE = 'MONEY_SAVED_CUMULATIVE',
  FOOD_WEIGHT_SAVED = 'FOOD_WEIGHT_SAVED',
  SHOPPING_LISTS_CREATED = 'SHOPPING_LISTS_CREATED',
  WEEKDAY_MEALS_COOKED = 'WEEKDAY_MEALS_COOKED',
  FIRST_EVENT = 'FIRST_EVENT',
}

@Schema({ timestamps: true })
export class Badge {
  @Prop({ required: true, trim: true })
  name: string; 

  @Prop({ required: true, trim: true })
  description: string; 

  @Prop({ required: true })
  imageUrl: string;

  @Prop({
    type: String,
    enum: BadgeCategory,
    required: true,
    index: true,
  })
  category: BadgeCategory;

  @Prop({
    type: String,
    enum: MilestoneType,
    required: false,
  })
  milestoneType?: MilestoneType;

  @Prop({ type: Number })
  milestoneThreshold?: number; 

  @Prop({
    type: String,
    enum: MetricType,
    required: false,
  })
  metricType?: MetricType;

  @Prop({ default: true, index: true })
  isActive: boolean;

  @Prop({ default: 0 })
  rarityScore: number; 

  @Prop({ type: String })
  iconColor?: string;

  @Prop({ default: false })
  isDeleted: boolean;

  @Prop({ type: String })
  challengeId?: string;
  
  @Prop({ default: false })
  isSponsorBadge: boolean;
  
  @Prop({ type: String })
  sponsorName?: string; 
  
  @Prop({ type: String })
  sponsorLogoUrl?: string;
  
  @Prop({ type: [String], default: [] })
  sponsorCountries?: string[]; 
  
  @Prop({ type: Date })
  sponsorValidFrom?: Date;
  
  @Prop({ type: Date })
  sponsorValidUntil?: Date;
  
  @Prop({ type: Object })
  sponsorMetadata?: {
    campaignId?: string;
    redemptionCode?: string;
    sponsorLink?: string;
    termsAndConditions?: string;
  };
}

export type BadgeDocument = Badge & Document;
export const BadgeSchema = SchemaFactory.createForClass(Badge);

BadgeSchema.index({ category: 1, isActive: 1 });
BadgeSchema.index({ milestoneType: 1 });
BadgeSchema.index({ metricType: 1 });
BadgeSchema.index({ challengeId: 1 });
BadgeSchema.index({ isSponsorBadge: 1, sponsorCountries: 1 });
BadgeSchema.index({ milestoneThreshold: 1 });
