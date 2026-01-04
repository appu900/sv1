import { IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class CreateStickerDto {
  @IsString()
  @IsNotEmpty()
  title: string;

  @IsString()
  @IsOptional()
  description?: string;
}
