import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { BullModule } from '@nestjs/bullmq';
import { CookbookaiController } from './cookbookai.controller';
import { CookbookaiService } from './cookbookai.service';
import { CookbookaiProducer } from './cookbookai.producer';
import { CookbookaiWorker } from './cookbookai.worker';
import { userRecipe, UserRecipeSchema } from 'src/database/schemas/user.schema';
import { Ingredient, IngredientSchema } from 'src/database/schemas/ingredient.schema';
import { HackOrTip, HackOrTipSchema } from 'src/database/schemas/hack-or-tip.schema';
import {
  FrameworkCategory,
  FrameworkCategorySchema,
} from 'src/database/schemas/framework-category.schema';
import { Recipe, RecipeSchema } from 'src/database/schemas/recipe.schema';
import { RedisModule } from 'src/redis/redis.module';
import { NotificationModule } from '../notification/notification.module';
import { COOKBOOKAI_QUEUE_NAME } from './cookbookai.constants';

@Module({
  imports: [
    BullModule.registerQueue({
      name: COOKBOOKAI_QUEUE_NAME,
    }),
    MongooseModule.forFeature([
      { name: userRecipe.name, schema: UserRecipeSchema },
      { name: Ingredient.name, schema: IngredientSchema },
      { name: HackOrTip.name, schema: HackOrTipSchema },
      { name: FrameworkCategory.name, schema: FrameworkCategorySchema },
      { name: Recipe.name, schema: RecipeSchema },
    ]),
    RedisModule,
    NotificationModule,
  ],
  controllers: [CookbookaiController],
  providers: [CookbookaiService, CookbookaiProducer, CookbookaiWorker],
})
export class CookbookaiModule {}
