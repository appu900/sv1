import { IsArray, IsNotEmpty, IsString } from 'class-validator';

export class CreateDietDto {
  @IsArray()
  diets: string[];
}

export class UpdateDietDto {
  @IsString()
  @IsNotEmpty()
  name: string;
}
