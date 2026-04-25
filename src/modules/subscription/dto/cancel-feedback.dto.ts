import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';

export const CANCEL_REASONS = [
  'too_expensive',
  'not_using_enough',
  'missing_features',
  'technical_issues',
  'switching_app',
  'temporary_break',
  'other',
] as const;

export type CancelReason = (typeof CANCEL_REASONS)[number];

export class CancelFeedbackDto {
  @IsString()
  @IsIn(CANCEL_REASONS as unknown as string[])
  reason: CancelReason;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  details?: string;

  @IsOptional()
  @IsString()
  productId?: string;

  @IsOptional()
  @IsString()
  plan?: string;
}
