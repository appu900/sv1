import { IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class CreateHackDto {
  @IsNotEmpty()
  @IsString()
  title: string;

  @IsNotEmpty()
  @IsString()
  description: string;

  @IsNotEmpty()
  @IsString()
  categoryId: string;

  @IsOptional()
  @IsString()
  youtubeLink: string;
}
