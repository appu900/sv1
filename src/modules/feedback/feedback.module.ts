import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { FeedbackService } from './feedback.service';
import { FeedbackController } from './feedback.controller';
import { Feedback, FeedbackSchema } from 'src/database/schemas/feedback.schema';
import {
  Ingredient,
  IngredientSchema,
} from 'src/database/schemas/ingredient.schema';
import { User, UserSchema } from 'src/database/schemas/user.auth.schema';
import { Recipe, RecipeSchema } from 'src/database/schemas/recipe.schema';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Feedback.name, schema: FeedbackSchema },
      { name: Ingredient.name, schema: IngredientSchema },
      { name: User.name, schema: UserSchema },
      { name: Recipe.name, schema: RecipeSchema },
    ]),
  ],
  controllers: [FeedbackController],
  providers: [FeedbackService],
  exports: [FeedbackService],
})
export class FeedbackModule {}
