import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  Length,
  Matches,
  Max,
  Min,
} from 'class-validator';

export class FoodSearchQueryDto {
  @IsOptional()
  @IsString()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @Length(0, 120)
  q?: string;

  @IsOptional()
  @IsString()
  @Transform(({ value }) =>
    typeof value === 'string' && value.length <= 6
      ? value.trim().toUpperCase() === 'GLOBAL'
        ? 'global'
        : value.trim().toUpperCase()
      : value,
  )
  @Length(2, 6)
  locale?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  limit?: number;

  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true' || value === '1')
  @IsBoolean()
  verifiedOnly?: boolean;
}

export class BarcodeLookupDto {
  @IsString()
  @Transform(({ value }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @Matches(/^\d{6,14}$/, {
    message: 'barcode must be 6-14 digits',
  })
  barcode: string;
}
