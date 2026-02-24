import {
  IsString,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsEnum,
  IsMongoId,
  IsBoolean,
  IsDateString,
  Min,
} from 'class-validator';
import {
  StorageLocation,
  InventoryItemSource,
} from '../../../database/schemas/user-inventory.schema';

export class AddInventoryItemDto {
  @IsMongoId()
  @IsOptional()
  ingredientId?: string;

  @IsString()
  @IsNotEmpty()
  name: string;

  @IsNumber()
  @Min(0)
  quantity: number;

  @IsString()
  @IsNotEmpty()
  unit: string;

  @IsEnum(StorageLocation)
  @IsOptional()
  storageLocation?: StorageLocation;

  @IsDateString()
  @IsOptional()
  expiresAt?: string;

  @IsEnum(InventoryItemSource)
  @IsOptional()
  source?: InventoryItemSource;

  @IsString()
  @IsOptional()
  heroImageUrl?: string;

  @IsMongoId()
  @IsOptional()
  categoryId?: string;

  @IsBoolean()
  @IsOptional()
  isStaple?: boolean;

  @IsString()
  @IsOptional()
  country?: string;
}
