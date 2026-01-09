import { Global, Module } from '@nestjs/common';
import { AnalyticsController } from './analytics.controller';
import { AnalyticsService } from './analytics.service';
import { AnalyticsListner } from './analytics.listener';
import { MongooseModule } from '@nestjs/mongoose';
import { UserFoodAnalyticalProfileSchema, UserFoodAnalyticsProfile } from 'src/database/schemas/user.food.analyticsProfile.schema';
import { Ingredient, IngredientSchema } from 'src/database/schemas/ingredient.schema';

@Global()
@Module({
  imports: [MongooseModule.forFeature([
    {name:UserFoodAnalyticsProfile.name,schema:UserFoodAnalyticalProfileSchema},
    {name:Ingredient.name,schema:IngredientSchema}
  ])],
  providers: [AnalyticsService,AnalyticsListner],
  controllers: [AnalyticsController],
  exports:[]
})
export class AnalyticsModule {}
