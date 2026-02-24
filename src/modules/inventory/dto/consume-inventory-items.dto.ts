import {
  IsArray,
  IsString,
  IsOptional,
  IsMongoId,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

class ConsumeIngredientDto {
  @IsMongoId()
  ingredientId: string;

  @IsString()
  @IsOptional()
  name?: string;
}

export class ConsumeInventoryItemsDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ConsumeIngredientDto)
  ingredients: ConsumeIngredientDto[];

  @IsString()
  @IsOptional()
  recipeId?: string;

  @IsString()
  @IsOptional()
  recipeName?: string;
}
