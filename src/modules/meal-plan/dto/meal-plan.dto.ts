import {
  IsBoolean,
  IsIn,
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

/** Swap one meal for a new idea, or add an extra meal to a day. */
export class ChangePlanMealDto {
  @IsInt()
  @Min(1)
  dayNumber: number;

  @IsIn(['breakfast', 'lunch', 'snack', 'dinner'])
  slot: 'breakfast' | 'lunch' | 'snack' | 'dinner';

  @IsIn(['swap', 'add'])
  mode: 'swap' | 'add';
}
