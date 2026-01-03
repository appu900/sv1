import { IsNotEmpty, IsString } from 'class-validator';

export class CreateCatgoryDto {
  @IsNotEmpty()
  @IsString()
  name: string;

  @IsString()
  @IsNotEmpty()
  description: string;
}
