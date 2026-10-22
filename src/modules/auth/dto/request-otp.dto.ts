import { IsEmail, IsNotEmpty, IsString, MinLength, IsOptional, IsArray, IsBoolean, IsNumber, IsIn, MaxLength } from 'class-validator';
import { Transform } from 'class-transformer';
import { REFERRAL_SOURCES } from '../../../database/schemas/referral-attribution.schema';

export class RequestOtpDto {
  @IsEmail({}, { message: 'Please provide a valid email address' })
  @IsNotEmpty()
  @Transform(({ value }) => value?.toLowerCase()?.trim())
  email: string;

  @IsString()
  @IsNotEmpty()
  name: string;

  @IsString()
  @IsNotEmpty()
  @MinLength(6)
  password: string;

  @IsString()
  @IsNotEmpty()
  confirmPassword: string;

  @IsOptional()
  @IsString()
  country?: string;

  @IsOptional()
  @IsString()
  stateCode?: string;

  @IsOptional()
  @IsString()
  vegType?: string;

  @IsOptional()
  @IsBoolean()
  dairyFree?: boolean;

  @IsOptional()
  @IsBoolean()
  nutFree?: boolean;

  @IsOptional()
  @IsBoolean()
  glutenFree?: boolean;

  @IsOptional()
  @IsBoolean()
  hasDiabetes?: boolean;

  @IsOptional()
  @IsArray()
  otherAllergies?: string[];

  @IsOptional()
  @IsNumber()
  noOfAdults?: number;

  @IsOptional()
  @IsNumber()
  noOfChildren?: number;

  @IsOptional()
  @IsArray()
  tastePreference?: string[];

  /** Chef referral code captured from a link, install referrer or typed in. */
  @IsOptional()
  @IsString()
  @MaxLength(200)
  referralCode?: string;

  @IsOptional()
  @IsIn(REFERRAL_SOURCES)
  referralSource?: string;
}
