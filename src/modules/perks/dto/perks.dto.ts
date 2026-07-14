import { Type } from 'class-transformer';
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
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateIf,
  ValidateNested,
} from 'class-validator';

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
