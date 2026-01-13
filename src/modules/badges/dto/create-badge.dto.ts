import {
  IsString,
  IsEnum,
  IsNumber,
  IsOptional,
  IsBoolean,
  IsUrl,
  Min,
} from 'class-validator';
import { BadgeCategory, MilestoneType } from '../../../database/schemas/badge.schema';

export class CreateBadgeDto {
  @IsString()
  name: string;

  @IsString()
  description: string;

  @IsOptional()
  @IsString()
  imageUrl?: string;

  @IsEnum(BadgeCategory)
  category: BadgeCategory;

  @IsOptional()
  @IsEnum(MilestoneType)
  milestoneType?: MilestoneType;

  @IsOptional()
  @IsNumber()
  @Min(0)
  milestoneThreshold?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  rarityScore?: number;

  @IsOptional()
  @IsString()
  iconColor?: string;

  @IsOptional()
  @IsString()
  challengeId?: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
