import { IsNotEmpty, IsString } from 'class-validator';

export class CreateStickerDto {
  @IsString()
  @IsNotEmpty()
  title: string;

  @IsString()
  @IsNotEmpty()
  description: string;
}
