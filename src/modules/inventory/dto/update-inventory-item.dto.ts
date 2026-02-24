import {
  IsString,
  IsNumber,
  IsOptional,
  IsEnum,
  IsDateString,
  IsBoolean,
  Min,
} from 'class-validator';
import { StorageLocation } from '../../../database/schemas/user-inventory.schema';

export class UpdateInventoryItemDto {
  @IsString()
  @IsOptional()
  name?: string;

  @IsNumber()
  @Min(0)
  @IsOptional()
  quantity?: number;

  @IsString()
  @IsOptional()
  unit?: string;

  @IsEnum(StorageLocation)
  @IsOptional()
  storageLocation?: StorageLocation;

  @IsDateString()
  @IsOptional()
  expiresAt?: string;

  @IsBoolean()
  @IsOptional()
  isStaple?: boolean;
}
