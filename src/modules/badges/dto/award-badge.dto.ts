import { IsString, IsNumber, IsOptional, IsObject } from 'class-validator';
import { Types } from 'mongoose';

export class AwardBadgeDto {
  @IsString()
  userId: string;

  @IsString()
  badgeId: string;

  @IsOptional()
  @IsNumber()
  achievedValue?: number;

  @IsOptional()
  @IsObject()
  metadata?: {
    challengeId?: string;
    challengeName?: string;
    period?: string;
    rank?: number;
    totalParticipants?: number;
  };
}
