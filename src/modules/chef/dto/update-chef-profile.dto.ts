import {
  IsBoolean,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { Transform, Type } from 'class-transformer';
import { ChefSocialLinksDto } from './create-chef-profile.dto';

const toOptionalNumber = ({ value }: { value: unknown }) => {
  if (value === undefined || value === null || value === '') return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : value;
};

const toOptionalBoolean = ({ value }: { value: unknown }) => {
  if (value === undefined || value === null || value === '') return undefined;
  if (typeof value === 'boolean') return value;
  if (value === 'true' || value === '1') return true;
  if (value === 'false' || value === '0') return false;
  return value;
};

const toOptionalTrimmedString = ({ value }: { value: unknown }) => {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'string') return value;
  const trimmed = value.trim();
  return trimmed.length ? trimmed : undefined;
};

const parseSocialLinks = ({ value }: { value: unknown }) => {
  if (value === undefined || value === null || value === '') return undefined;
  if (typeof value === 'object') return value;
  if (typeof value === 'string') {
    try {
      return JSON.parse(value);
    } catch {
      return value;
    }
  }
  return value;
};

export class UpdateChefProfileDto {
  @Transform(toOptionalTrimmedString)
  @IsString()
  @IsOptional()
  @MaxLength(120)
  displayName?: string;

  @Transform(toOptionalTrimmedString)
  @IsString()
  @IsOptional()
  @MaxLength(80)
  slug?: string;

  @Transform(toOptionalTrimmedString)
  @IsString()
  @IsOptional()
  country?: string;

  @Transform(toOptionalTrimmedString)
  @IsString()
  @IsOptional()
  @MaxLength(240)
  quote?: string;

  @Transform(toOptionalTrimmedString)
  @IsString()
  @IsOptional()
  @MaxLength(4000)
  bio?: string;

  @Transform(parseSocialLinks)
  @IsObject()
  @IsOptional()
  @ValidateNested()
  @Type(() => ChefSocialLinksDto)
  socialLinks?: ChefSocialLinksDto;

  @Transform(toOptionalBoolean)
  @IsBoolean()
  @IsOptional()
  isPublished?: boolean;

  @Transform(toOptionalNumber)
  @IsNumber()
  @IsOptional()
  order?: number;
}
