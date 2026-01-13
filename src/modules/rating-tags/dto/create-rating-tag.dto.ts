import { IsString, IsInt, IsOptional, IsBoolean, MaxLength } from 'class-validator';

export class CreateRatingTagDto {
  @IsString()
  @MaxLength(100)
  name: string;

  @IsInt()
  order: number;

  @IsString()
  @IsOptional()
  description?: string;

  @IsBoolean()
  @IsOptional()
  isActive?: boolean;
}
