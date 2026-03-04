import { IsNotEmpty, IsNumber, Min, Max, IsOptional, IsArray, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';

export class IngredientToScaleDto {
  @IsNotEmpty()
  ingredientName: string;

  @IsNotEmpty()
  originalQuantity: string;

  @IsOptional()
  preparation?: string;

  @IsOptional()
  ingredientId?: string;
}

export class ScaleServingsDto {
  @IsNumber()
  @Min(1)
  @Max(20)
  desiredServings: number;

  @IsNumber()
  @Min(1)
  originalServings: number;

  @IsOptional()
  recipeId?: string;

  @IsOptional()
  recipeTitle?: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => IngredientToScaleDto)
  ingredients: IngredientToScaleDto[];
}

export class ScaledIngredientResult {
  ingredientName: string;
  originalQuantity: string;
  scaledQuantity: string;
  ingredientId?: string;
  preparation?: string;
}

export class ScaleServingsResponseDto {
  originalServings: number;
  desiredServings: number;
  scaledIngredients: ScaledIngredientResult[];
  cookingNotes?: string;
}
