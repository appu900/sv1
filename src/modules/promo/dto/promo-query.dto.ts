import { Transform } from 'class-transformer';
import { IsEnum, IsOptional, IsString } from 'class-validator';
import { PromoPlatform } from '../../../database/schemas/promo-card.schema';

export class PromoQueryDto {
  @IsOptional()
  @Transform(({ value }) =>
    typeof value === 'string' ? value.toLowerCase() : value,
  )
  @IsEnum(PromoPlatform)
  platform?: PromoPlatform;

  @IsOptional()
  @IsString()
  appVersion?: string;

  /** Data-version pin, enabling the immutable cache path in sendCacheableJson. */
  @IsOptional()
  @IsString()
  v?: string;
}
