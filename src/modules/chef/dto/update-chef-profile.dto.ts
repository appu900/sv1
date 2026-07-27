import {
  Allow,
  IsArray,
  IsBoolean,
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

type SocialLinksShape = {
  instagram?: string;
  youtube?: string;
  tiktok?: string;
  facebook?: string;
  website?: string;
  linkedin?: string;
};

const pickSocial = (src: Record<string, unknown>, key: string) => {
  const raw = src[key];
  if (raw === undefined || raw === null) return '';
  return String(raw).trim();
};

const asSocialLinks = (src: Record<string, unknown>): SocialLinksShape => ({
  instagram: pickSocial(src, 'instagram'),
  youtube: pickSocial(src, 'youtube'),
  tiktok: pickSocial(src, 'tiktok'),
  facebook: pickSocial(src, 'facebook'),
  website: pickSocial(src, 'website'),
  linkedin: pickSocial(src, 'linkedin'),
});

/** Multipart forms may send socialLinks as JSON and/or flat instagram/youtube/... fields. */
const parseSocialLinks = ({ value, obj }: { value: unknown; obj: Record<string, unknown> }) => {
  let fromJson: SocialLinksShape | undefined;

  if (value !== undefined && value !== null && value !== '') {
    let parsed: unknown = value;
    if (typeof value === 'string') {
      try {
        parsed = JSON.parse(value);
      } catch {
        parsed = undefined;
      }
    }
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      fromJson = asSocialLinks(parsed as Record<string, unknown>);
    }
  }

  const fromFlat = asSocialLinks(obj || {});
  const hasFlat = Object.values(fromFlat).some((v) => Boolean(v));

  if (!fromJson && !hasFlat) {
    // Explicit empty JSON object still means "set social links" (possibly clear)
    if (
      value !== undefined &&
      value !== null &&
      value !== '' &&
      typeof value === 'object'
    ) {
      return asSocialLinks(value as Record<string, unknown>);
    }
    if (typeof value === 'string') {
      try {
        const parsed = JSON.parse(value);
        if (parsed && typeof parsed === 'object') {
          return asSocialLinks(parsed as Record<string, unknown>);
        }
      } catch {
        /* ignore */
      }
    }
    return undefined;
  }

  return {
    instagram: fromJson?.instagram || fromFlat.instagram || '',
    youtube: fromJson?.youtube || fromFlat.youtube || '',
    tiktok: fromJson?.tiktok || fromFlat.tiktok || '',
    facebook: fromJson?.facebook || fromFlat.facebook || '',
    website: fromJson?.website || fromFlat.website || '',
    linkedin: fromJson?.linkedin || fromFlat.linkedin || '',
  };
};

const parseIdArray = ({ value }: { value: unknown }) => {
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
  @Allow()
  @IsOptional()
  socialLinks?: SocialLinksShape;

  // Flat multipart fallbacks (also used by parseSocialLinks via obj)
  @Transform(toOptionalTrimmedString)
  @IsString()
  @IsOptional()
  instagram?: string;

  @Transform(toOptionalTrimmedString)
  @IsString()
  @IsOptional()
  youtube?: string;

  @Transform(toOptionalTrimmedString)
  @IsString()
  @IsOptional()
  tiktok?: string;

  @Transform(toOptionalTrimmedString)
  @IsString()
  @IsOptional()
  facebook?: string;

  @Transform(toOptionalTrimmedString)
  @IsString()
  @IsOptional()
  website?: string;

  @Transform(toOptionalTrimmedString)
  @IsString()
  @IsOptional()
  linkedin?: string;

  @Transform(parseIdArray)
  @IsArray()
  @IsOptional()
  @IsString({ each: true })
  featuredCuisineIds?: string[];

  @Transform(toOptionalTrimmedString)
  @IsString()
  @IsOptional()
  contactEmail?: string;

  @Transform(toOptionalTrimmedString)
  @IsString()
  @IsOptional()
  mobileNumber?: string;

  @Transform(toOptionalTrimmedString)
  @IsString()
  @IsOptional()
  preferredContactName?: string;

  @Transform(toOptionalTrimmedString)
  @IsString()
  @IsOptional()
  organisation?: string;

  @Transform(toOptionalBoolean)
  @IsBoolean()
  @IsOptional()
  isPublished?: boolean;

  @Transform(toOptionalNumber)
  @IsNumber()
  @IsOptional()
  order?: number;
}
