import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { CookbookaiController } from './cookbookai.controller';
import { CookbookaiService } from './cookbookai.service';
import { userRecipe, UserRecipeSchema } from 'src/database/schemas/user.schema';
import { Ingredient, IngredientSchema } from 'src/database/schemas/ingredient.schema';
import {
  IngredientsCategory,
  ingredinatsCategorySchema,
} from 'src/database/schemas/ingredinats.Category.schema';
import { HackOrTip, HackOrTipSchema } from 'src/database/schemas/hack-or-tip.schema';
import {
  FrameworkCategory,
  FrameworkCategorySchema,
} from 'src/database/schemas/framework-category.schema';
import { Recipe, RecipeSchema } from 'src/database/schemas/recipe.schema';
import { RedisModule } from 'src/redis/redis.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: userRecipe.name, schema: UserRecipeSchema },
      { name: Ingredient.name, schema: IngredientSchema },
      { name: IngredientsCategory.name, schema: ingredinatsCategorySchema },
      { name: HackOrTip.name, schema: HackOrTipSchema },
      { name: FrameworkCategory.name, schema: FrameworkCategorySchema },
      { name: Recipe.name, schema: RecipeSchema },
    ]),
    RedisModule,
  ],
  controllers: [CookbookaiController],
  providers: [CookbookaiService],
})
export class CookbookaiModule {}
