import { IsString, IsOptional, IsEnum } from 'class-validator';
import { StorageLocation } from '../../../database/schemas/user-inventory.schema';

export class EstimateShelfLifeDto {
  @IsString()
  dishName: string;

  @IsEnum(StorageLocation)
  storageLocation: StorageLocation;

  @IsString()
  @IsOptional()
  dishCategory?: string;
}

export class LeftoverMakeoverDto {
  @IsString()
  dishName: string;

  @IsString()
  @IsOptional()
  storageLocation?: string;

  @IsString()
  @IsOptional()
  country?: string;
}
