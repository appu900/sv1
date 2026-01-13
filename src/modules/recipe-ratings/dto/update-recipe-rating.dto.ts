import { PartialType } from '@nestjs/mapped-types';
import { CreateRecipeRatingDto } from './create-recipe-rating.dto';

export class UpdateRecipeRatingDto extends PartialType(CreateRecipeRatingDto) {}
