import { IsNotEmpty, IsString, IsOptional } from 'class-validator';

export class CreateFoodFactDto {
  @IsNotEmpty()
  @IsString()
  title: string;

  @IsOptional()
  @IsString()
  sponsor?: string;

  @IsOptional()
  @IsString()
  relatedIngredient?: string;

  @IsOptional()
  @IsString()
  factOrInsight?: string;
}
