import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';
import { ThrottlerModule } from '@nestjs/throttler';
import OpenAI from 'openai';
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
import {
  HealthProfile,
  HealthProfileSchema,
} from '../../database/schemas/nutrition/health-profile.schema';
import {
  User,
  UserSchema,
} from '../../database/schemas/user.auth.schema';
import { FoodItemService } from './food-item.service';
import { UserCustomFoodService } from './user-custom-food.service';
import { NutritionService } from './nutrition.service';
import { HealthProfileService } from './health-profile.service';
import { NutritionController } from './nutrition.controller';
import { OpenFoodFactsProvider } from './providers/open-food-facts.provider';
import { UsdaProvider } from './providers/usda.provider';
import { CalorieNinjasProvider } from './providers/calorie-ninjas.provider';
import { HydraSearchService } from './hydra-search.service';
import { NutritionAiService } from './nutrition-ai.service';

@Module({
  imports: [
    ConfigModule,
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 30 }]),
    MongooseModule.forFeature([
      { name: FoodItem.name, schema: FoodItemSchema },
      { name: UserCustomFood.name, schema: UserCustomFoodSchema },
      { name: DailyIntake.name, schema: DailyIntakeSchema },
      { name: HealthProfile.name, schema: HealthProfileSchema },
      { name: User.name, schema: UserSchema },
    ]),
  ],
  controllers: [NutritionController],
  providers: [
    {
      provide: 'OPENAI_CLIENT',
      useFactory: () => {
        const apiKey = process.env.OPENAI_API_KEY;
        return apiKey ? new OpenAI({ apiKey }) : null;
      },
    },
    FoodItemService,
    UserCustomFoodService,
    NutritionService,
    HealthProfileService,
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
    HealthProfileService,
    OpenFoodFactsProvider,
    UsdaProvider,
    CalorieNinjasProvider,
    HydraSearchService,
  ],
})
export class NutritionModule {}
