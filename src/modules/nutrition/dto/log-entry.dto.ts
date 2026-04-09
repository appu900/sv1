import { Type } from 'class-transformer';
import {
  IsDateString,
  IsEnum,
  IsMongoId,
  IsNumber,
  IsOptional,
  IsString,
  Length,
  Matches,
  Max,
  Min,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import {
  LogRefKind,
  MealSlot,
  PortionMode,
} from '../../../database/schemas/nutrition/daily-intake.schema';
import { NutritionFactsDto } from './custom-food.dto';

export class EntryRefDto {
  @IsEnum(LogRefKind)
  kind: LogRefKind;

  @ValidateIf((o) => o.kind === LogRefKind.FOOD)
  @IsMongoId()
  foodItemId?: string;

  @ValidateIf((o) => o.kind === LogRefKind.CUSTOM)
  @IsMongoId()
  customFoodId?: string;

  @ValidateIf((o) => o.kind === LogRefKind.RECIPE)
  @IsMongoId()
  recipeId?: string;

  @ValidateIf((o) => o.kind === LogRefKind.USER_RECIPE)
  @IsMongoId()
  userRecipeId?: string;

  @ValidateIf((o) => o.kind === LogRefKind.FREEFORM)
  @IsString()
  @Length(1, 200)
  freeformText?: string;
}

export class EntryPortionDto {
  @IsEnum(PortionMode)
  mode: PortionMode;

  @IsOptional()
  @IsString()
  @Length(1, 60)
  label?: string;

  @ValidateIf((o) => o.mode === PortionMode.SERVING || o.mode === PortionMode.COUNT)
  @IsNumber()
  @Min(0.1)
  @Max(100)
  servings?: number;

  @ValidateIf((o) => o.mode === PortionMode.GRAMS)
  @IsNumber()
  @Min(0.1)
  @Max(5000)
  grams?: number;

  @ValidateIf((o) => o.mode === PortionMode.ML)
  @IsNumber()
  @Min(0.1)
  @Max(5000)
  ml?: number;
}

export class CreateLogEntryDto {
  @ValidateNested()
  @Type(() => EntryRefDto)
  ref: EntryRefDto;

  @ValidateNested()
  @Type(() => EntryPortionDto)
  portion: EntryPortionDto;

  @IsOptional()
  @IsEnum(MealSlot)
  mealSlot?: MealSlot;

  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'date must be YYYY-MM-DD' })
  date?: string;

 
  @IsOptional()
  @ValidateNested()
  @Type(() => NutritionFactsDto)
  freeformFacts?: NutritionFactsDto;
}

export class UpdateLogEntryDto {
  @IsOptional()
  @ValidateNested()
  @Type(() => EntryRefDto)
  ref?: EntryRefDto;

  @IsOptional()
  @ValidateNested()
  @Type(() => EntryPortionDto)
  portion?: EntryPortionDto;

  @IsOptional()
  @ValidateNested()
  @Type(() => NutritionFactsDto)
  freeformFacts?: NutritionFactsDto;

  @IsOptional()
  @IsEnum(MealSlot)
  mealSlot?: MealSlot;
}

export class DailyQueryDto {
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'date must be YYYY-MM-DD' })
  date?: string;
}

export class EntryIdParamDto {
  @IsMongoId()
  entryId: string;
}

export { LogRefKind, MealSlot, PortionMode };
export { IsDateString };
