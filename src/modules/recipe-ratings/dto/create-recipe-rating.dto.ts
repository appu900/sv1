import { IsString, IsUUID, IsOptional } from 'class-validator';

export class CreateRecipeRatingDto {
  @IsUUID()
  recipeId: string;

  @IsUUID()
  ratingTagId: string;

  @IsString()
  @IsOptional()
  review?: string;
}
