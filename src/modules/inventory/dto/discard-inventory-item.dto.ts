import {
  IsString,
  IsNumber,
  IsOptional,
  IsEnum,
  IsMongoId,
  Min,
} from 'class-validator';
import {
  WasteType,
  DiscardReason,
} from '../../../database/schemas/user-inventory.schema';

export class DiscardInventoryItemDto {
  @IsMongoId()
  itemId: string;

  @IsEnum(DiscardReason)
  reason: DiscardReason;

  @IsEnum(WasteType)
  wasteType: WasteType;

  @IsNumber()
  @Min(0)
  @IsOptional()
  discardedQuantity?: number; 

  @IsString()
  @IsOptional()
  notes?: string;

  @IsOptional()
  addToShoppingList?: boolean; 
}
