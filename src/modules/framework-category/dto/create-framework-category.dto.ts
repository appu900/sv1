import { IsString, IsNotEmpty, IsOptional } from 'class-validator';

export class CreateFrameworkCategoryDto {
  @IsString()
  @IsNotEmpty()
  title: string;

  @IsString()
  @IsOptional()
  description?: string;
}
