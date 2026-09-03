import { IsString, IsEmail, IsNotEmpty, IsOptional, IsBoolean, IsArray, IsNumber } from 'class-validator';

export class RegisterUserDto {
  /** Account email. */
  @IsEmail()
  @IsNotEmpty()
  email: string;

  /** Display name. */
  @IsString()
  @IsNotEmpty()
  name: string;

  /** Account password. */
  @IsString()
  @IsNotEmpty()
  password: string;

  @IsString()
  @IsOptional()
  role?: string;

  @IsString()
  @IsOptional()
  country?: string;

  @IsString()
  @IsOptional()
  stateCode?: string;

  // Dietary profile fields
  @IsString()
  @IsOptional()
  vegType?: string;

  @IsBoolean()
  @IsOptional()
  dairyFree?: boolean;

  @IsBoolean()
  @IsOptional()
  nutFree?: boolean;

  @IsBoolean()
  @IsOptional()
  glutenFree?: boolean;

  @IsBoolean()
  @IsOptional()
  hasDiabetes?: boolean;

  @IsArray()
  @IsOptional()
  otherAllergies?: string[];

  @IsNumber()
  @IsOptional()
  noOfAdults?: number;

  @IsNumber()
  @IsOptional()
  noOfChildren?: number;

  @IsArray()
  @IsOptional()
  tastePreference?: string[];
}
