import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { MulterModule } from '@nestjs/platform-express';
import { RecipeController } from './recipe.controller';
import { RecipeService } from './recipe.service';
import { ServingScaleService } from './serving-scale.service';
import { Recipe, RecipeSchema } from '../../database/schemas/recipe.schema';
import { FrameworkCategory, FrameworkCategorySchema } from '../../database/schemas/framework-category.schema';
import { Ingredient, IngredientSchema } from '../../database/schemas/ingredient.schema';
import { DietCategory, DietCategorySchema } from '../../database/schemas/diet.schema';
import { ScaledPortionsCache, ScaledPortionsCacheSchema } from '../../database/schemas/scaled-portions-cache.schema';
import { RedisModule } from '../../redis/redis.module';
import { ImageUploadModule } from '../image-upload/image-upload.module';
import { ChefModule } from '../chef/chef.module';
import { forwardRef } from '@nestjs/common';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Recipe.name, schema: RecipeSchema },
      { name: FrameworkCategory.name, schema: FrameworkCategorySchema },
      { name: Ingredient.name, schema: IngredientSchema },
      { name: DietCategory.name, schema: DietCategorySchema },
      { name: ScaledPortionsCache.name, schema: ScaledPortionsCacheSchema },
    ]),
    MulterModule.register({
      limits: {
        fileSize: 10 * 1024 * 1024,
        files: 10, 
        fields: 100,
      },
    }),
    RedisModule,
    ImageUploadModule,
    forwardRef(() => ChefModule),
  ],
  controllers: [RecipeController],
  providers: [RecipeService, ServingScaleService],
  exports: [RecipeService],
})
export class RecipeModule {}