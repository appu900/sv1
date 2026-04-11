import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import OpenAI from 'openai';
import {
  MealPlan,
  MealPlanSchema,
} from '../../database/schemas/meal-plan.schema';
import {
  HealthProfile,
  HealthProfileSchema,
} from '../../database/schemas/nutrition/health-profile.schema';
import {
  UserInventoryItem,
  UserInventoryItemSchema,
} from '../../database/schemas/user-inventory.schema';
import {
  User,
  UserSchema,
} from '../../database/schemas/user.auth.schema';
import {
  userRecipe,
  UserRecipeSchema,
} from '../../database/schemas/user.schema';
import { MealPlanController } from './meal-plan.controller';
import { MealPlanService } from './meal-plan.service';
import { MealPlanAiService } from './meal-plan-ai.service';
import { CookbookaiModule } from '../cookbookai/cookbookai.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: MealPlan.name, schema: MealPlanSchema },
      { name: HealthProfile.name, schema: HealthProfileSchema },
      { name: UserInventoryItem.name, schema: UserInventoryItemSchema },
      { name: User.name, schema: UserSchema },
      { name: userRecipe.name, schema: UserRecipeSchema },
    ]),
    CookbookaiModule,
  ],
  controllers: [MealPlanController],
  providers: [
    {
      provide: 'OPENAI_CLIENT',
      useFactory: () => {
        const apiKey = process.env.OPENAI_API_KEY;
        return apiKey ? new OpenAI({ apiKey }) : null;
      },
    },
    MealPlanService,
    MealPlanAiService,
  ],
  exports: [MealPlanService],
})
export class MealPlanModule {}
