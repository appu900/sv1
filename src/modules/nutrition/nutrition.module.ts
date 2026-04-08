import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import {
  FoodItem,
  FoodItemSchema,
} from '../../database/schemas/nutrition/food-item.schema';
import {
  UserCustomFood,
  UserCustomFoodSchema,
} from '../../database/schemas/nutrition/user-custom-food.schema';
import {
  DailyIntake,
  DailyIntakeSchema,
} from '../../database/schemas/nutrition/daily-intake.schema';
import { FoodItemService } from './food-item.service';
import { UserCustomFoodService } from './user-custom-food.service';
import { NutritionService } from './nutrition.service';
import { NutritionController } from './nutrition.controller';
import { OpenFoodFactsProvider } from './providers/open-food-facts.provider';
import { UsdaProvider } from './providers/usda.provider';
import { CalorieNinjasProvider } from './providers/calorie-ninjas.provider';
import { HydraSearchService } from './hydra-search.service';
import { NutritionAiService } from './nutrition-ai.service';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: FoodItem.name, schema: FoodItemSchema },
      { name: UserCustomFood.name, schema: UserCustomFoodSchema },
      { name: DailyIntake.name, schema: DailyIntakeSchema },
    ]),
  ],
  controllers: [NutritionController],
  providers: [
    FoodItemService,
    UserCustomFoodService,
    NutritionService,
    OpenFoodFactsProvider,
    UsdaProvider,
    CalorieNinjasProvider,
    HydraSearchService,
    NutritionAiService,
  ],
  exports: [
    FoodItemService,
    UserCustomFoodService,
    NutritionService,
    OpenFoodFactsProvider,
    UsdaProvider,
    CalorieNinjasProvider,
    HydraSearchService,
  ],
})
export class NutritionModule {}
