import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { RecipeRatingsService } from './recipe-ratings.service';
import { RecipeRatingsController } from './recipe-ratings.controller';
import { RecipeRating, RecipeRatingSchema } from 'src/database/schemas/recipe-rating.schema';
import { RatingTagsModule } from '../rating-tags/rating-tags.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: RecipeRating.name, schema: RecipeRatingSchema },
    ]),
    RatingTagsModule,
  ],
  controllers: [RecipeRatingsController],
  providers: [RecipeRatingsService],
  exports: [RecipeRatingsService],
})
export class RecipeRatingsModule {}
