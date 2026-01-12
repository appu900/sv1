import { Injectable } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import {
  Ingredient,
  IngredientDocument,
} from 'src/database/schemas/ingredient.schema';
import { Feedback, FeedbackDocument } from 'src/database/schemas/feedback.schema';
import { Recipe, RecipeDocument } from 'src/database/schemas/recipe.schema';
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
    @InjectModel(Recipe.name)
    private readonly recipeModel: Model<RecipeDocument>,
    @InjectModel(Feedback.name)
    private readonly feedbackModel: Model<FeedbackDocument>,
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
      .select('cookedRecipes numberOfMealsCooked')
      .lean();
    
    return { 
      cookedRecipes: profile?.cookedRecipes || [],
      numberOfMealsCooked: profile?.numberOfMealsCooked || 0,
    };
  }

  async getUserCookedRecipesDetails(userId: string) {
    const profile = await this.userFoodAnallyticsProfileModel
      .findOne({ userId: new Types.ObjectId(userId) })
      .select('cookedRecipes')
      .lean();

    const cookedIds: string[] = profile?.cookedRecipes || [];

    if (!cookedIds.length) {
      return { cookedRecipes: [] };
    }

    const recipes = await this.recipeModel
      .find({ _id: { $in: cookedIds.map(id => new Types.ObjectId(id)) } })
      .select('title heroImageUrl shortDescription')
      .lean();

    const items = (recipes as any[]).map(r => ({
      id: r._id.toString(),
      title: r.title,
      shortDescription: r.shortDescription,
      heroImageUrl: r.heroImageUrl,
    }));

    // Preserve the recent ordering (last 3)
    const idOrder = cookedIds.slice(-3);
    const map = new Map(items.map(i => [i.id, i]));
    const orderedRecent = idOrder.map(id => map.get(id)).filter(Boolean);

    return { cookedRecipes: orderedRecent };
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

  async getTrendingRecipes(limit: number = 5) {
    // Define current month range
    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 1);

    // Aggregate feedbacks for current month with valid framework_id
    let results = await this.feedbackModel.aggregate([
      {
        $match: {
          createdAt: { $gte: startOfMonth, $lt: endOfMonth },
          framework_id: { $exists: true, $ne: null },
        },
      },
      {
        $group: {
          _id: '$framework_id',
          count: { $sum: 1 },
        },
      },
      { $sort: { count: -1 } },
      { $limit: limit },
    ]);

    // Fallback to last 30 days if monthly has no results
    if (!results || results.length === 0) {
      const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
      results = await this.feedbackModel.aggregate([
        {
          $match: {
            createdAt: { $gte: thirtyDaysAgo },
            framework_id: { $exists: true, $ne: null },
          },
        },
        {
          $group: {
            _id: '$framework_id',
            count: { $sum: 1 },
          },
        },
        { $sort: { count: -1 } },
        { $limit: limit },
      ]);
    }

    const ids = results.map(r => r._id).filter(Boolean);
    if (!ids.length) return { trending: [] };

    const recipes = await this.recipeModel
      .find({ _id: { $in: ids.map(id => new Types.ObjectId(id)) } })
      .select('title heroImageUrl shortDescription')
      .lean();

    const byId = new Map(recipes.map((r: any) => [r._id.toString(), r]));
    const trending = results
      .map(r => {
        const rec = byId.get(r._id);
        if (!rec) return null;
        return {
          id: rec._id.toString(),
          title: rec.title,
          shortDescription: rec.shortDescription,
          heroImageUrl: rec.heroImageUrl,
          count: r.count,
        };
      })
      .filter(Boolean);

    return { trending };
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
