import { IsString, IsOptional } from 'class-validator';

export class UpdateFoodFactDto {
  @IsOptional()
  @IsString()
  title?: string;

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
