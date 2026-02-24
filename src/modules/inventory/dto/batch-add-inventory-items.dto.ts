import {
  IsArray,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { AddInventoryItemDto } from './add-inventory-item.dto';

export class BatchAddInventoryItemsDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => AddInventoryItemDto)
  items: AddInventoryItemDto[];
}
