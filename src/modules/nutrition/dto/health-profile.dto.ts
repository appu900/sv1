import {
  IsEnum,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Matches,
  Max,
  Min,
  ValidateNested,
  IsArray,
  MaxLength,
} from 'class-validator';
import { Type } from 'class-transformer';
import {
  Gender,
  BodyType,
  GoalType,
  ActivityLevel,
} from '../../../database/schemas/nutrition/health-profile.schema';

export class HeightDto {
  @IsNumber()
  @Min(50)
  @Max(300)
  cm: number;

  @IsOptional()
  @IsNumber()
  @Min(1)
  @Max(9)
  feet?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(11)
  inches?: number;
}

export class WeightDto {
  @IsNumber()
  @Min(20)
  @Max(500)
  kg: number;

  @IsOptional()
  @IsNumber()
  @Min(44)
  @Max(1100)
  lbs?: number;
}

export class HealthConditionDto {
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  conditions?: string[];

  @IsOptional()
  @IsString()
  @MaxLength(500)
  doctorRecommendation?: string;
}

export class CreateHealthProfileDto {
  @IsEnum(Gender)
  gender: Gender;

  @IsNumber()
  @Min(10)
  @Max(120)
  age: number;

  @ValidateNested()
  @Type(() => HeightDto)
  @IsNotEmpty()
  height: HeightDto;

  @ValidateNested()
  @Type(() => WeightDto)
  @IsNotEmpty()
  weight: WeightDto;

  @IsEnum(BodyType)
  bodyType: BodyType;

  @IsOptional()
  @IsEnum(ActivityLevel)
  activityLevel?: ActivityLevel;

  @IsEnum(GoalType)
  goal: GoalType;

  @IsOptional()
  @IsNumber()
  @Min(20)
  @Max(500)
  targetWeightKg?: number;

  @IsOptional()
  @ValidateNested()
  @Type(() => HealthConditionDto)
  healthCondition?: HealthConditionDto;
}

export class UpdateWeightDto {
  @IsNumber()
  @Min(20)
  @Max(500)
  kg: number;

  @IsOptional()
  @IsNumber()
  @Min(44)
  @Max(1100)
  lbs?: number;
}

export class UpdateHealthProfileDto {
  @IsOptional()
  @IsEnum(Gender)
  gender?: Gender;

  @IsOptional()
  @IsNumber()
  @Min(10)
  @Max(120)
  age?: number;

  @IsOptional()
  @ValidateNested()
  @Type(() => HeightDto)
  height?: HeightDto;

  @IsOptional()
  @ValidateNested()
  @Type(() => WeightDto)
  weight?: WeightDto;

  @IsOptional()
  @IsEnum(BodyType)
  bodyType?: BodyType;

  @IsOptional()
  @IsEnum(ActivityLevel)
  activityLevel?: ActivityLevel;

  @IsOptional()
  @IsEnum(GoalType)
  goal?: GoalType;

  @IsOptional()
  @IsNumber()
  @Min(20)
  @Max(500)
  targetWeightKg?: number;

  @IsOptional()
  @ValidateNested()
  @Type(() => HealthConditionDto)
  healthCondition?: HealthConditionDto;
}

export class UpdateDailyTargetsDto {
  @IsOptional()
  @IsNumber()
  @Min(500)
  @Max(10000)
  kcal?: number;

  @IsOptional()
  @IsNumber()
  @Min(10)
  @Max(500)
  protein_g?: number;

  @IsOptional()
  @IsNumber()
  @Min(20)
  @Max(800)
  carbs_g?: number;

  @IsOptional()
  @IsNumber()
  @Min(10)
  @Max(300)
  fat_g?: number;

  @IsOptional()
  @IsNumber()
  @Min(5)
  @Max(100)
  fiber_g?: number;

  @IsOptional()
  @IsNumber()
  @Min(500)
  @Max(10000)
  water_ml?: number;
}

export class LogWaterDto {
  @IsNumber()
  @Min(1)
  @Max(10000)
  ml: number;

  @IsOptional()
  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'date must be YYYY-MM-DD' })
  date?: string;
}
