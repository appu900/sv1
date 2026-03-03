import { IsOptional, IsString, MinLength } from 'class-validator';

export class UpdateProfileDto {
  @IsString()
  @IsOptional()
  @MinLength(1)
  name?: string;
}
