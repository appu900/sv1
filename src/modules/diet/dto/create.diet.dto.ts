import { IsArray } from 'class-validator';

export class CreateDietDto {
  @IsArray()
  diets: string[];
}
