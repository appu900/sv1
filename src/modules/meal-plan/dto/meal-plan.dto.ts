import {
  IsBoolean,
  IsInt,
  IsMongoId,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';

export class GenerateMealPlanDto {
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(14)
  days?: number;

  @IsOptional()
  @IsString()
  preference?: string;
}

export class GenerateRecipeFromPlanDto {
  @IsString()
  planId: string;

  @IsInt()
  @Min(1)
  dayNumber: number;

  @IsString()
  slot: string;
}

export class MarkPlanRecipeDto {
  @IsInt()
  @Min(0)
  dayIndex: number;

  @IsString()
  mealSlot: string;

  @IsOptional()
  @IsMongoId()
  recipeId?: string;

  @IsOptional()
  @IsBoolean()
  isCooked?: boolean;

  @IsOptional()
  @IsBoolean()
  isSwapped?: boolean;
}
