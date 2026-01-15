import { IsArray, IsBoolean, IsNotEmpty, IsNumber, IsOptional, IsString } from 'class-validator';

export class UserProfileDto {
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

  @IsOptional()
  @IsArray()
  otherAllergies?: string[];

  @IsOptional()
  @IsString()
  country?: string;

  @IsNumber()
  @IsOptional()
  noOfChildren?: number;

  @IsNumber()
  @IsOptional()
  noOfAdults?: number;
}
