import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsDateString,
  IsEnum,
  IsHexColor,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  Min,
  ValidateNested,
} from 'class-validator';
import {
  PromoAudienceMembership,
  PromoImagePosition,
  PromoPlacement,
  PromoPlatform,
} from '../../../database/schemas/promo-card.schema';
import { PerksMembershipPlan } from '../../../database/schemas/perks-membership.schema';

export class PromoAudienceDto {
  @IsOptional()
  @IsEnum(PromoAudienceMembership)
  membership?: PromoAudienceMembership;

  @IsOptional()
  @IsArray()
  @IsEnum(PerksMembershipPlan, { each: true })
  plans?: PerksMembershipPlan[];

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  countries?: string[];

  @IsOptional()
  @IsArray()
  @IsEnum(PromoPlatform, { each: true })
  platforms?: PromoPlatform[];

  @IsOptional()
  @IsString()
  minAppVersion?: string | null;

  @IsOptional()
  @IsString()
  maxAppVersion?: string | null;
}

export class PromoScheduleDto {
  @IsOptional()
  @IsDateString()
  startsAt?: string | null;

  @IsOptional()
  @IsDateString()
  endsAt?: string | null;
}

/** Mirrors HeroImage. Produced by `POST /promos/image`, echoed back on save. */
export class PromoImageDto {
  @IsString()
  @IsNotEmpty()
  base: string;

  @IsOptional()
  @IsObject()
  variants?: Record<string, string>;

  @IsOptional()
  @IsNumber()
  width?: number;

  @IsOptional()
  @IsNumber()
  height?: number;

  @IsOptional()
  @IsString()
  thumbhash?: string;
}

export class PromoContentDto {
  @IsString()
  @IsNotEmpty()
  title: string;

  @IsString()
  @IsNotEmpty()
  body: string;

  @IsString()
  @IsNotEmpty()
  ctaLabel: string;

  @IsString()
  @IsNotEmpty()
  ctaDeepLink: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => PromoImageDto)
  image?: PromoImageDto | null;
}

export class PromoStyleDto {
  @IsOptional() @IsHexColor() backgroundColor?: string;
  @IsOptional() @IsHexColor() gradientFrom?: string | null;
  @IsOptional() @IsHexColor() gradientTo?: string | null;
  @IsOptional() @IsHexColor() borderColor?: string;
  @IsOptional() @IsHexColor() titleColor?: string;
  @IsOptional() @IsHexColor() bodyColor?: string;
  @IsOptional() @IsHexColor() ctaTextColor?: string;
  @IsOptional() @IsHexColor() ctaBackgroundColor?: string;

  @IsOptional() @IsNumber() @Min(0) borderWidth?: number;
  @IsOptional() @IsNumber() @Min(0) cornerRadius?: number;

  @IsOptional()
  @IsEnum(PromoImagePosition)
  imagePosition?: PromoImagePosition;
}

export class PromoBehaviourDto {
  @IsOptional()
  @IsBoolean()
  dismissible?: boolean;

  @IsOptional()
  @IsInt()
  @Min(0)
  reshowAfterDays?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  slotIndex?: number;
}

export class CreatePromoDto {
  @IsString()
  @IsNotEmpty()
  name: string;

  @IsEnum(PromoPlacement)
  placement: PromoPlacement;

  @IsOptional()
  @IsInt()
  priority?: number;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @IsOptional()
  @ValidateNested()
  @Type(() => PromoAudienceDto)
  audience?: PromoAudienceDto;

  @IsOptional()
  @ValidateNested()
  @Type(() => PromoScheduleDto)
  schedule?: PromoScheduleDto;

  @ValidateNested()
  @Type(() => PromoContentDto)
  content: PromoContentDto;

  @IsOptional()
  @ValidateNested()
  @Type(() => PromoStyleDto)
  style?: PromoStyleDto;

  @IsOptional()
  @ValidateNested()
  @Type(() => PromoBehaviourDto)
  behaviour?: PromoBehaviourDto;
}
