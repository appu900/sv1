import { Injectable } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import {
  Ingredient,
  IngredientDocument,
} from 'src/database/schemas/ingredient.schema';
import {
  UserFoodAnalyticalProfileDocument,
  UserFoodAnalyticsProfile,
} from 'src/database/schemas/user.food.analyticsProfile.schema';

export interface FoodSavedEvent {
  userId: string;
  foodSavedInGrams: number;
  ingredinatIds: string[];
  timestamp: Date;
}

@Injectable()
export class AnalyticsService {
  constructor(
    @InjectModel(UserFoodAnalyticsProfile.name)
    private readonly userFoodAnallyticsProfileModel: Model<UserFoodAnalyticalProfileDocument>,
    @InjectModel(Ingredient.name)
    private readonly ingredinatModel: Model<IngredientDocument>,
    private readonly eventEmmiter: EventEmitter2,
  ) {}

  async saveFood(userId: string, ingredinatIds: string[]) {
    const ingredinats = await this.ingredinatModel
      .find({ _id: { $in: ingredinatIds } })
      .select('averageWeight')
      .lean();
    const foodSavedInGrams = ingredinats.reduce(
      (sum, i) => sum + (i.averageWeight || 0),
      0,
    );
    // ** update the user analytics profile
    this.eventEmmiter.emit('food.saved', {
      userId,
      foodSavedInGrams,
      ingredinatIds,
      timeStamp: new Date(),
    } as unknown as FoodSavedEvent);
    return { sucess: true, foodsaved: foodSavedInGrams };
  }
}
