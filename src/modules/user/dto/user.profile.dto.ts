import { IsArray, IsBoolean, IsNotEmpty, IsNumber, IsOptional, IsString } from 'class-validator';

export class UserProfileDto {
  @IsString()
  @IsNotEmpty()
  vegType: string;

  @IsBoolean()
  @IsNotEmpty()
  dairyFree: boolean;

  @IsBoolean()
  @IsNotEmpty()
  nutFree: boolean;

  @IsBoolean()
  @IsNotEmpty()
  glutenFree: boolean;

  @IsBoolean()
  @IsNotEmpty()
  hasDiabetes: boolean;


  @IsOptional()
  @IsArray()
  allergies: string[];

  @IsNotEmpty()
  @IsString()
  country:string;


  @IsNumber()
  @IsOptional()
  noOfChildren:number

  @IsNumber()
  @IsOptional()
  noOfAdults:number
}
