import { IsEnum, IsOptional } from 'class-validator';
import { ShoppingListItemStatus } from '../../../database/schemas/shopping-list.schema';

export class GetShoppingListQueryDto {
  @IsEnum(ShoppingListItemStatus)
  @IsOptional()
  status?: ShoppingListItemStatus;
}
