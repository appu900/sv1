import {
  Allow,
  IsArray,
  IsBoolean,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';
import { Transform } from 'class-transformer';

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

  let parsed: unknown = value;
  if (typeof value === 'string') {
    try {
      parsed = JSON.parse(value);
    } catch {
      return undefined;
    }
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return undefined;
  }

  const src = parsed as Record<string, unknown>;
  const pick = (key: string) => {
    const raw = src[key];
    if (raw === undefined || raw === null) return '';
    return String(raw).trim();
  };

  return {
    instagram: pick('instagram'),
    youtube: pick('youtube'),
    tiktok: pick('tiktok'),
    facebook: pick('facebook'),
    website: pick('website'),
    linkedin: pick('linkedin'),
  };
};

export class ChefSocialLinksDto {
  @IsString()
  @IsOptional()
  instagram?: string;

  @IsString()
  @IsOptional()
  youtube?: string;

  @IsString()
  @IsOptional()
  tiktok?: string;

  @IsString()
  @IsOptional()
  facebook?: string;

  @IsString()
  @IsOptional()
  website?: string;

  @IsString()
  @IsOptional()
  linkedin?: string;
}

export class CreateChefProfileDto {
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @IsNotEmpty()
  userId: string;

  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  displayName: string;

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
  @Allow()
  @IsOptional()
  socialLinks?: ChefSocialLinksDto;

  @Transform(({ value }: { value: unknown }) => {
    if (value === undefined || value === null || value === '') return undefined;
    if (Array.isArray(value)) return value;
    if (typeof value === 'string') {
      try {
        const parsed = JSON.parse(value);
        return Array.isArray(parsed) ? parsed : value;
      } catch {
        return value
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean);
      }
    }
    return value;
  })
  @IsArray()
  @IsOptional()
  @IsString({ each: true })
  featuredCuisineIds?: string[];

  @Transform(toOptionalBoolean)
  @IsBoolean()
  @IsOptional()
  isPublished?: boolean;

  @Transform(toOptionalNumber)
  @IsNumber()
  @IsOptional()
  order?: number;
}
