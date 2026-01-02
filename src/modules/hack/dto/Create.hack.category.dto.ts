import { IsNotEmpty, IsString } from 'class-validator';

export class CreateHackCategoryDto {
  @IsString()
  @IsNotEmpty()
  name: string;
}
