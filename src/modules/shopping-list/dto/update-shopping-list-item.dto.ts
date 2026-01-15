import { IsString, IsOptional, IsEnum, IsMongoId } from 'class-validator';
import { ShoppingListItemStatus } from '../../../database/schemas/shopping-list.schema';

export class UpdateShoppingListItemDto {
  @IsString()
  @IsOptional()
  quantity?: string;

  @IsString()
  @IsOptional()
  unit?: string;

  @IsEnum(ShoppingListItemStatus)
  @IsOptional()
  status?: ShoppingListItemStatus;

  @IsString()
  @IsOptional()
  notes?: string;
}
