import { IsArray, IsNotEmpty, IsString, IsOptional, ValidateNested, ArrayMinSize } from 'class-validator';
import { Type } from 'class-transformer';

export class IngredientToAddDto {
  @IsOptional()
  @IsString()
  ingredientId?: string;

  @IsOptional()
  @IsString()
  ingredientName?: string;

  @IsOptional()
  @IsString()
  quantity?: string;
}

export class AddIngredientsFromRecipeDto {
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => IngredientToAddDto)
  ingredients: IngredientToAddDto[];

  @IsNotEmpty()
  @IsString()
  recipeId: string;
}
