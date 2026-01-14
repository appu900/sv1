import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { RecipeRatingsService } from './recipe-ratings.service';
import { RecipeRatingsController } from './recipe-ratings.controller';
import { RecipeRating, RecipeRatingSchema } from 'src/database/schemas/recipe-rating.schema';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: RecipeRating.name, schema: RecipeRatingSchema },
    ]),
  ],
  controllers: [RecipeRatingsController],
  providers: [RecipeRatingsService],
  exports: [RecipeRatingsService],
})
export class RecipeRatingsModule {}
