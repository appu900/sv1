import { Type } from 'class-transformer';
import {
  IsEnum,
  IsNumber,
  IsOptional,
  IsString,
  Length,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';

export class NutritionFactsDto {
  @IsNumber()
  @Min(0)
  @Max(10000)
  kcal: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(1000)
  protein_g?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(1000)
  carbs_g?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(1000)
  fat_g?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(200)
  fiber_g?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(500)
  sugar_g?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(50000)
  sodium_mg?: number;
}

export class CreateCustomFoodDto {
  @IsString()
  @Length(1, 120)
  name: string;

  @IsString()
  @Length(1, 60)
  servingLabel: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  @Max(5000)
  servingGrams?: number;

  @IsOptional()
  @ValidateNested()
  @Type(() => NutritionFactsDto)
  per100g?: NutritionFactsDto;

  @IsOptional()
  @ValidateNested()
  @Type(() => NutritionFactsDto)
  perServing?: NutritionFactsDto;

  @IsOptional()
  @IsString()
  @Length(0, 500)
  notes?: string;

  @IsOptional()
  @IsEnum(['user_entered', 'ai_estimated', 'label_ocr'])
  origin?: 'user_entered' | 'ai_estimated' | 'label_ocr';
}


export class UpdateCustomFoodDto {
  @IsOptional()
  @IsString()
  @Length(1, 120)
  name?: string;

  @IsOptional()
  @IsString()
  @Length(1, 60)
  servingLabel?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  @Max(5000)
  servingGrams?: number;

  @IsOptional()
  @ValidateNested()
  @Type(() => NutritionFactsDto)
  per100g?: NutritionFactsDto;

  @IsOptional()
  @ValidateNested()
  @Type(() => NutritionFactsDto)
  perServing?: NutritionFactsDto;

  @IsOptional()
  @IsString()
  @Length(0, 500)
  notes?: string;
}
