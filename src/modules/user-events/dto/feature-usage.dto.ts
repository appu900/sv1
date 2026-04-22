import {
  IsEnum,
  IsObject,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';
import { FeatureKey } from '../../../database/schemas/feature-usage-event.schema';

export class LogFeatureUsageDto {
  @IsEnum(FeatureKey)
  feature: FeatureKey;

  @IsString()
  @MinLength(1)
  @MaxLength(64)
  action: string;

  @IsOptional()
  @IsObject()
  metadata?: Record<string, any>;
}
