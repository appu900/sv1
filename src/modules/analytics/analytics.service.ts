import { Injectable } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
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
  frameworkId?: string;  // Recipe/framework that was cooked
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

  async saveFood(userId: string, ingredinatIds: string[], frameworkId?: string) {
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
      timestamp: new Date(),
      frameworkId,
    } as FoodSavedEvent);
    return { sucess: true, foodsaved: foodSavedInGrams };
  }

  async getUserCookedRecipes(userId: string) {
    const profile = await this.userFoodAnallyticsProfileModel
      .findOne({ userId: new Types.ObjectId(userId) })
      .select('cookedRecipes')
      .lean();
    
    return { 
      cookedRecipes: profile?.cookedRecipes || [],
    };
  }

  async getUserStats(userId: string) {
    const profile = await this.userFoodAnallyticsProfileModel
      .findOne({ userId: new Types.ObjectId(userId) })
      .lean();

    if (!profile) {
      return {
        food_savings_user: '0',
        completed_meals_count: 0,
        best_food_savings: null,
        total_co2_savings: null,
        total_cost_savings: null,
        best_co2_savings: null,
        best_cost_savings: null,
      };
    }

    // Convert grams to kg for display
    const foodSavedInKg = (profile.foodSavedInGrams || 0) / 1000;
    
    return {
      food_savings_user: foodSavedInKg.toFixed(2),
      completed_meals_count: profile.numberOfMealsCooked || 0,
      best_food_savings: null, // TODO: Track best savings
      total_co2_savings: null, // TODO: Calculate CO2 savings
      total_cost_savings: null, // TODO: Calculate cost savings
      best_co2_savings: null,
      best_cost_savings: null,
    };
  }

  async getAllUsersStats() {
    const result = await this.userFoodAnallyticsProfileModel.aggregate([
      {
        $group: {
          _id: null,
          totalFoodSaved: { $sum: '$foodSavedInGrams' },
          totalMeals: { $sum: '$numberOfMealsCooked' },
        },
      },
    ]);

    const stats = result[0] || { totalFoodSaved: 0, totalMeals: 0 };
    const foodSavedInKg = stats.totalFoodSaved / 1000;

    return {
      food_savings_all_users: foodSavedInKg.toFixed(2),
      total_meals_all_users: stats.totalMeals,
    };
  }

  async getStats(userId: string) {
    const [userStats, allUsersStats] = await Promise.all([
      this.getUserStats(userId),
      this.getAllUsersStats(),
    ]);

    return {
      ...userStats,
      food_savings_all_users: allUsersStats.food_savings_all_users,
    };
  }
}
