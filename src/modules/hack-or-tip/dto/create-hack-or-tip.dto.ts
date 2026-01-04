import {
  IsNotEmpty,
  IsOptional,
  IsString,
  IsEnum,
  IsBoolean,
  IsNumber,
} from 'class-validator';
import { HackOrTipType } from '../../../database/schemas/hack-or-tip.schema';

export class CreateHackOrTipDto {
  @IsNotEmpty()
  @IsString()
  title: string;

  @IsNotEmpty()
  @IsEnum(HackOrTipType)
  type: HackOrTipType;

  @IsNotEmpty()
  @IsString()
  shortDescription: string;

  @IsOptional()
  @IsString()
  description?: string; // HTML formatted text

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
