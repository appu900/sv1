import { IsArray, ValidateNested, ArrayMinSize } from 'class-validator';
import { Type } from 'class-transformer';
import { IsNumber, IsEnum } from 'class-validator';
import { ShoppingListItemStatus } from '../../../database/schemas/shopping-list.schema';

export class BatchUpdateItemDto {
  @IsNumber()
  index: number;

  @IsEnum(ShoppingListItemStatus)
  status: ShoppingListItemStatus;
}

export class BatchUpdateItemsDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => BatchUpdateItemDto)
  @ArrayMinSize(1)
  updates: BatchUpdateItemDto[];
}
