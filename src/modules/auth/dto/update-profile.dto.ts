import { IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';
import { Gender } from '../../../database/schemas/nutrition/health-profile.schema';

export class UpdateProfileDto {
  @IsString()
  @IsOptional()
  name?: string;

  @IsString()
  @IsOptional()
  @MaxLength(60)
  first_name?: string;

  @IsString()
  @IsOptional()
  @MaxLength(60)
  last_name?: string;

  @IsString()
  @IsOptional()
  @MaxLength(32)
  phone_number?: string;

  @IsEnum(Gender)
  @IsOptional()
  gender?: Gender;
}
