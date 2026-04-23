import { IsEnum, IsInt, IsObject, IsOptional, IsString, Max, MaxLength, Min, ValidateNested, ArrayMaxSize } from 'class-validator';
import { Transform, Type } from 'class-transformer';

export enum MetricsWindow {
  WEEK = 'week',
  MONTH = 'month',
  YEAR = 'year',
  ALL = 'all',
}

export class MetricsQueryDto {
  @IsOptional()
  @IsEnum(MetricsWindow)
  window?: MetricsWindow;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  tz?: string;
}

export class MostCookedQueryDto {
  @IsOptional()
  @IsEnum(MetricsWindow)
  window?: MetricsWindow;

  @IsOptional()
  @IsEnum(['mine', 'global'])
  scope?: 'mine' | 'global';

  @IsOptional()
  @IsString()
  @MaxLength(64)
  tz?: string;

  @IsOptional()
  @Transform(({ value }) => (value === undefined || value === null || value === '' ? undefined : parseInt(value, 10)))
  @IsInt()
  @Min(1)
  @Max(50)
  limit?: number;
}

export class MostSearchedQueryDto {
  @IsOptional()
  @IsEnum(MetricsWindow)
  window?: MetricsWindow;

  @IsOptional()
  @IsEnum(['mine', 'global'])
  scope?: 'mine' | 'global';

  @IsOptional()
  @IsString()
  @MaxLength(64)
  tz?: string;

  @IsOptional()
  @Transform(({ value }) => (value === undefined || value === null || value === '' ? undefined : parseInt(value, 10)))
  @IsInt()
  @Min(1)
  @Max(50)
  limit?: number;
}

export class LogIngredientSearchDto {
  @IsOptional()
  @IsString()
  ingredientId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  @Transform(({ value }) => (typeof value === 'string' ? value.trim().toLowerCase() : value))
  query?: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  source?: string;
}

export class LogClientEventDto {
  @IsString()
  @MaxLength(120)
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  event: string;

  @IsOptional()
  @IsObject()
  properties?: Record<string, any>;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  route?: string;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  platform?: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  appVersion?: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  sessionId?: string;
}

export class LogClientEventsBatchDto {
  @ValidateNested({ each: true })
  @Type(() => LogClientEventDto)
  @ArrayMaxSize(50)
  events: LogClientEventDto[];
}
