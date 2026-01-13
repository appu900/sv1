import { IsString, IsMongoId, IsOptional } from 'class-validator';

export class CreateRecipeRatingDto {
  @IsMongoId()
  recipeId: string;

  @IsMongoId()
  ratingTagId: string;

  @IsString()
  @IsOptional()
  review?: string;
}
