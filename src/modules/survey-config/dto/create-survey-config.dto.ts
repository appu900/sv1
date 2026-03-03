import {
  IsString,
  IsBoolean,
  IsNumber,
  IsArray,
  IsOptional,
  ValidateNested,
  IsEnum,
  Min,
  IsNotEmpty,
} from 'class-validator';
import { Type } from 'class-transformer';

export class SurveyQuestionDto {
  @IsString()
  @IsNotEmpty()
  key: string;

  @IsString()
  @IsNotEmpty()
  label: string;

  @IsEnum(['number', 'slider', 'select'])
  type: 'number' | 'slider' | 'select';

  @IsNumber()
  @Min(0)
  min: number;

  @IsNumber()
  max: number;

  @IsNumber()
  @Min(0)
  step: number;

  @IsString()
  unit: string;

  @IsString()
  @IsOptional()
  description?: string;

  @IsNumber()
  @Min(0)
  order: number;

  @IsBoolean()
  isRequired: boolean;

  @IsBoolean()
  isActive: boolean;
}

export class ProduceWasteCategoryDto {
  @IsString()
  @IsNotEmpty()
  key: string;

  @IsString()
  @IsNotEmpty()
  label: string;

  @IsString()
  @IsOptional()
  icon?: string;

  @IsNumber()
  @Min(0)
  weightPerUnit: number;

  @IsString()
  unit: string;

  @IsNumber()
  @Min(0)
  order: number;

  @IsBoolean()
  isActive: boolean;
}

export class CountryRateDto {
  @IsString()
  @IsNotEmpty()
  countryCode: string;

  @IsString()
  @IsNotEmpty()
  countryName: string;

  @IsNumber()
  @Min(0)
  costPerGram: number;

  @IsString()
  @IsNotEmpty()
  currencySymbol: string;

  @IsBoolean()
  isActive: boolean;
}

export class CalculationConstantsDto {
  @IsNumber()
  @Min(0)
  co2PerGram: number;

  @IsNumber()
  @Min(0)
  avgWeeklyWasteGrams: number;

  @IsNumber()
  @Min(0)
  scrapsWeightPerUnit: number;

  @IsNumber()
  @Min(0)
  leftoversWeightPerUnit: number;
}

export class WeeklyTipDto {
  @IsString()
  @IsNotEmpty()
  title: string;

  @IsString()
  @IsNotEmpty()
  content: string;

  @IsString()
  @IsOptional()
  imageUrl?: string;

  @IsNumber()
  @Min(1)
  weekNumber: number;

  @IsBoolean()
  isActive: boolean;

  @IsNumber()
  @Min(0)
  order: number;
}

export class SurveyUiConfigDto {
  @IsString()
  @IsOptional()
  surveyTitle?: string;

  @IsString()
  @IsOptional()
  surveyDescription?: string;

  @IsString()
  @IsOptional()
  completionMessage?: string;

  @IsString()
  @IsOptional()
  eligibilityMessage?: string;

  @IsString()
  @IsOptional()
  notEligibleMessage?: string;
}

export class CreateSurveyConfigDto {
  @IsString()
  @IsNotEmpty()
  name: string;

  @IsBoolean()
  @IsOptional()
  isActive?: boolean;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => SurveyQuestionDto)
  @IsOptional()
  surveyQuestions?: SurveyQuestionDto[];

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ProduceWasteCategoryDto)
  @IsOptional()
  produceWasteCategories?: ProduceWasteCategoryDto[];

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CountryRateDto)
  @IsOptional()
  countryRates?: CountryRateDto[];

  @ValidateNested()
  @Type(() => CalculationConstantsDto)
  @IsOptional()
  calculationConstants?: CalculationConstantsDto;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => WeeklyTipDto)
  @IsOptional()
  weeklyTips?: WeeklyTipDto[];

  @ValidateNested()
  @Type(() => SurveyUiConfigDto)
  @IsOptional()
  uiConfig?: SurveyUiConfigDto;
}
