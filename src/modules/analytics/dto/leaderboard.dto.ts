import { IsEnum, IsOptional, IsNumber, Min, Max, IsString } from 'class-validator';
import { Type } from 'class-transformer';

export enum LeaderboardPeriod {
  ALL_TIME = 'ALL_TIME',
  YEARLY = 'YEARLY',
  MONTHLY = 'MONTHLY',
  WEEKLY = 'WEEKLY',
}

export enum LeaderboardMetric {
  MEALS_COOKED = 'MEALS_COOKED',
  FOOD_SAVED = 'FOOD_SAVED',
  BOTH = 'BOTH',
}

export class GetLeaderboardDto {
  @IsOptional()
  @IsEnum(LeaderboardPeriod)
  period?: LeaderboardPeriod = LeaderboardPeriod.ALL_TIME;

  @IsOptional()
  @IsEnum(LeaderboardMetric)
  metric?: LeaderboardMetric = LeaderboardMetric.BOTH;

  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  @Min(1)
  @Max(100)
  limit?: number = 20;

  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  @Min(0)
  offset?: number = 0;

  @IsOptional()
  @IsString()
  country?: string;

  @IsOptional()
  @IsString()
  stateCode?: string;
}
