import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsEmail,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  IsIn,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateIf,
  ValidateNested,
} from 'class-validator';

export enum PerksCatalogueSort {
  NAME_ASC = 'name',
  DISCOUNT_DESC = 'discount-desc',
  DISCOUNT_ASC = 'discount-asc',
}

export class PerksCatalogueQueryDto {
  @IsOptional()
  @IsString()
  @MaxLength(100)
  q?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  category?: string;

  @IsOptional()
  @IsEnum(PerksCatalogueSort)
  sort?: PerksCatalogueSort;

  @IsOptional()
  @Transform(({ value }) =>
    value === true || value === 'true'
      ? true
      : value === false || value === 'false'
        ? false
        : value,
  )
  @IsBoolean()
  featured?: boolean;
}

export class PerksOrderListQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit = 20;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  offset = 0;
}

export class PerksWalletQueryDto {
  @IsOptional()
  @IsIn(['active', 'archived'])
  state: 'active' | 'archived' = 'active';
}

export class CancelPerksMembershipDto {
  @IsOptional()
  @IsString()
  @MaxLength(300)
  reason?: string;
}

export class PerksGiftOptionsQueryDto {
  @IsOptional()
  @IsString()
  @Matches(/^\d+$/)
  ecardId?: string;
}

export class PerksMembershipEventsQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  limit = 50;
}

export class AddPerksFavouriteDto {
  @IsString()
  @Matches(/^\d+$/)
  ecardId: string;
}

export class PerksCartItemDto {
  @IsString()
  @Matches(/^\d+$/)
  ecardId: string;

  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @IsPositive()
  ecardValue: number;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  quantity: number;

  @IsOptional()
  @IsBoolean()
  sendAsGift?: boolean;

  @ValidateIf((value) => value.sendAsGift === true)
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  giftRecipientName?: string;

  @ValidateIf((value) => value.sendAsGift === true)
  @IsEmail()
  giftRecipientEmail?: string;

  @ValidateIf((value) => value.sendAsGift === true)
  @IsString()
  @Matches(/^\d+$/)
  giftTemplateId?: string;
}

export class QuotePerksDto extends PerksCartItemDto {}

export class UpdatePerksCartItemDto {
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @IsPositive()
  ecardValue?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  quantity?: number;
}

export class CreatePerksOrderDto {
  @IsString()
  @Matches(/^\d+$/)
  ecardId: string;

  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @IsPositive()
  ecardValue: number;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  quantity: number;

  @IsOptional()
  @IsBoolean()
  sendAsGift?: boolean;

  @ValidateIf((value) => value.sendAsGift === true)
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  giftRecipientName?: string;

  @ValidateIf((value) => value.sendAsGift === true)
  @IsEmail()
  giftRecipientEmail?: string;

  @IsOptional()
  @IsString()
  @Matches(/^\d{8,11}$/)
  giftRecipientPhone?: string;

  @ValidateIf((value) => value.sendAsGift === true)
  @IsString()
  @Matches(/^\d+$/)
  giftTemplateId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  giftUseCode?: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  giftReferenceNumber?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  giftCategory?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  giftSubcategory?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  giftConsultantName?: string;

  @IsOptional()
  @IsEmail()
  giftConsultantEmail?: string;
}

export enum PerksSpendFrequency {
  WEEKLY = 'weekly',
  MONTHLY = 'monthly',
  ANNUALLY = 'annually',
}

export class PerksCalculatorLineItemDto {
  @IsString()
  @IsNotEmpty()
  category: string;

  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  amount: number;

  @IsEnum(PerksSpendFrequency)
  frequency: PerksSpendFrequency;
}

export class CalculatePerksDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => PerksCalculatorLineItemDto)
  items: PerksCalculatorLineItemDto[];
}
