import { IsString, IsMongoId, IsOptional, IsInt, Min, Max } from 'class-validator';

export class CreateRecipeRatingDto {
  @IsMongoId()
  recipeId: string;

  @IsInt()
  @Min(1)
  @Max(5)
  rating: number;

  @IsString()
  @IsOptional()
  review?: string;
}
