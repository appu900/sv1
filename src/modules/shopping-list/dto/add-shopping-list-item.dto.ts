import { IsString, IsNotEmpty, IsOptional, IsEnum, IsMongoId, ValidateIf } from 'class-validator';
import { ShoppingListItemSource } from '../../../database/schemas/shopping-list.schema';

export class AddShoppingListItemDto {
  @ValidateIf(o => !o.ingredientName)
  @IsMongoId()
  @IsNotEmpty()
  ingredientId?: string;

  @ValidateIf(o => !o.ingredientId)
  @IsString()
  @IsNotEmpty()
  ingredientName?: string;

  @IsString()
  @IsNotEmpty()
  quantity: string;

  @IsString()
  @IsOptional()
  unit?: string;

  @IsEnum(ShoppingListItemSource)
  @IsOptional()
  source?: ShoppingListItemSource;

  @IsMongoId()
  @IsOptional()
  recipeId?: string;

  @IsString()
  @IsOptional()
  notes?: string;
}
