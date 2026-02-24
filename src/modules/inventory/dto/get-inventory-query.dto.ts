import { IsString, IsOptional, IsEnum, IsNumber, Min } from 'class-validator';
import {
  StorageLocation,
  FreshnessStatus,
} from '../../../database/schemas/user-inventory.schema';

export class GetInventoryQueryDto {
  @IsEnum(StorageLocation)
  @IsOptional()
  storageLocation?: StorageLocation;

  @IsEnum(FreshnessStatus)
  @IsOptional()
  freshnessStatus?: FreshnessStatus;

  @IsString()
  @IsOptional()
  search?: string;

  @IsNumber()
  @Min(1)
  @IsOptional()
  expiringWithinDays?: number;
}

export class WasteClassifyDto {
  @IsString()
  ingredientName: string;

  @IsString()
  @IsOptional()
  packaging?: string; 
}
