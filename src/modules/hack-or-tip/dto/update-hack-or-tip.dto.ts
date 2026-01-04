import {
  IsOptional,
  IsString,
  IsEnum,
  IsBoolean,
  IsNumber,
} from 'class-validator';
import { HackOrTipType } from '../../../database/schemas/hack-or-tip.schema';

export class UpdateHackOrTipDto {
  @IsOptional()
  @IsString()
  title?: string;

  @IsOptional()
  @IsEnum(HackOrTipType)
  type?: HackOrTipType;

  @IsOptional()
  @IsString()
  shortDescription?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsString()
  sponsorHeading?: string;

  @IsOptional()
  @IsString()
  sponsorId?: string;

  @IsOptional()

  @IsBoolean()
  isActive?: boolean;
}
