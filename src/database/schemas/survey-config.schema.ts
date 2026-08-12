import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Schema as MongooseSchema } from 'mongoose';

export interface SurveyQuestion {
  key: string;
  label: string;
  type: 'number' | 'slider' | 'select';
  min: number;
  max: number;
  step: number;
  unit: string;
  description: string;
  order: number;
  isRequired: boolean;
  isActive: boolean;
}

export interface ProduceWasteCategory {
  key: string;
  label: string;
  icon: string;
  weightPerUnit: number;
  unit: string;
  order: number;
  isActive: boolean;
}

export interface CountryRate {
  countryCode: string;
  countryName: string;
  costPerGram: number;
  currencySymbol: string;
  isActive: boolean;
}

export interface CalculationConstants {
  co2PerGram: number;
  avgWeeklyWasteGrams: number;
  scrapsWeightPerUnit: number;
  leftoversWeightPerUnit: number;
}

export interface WeeklyTip {
  title: string;
  content: string;
  imageUrl: string;
  weekNumber: number;
  isActive: boolean;
  order: number;
}

export interface SurveyUiConfig {
  surveyTitle: string;
  surveyDescription: string;
  completionMessage: string;
  eligibilityMessage: string;
  notEligibleMessage: string;
}

@Schema({ timestamps: true })
export class SurveyConfig {
  @Prop({ required: true })
  name: string;

  @Prop({ default: false, index: true })
  isActive: boolean;

  @Prop({ default: 1 })
  version: number;

  @Prop({
    type: [MongooseSchema.Types.Mixed],
    default: [],
  })
  surveyQuestions: SurveyQuestion[];

  @Prop({
    type: [MongooseSchema.Types.Mixed],
    default: [],
  })
  produceWasteCategories: ProduceWasteCategory[];

  @Prop({
    type: [MongooseSchema.Types.Mixed],
    default: [],
  })
  countryRates: CountryRate[];

  @Prop({
    type: MongooseSchema.Types.Mixed,
    default: {
      // Keep in step with CO2_KG_PER_KG_FOOD_SAVED in
      // modules/analytics/utils/impact-pricing.util.ts — the survey and the
      // cook-event paths must not report a user different CO2 per kg saved.
      co2PerGram: 2.1,
      avgWeeklyWasteGrams: 5000,
      scrapsWeightPerUnit: 150,
      leftoversWeightPerUnit: 500,
    },
  })
  calculationConstants: CalculationConstants;

  @Prop({
    type: [MongooseSchema.Types.Mixed],
    default: [],
  })
  weeklyTips: WeeklyTip[];

  @Prop({
    type: MongooseSchema.Types.Mixed,
    default: {
      surveyTitle: 'Weekly Food Waste Survey',
      surveyDescription: 'Track your weekly food waste to help reduce it.',
      completionMessage: 'Great job completing your weekly survey!',
      eligibilityMessage: "Ready to take this week's survey!",
      notEligibleMessage: "You've already completed this week's survey",
    },
  })
  uiConfig: SurveyUiConfig;

  @Prop({ type: Date, default: Date.now })
  createdAt: Date;

  @Prop({ type: Date, default: Date.now })
  updatedAt: Date;
}

export type SurveyConfigDocument = SurveyConfig & Document;
export const SurveyConfigSchema = SchemaFactory.createForClass(SurveyConfig);
