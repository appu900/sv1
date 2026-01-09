import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import {
  UserFoodAnalyticalProfileDocument,
  UserFoodAnalyticsProfile,
} from 'src/database/schemas/user.food.analyticsProfile.schema';
import { FoodSavedEvent } from './analytics.service';
import { OnEvent } from '@nestjs/event-emitter';
import { Types } from 'mongoose';



@Injectable()
export class AnalyticsListner {
  private readonly logger = new Logger(AnalyticsListner.name);
  constructor(
    @InjectModel(UserFoodAnalyticsProfile.name)
    private readonly profileModel: Model<UserFoodAnalyticalProfileDocument>,
  ) {}

  @OnEvent('food.saved', { async: true })
  async updateUserProfile(event: FoodSavedEvent) {
    try {
      await this.profileModel.findOneAndUpdate(
        { userId: new Types.ObjectId(event.userId)  },
        {
          $inc: {
            foodSavedInGrams: event.foodSavedInGrams,
            numberOfMealsCooked: 1,
          },
        },
        {upsert:true}
      );
      this.logger.log(`update profile for user ${event.userId}`)
    } catch (error) {
        this.logger.error(`Failed to update profile:${error.message}`,error.stack)
    }
  }
}
