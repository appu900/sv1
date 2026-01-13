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

  /**
   * Get leaderboard with filters
   * Shows users ranked by meals cooked and/or food saved
   */
  async getLeaderboard(options: {
    period?: 'ALL_TIME' | 'YEARLY' | 'MONTHLY' | 'WEEKLY';
    metric?: 'MEALS_COOKED' | 'FOOD_SAVED' | 'BOTH';
    limit?: number;
    offset?: number;
    country?: string;
    stateCode?: string;
  }) {
    const {
      period = 'ALL_TIME',
      metric = 'BOTH',
      limit = 20,
      offset = 0,
      country,
      stateCode,
    } = options;

    // Build date filter based on period
    let dateFilter: any = {};
    const now = new Date();

    if (period === 'WEEKLY') {
      const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
      dateFilter = { updatedAt: { $gte: weekAgo } };
    } else if (period === 'MONTHLY') {
      const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
      dateFilter = { updatedAt: { $gte: monthStart } };
    } else if (period === 'YEARLY') {
      const yearStart = new Date(now.getFullYear(), 0, 1);
      dateFilter = { updatedAt: { $gte: yearStart } };
    }

    // Build aggregation pipeline
    const pipeline: any[] = [
      // Join with users collection
      {
        $lookup: {
          from: 'users',
          localField: 'userId',
          foreignField: '_id',
          as: 'user',
        },
      },
      {
        $unwind: '$user',
      },
    ];

    // Add date filter if needed (for non-ALL_TIME periods)
    if (Object.keys(dateFilter).length > 0) {
      pipeline.push({ $match: dateFilter });
    }

    // Add location filters if provided
    const matchConditions: any = {};
    if (country) {
      matchConditions['user.country'] = country;
    }
    if (stateCode) {
      matchConditions['user.stateCode'] = stateCode;
    }
    if (Object.keys(matchConditions).length > 0) {
      pipeline.push({ $match: matchConditions });
    }

    // Add sorting based on metric
    let sortField: any = {};
    if (metric === 'MEALS_COOKED') {
      sortField = { numberOfMealsCooked: -1 };
    } else if (metric === 'FOOD_SAVED') {
      sortField = { foodSavedInGrams: -1 };
    } else {
      // BOTH: Sort by a combined score (meals + food saved in kg)
      pipeline.push({
        $addFields: {
          combinedScore: {
            $add: [
              '$numberOfMealsCooked',
              { $divide: ['$foodSavedInGrams', 1000] },
            ],
          },
        },
      });
      sortField = { combinedScore: -1 };
    }

    pipeline.push(
      { $sort: sortField },
      { $skip: offset },
      { $limit: limit },
      {
        $lookup: {
          from: 'userbadges',
          localField: 'userId',
          foreignField: 'userId',
          as: 'badges',
        },
      },
      {
        $project: {
          rank: 1,
          userId: '$user._id',
          userName: '$user.name',
          userEmail: '$user.email',
          country: '$user.country',
          stateCode: '$user.stateCode',
          numberOfMealsCooked: 1,
          foodSavedInGrams: 1,
          foodSavedInKg: { $divide: ['$foodSavedInGrams', 1000] },
          badgeCount: { $size: '$badges' },
          combinedScore: 1,
          updatedAt: 1,
        },
      },
    );

    const results = await this.userFoodAnallyticsProfileModel.aggregate(pipeline);

    // Get total count for pagination
    const countPipeline = pipeline.slice(0, -3); // Remove skip, limit, and lookup
    const totalCount = await this.userFoodAnallyticsProfileModel.aggregate([
      ...countPipeline,
      { $count: 'total' }
    ]);
    const totalEntries = totalCount.length > 0 ? totalCount[0].total : 0;

    // Add rank to each entry based on offset
    const leaderboard = results.map((entry, index) => ({
      ...entry,
      rank: offset + index + 1,
      foodSavedInKg: Number(entry.foodSavedInKg.toFixed(2)),
    }));

    return {
      period,
      metric,
      limit,
      offset,
      filters: {
        country: country || 'all',
        stateCode: stateCode || 'all',
      },
      totalEntries,
      leaderboard,
    };
  }

  /**
   * Get user's rank and position in leaderboard
   */
  async getUserRank(userId: string, options: {
    period?: 'ALL_TIME' | 'YEARLY' | 'MONTHLY' | 'WEEKLY';
    metric?: 'MEALS_COOKED' | 'FOOD_SAVED' | 'BOTH';
  }) {
    const { period = 'ALL_TIME', metric = 'BOTH' } = options;

    // Get full leaderboard
    const leaderboardData = await this.getLeaderboard({
      period,
      metric,
      limit: 1000, // Get more entries to find user's rank
    });

    // Find user in leaderboard
    const userEntry = leaderboardData.leaderboard.find(
      (entry) => entry.userId.toString() === userId,
    );

    if (!userEntry) {
      return {
        found: false,
        message: 'User not found in leaderboard',
      };
    }

    // Get surrounding users (above and below)
    const userIndex = leaderboardData.leaderboard.indexOf(userEntry);
    const surrounding = {
      above: leaderboardData.leaderboard.slice(
        Math.max(0, userIndex - 2),
        userIndex,
      ),
      current: userEntry,
      below: leaderboardData.leaderboard.slice(
        userIndex + 1,
        Math.min(leaderboardData.leaderboard.length, userIndex + 3),
      ),
    };

    return {
      found: true,
      rank: userEntry.rank,
      totalUsers: leaderboardData.totalEntries,
      percentile: ((1 - userEntry.rank / leaderboardData.totalEntries) * 100).toFixed(1),
      userStats: {
        mealsCooked: userEntry.numberOfMealsCooked,
        foodSaved: userEntry.foodSavedInKg,
        badgeCount: userEntry.badgeCount,
      },
      surrounding,
      period,
      metric,
    };
  }

  /**
   * Get leaderboard stats summary
   */
  async getLeaderboardStats() {
    const [allTimeLeaders, monthlyLeaders, weeklyLeaders, totalActiveUsers] =
      await Promise.all([
        this.userFoodAnallyticsProfileModel
          .find()
          .sort({ numberOfMealsCooked: -1 })
          .limit(3)
          .populate('userId', 'name')
          .lean(),
        this.getLeaderboard({ period: 'MONTHLY', limit: 3 }),
        this.getLeaderboard({ period: 'WEEKLY', limit: 3 }),
        this.userFoodAnallyticsProfileModel.countDocuments({
          numberOfMealsCooked: { $gt: 0 },
        }),
      ]);

    return {
      totalActiveUsers,
      topAllTime: allTimeLeaders.map((leader, index) => ({
        rank: index + 1,
        userId: leader.userId,
        mealsCooked: leader.numberOfMealsCooked,
        foodSaved: (leader.foodSavedInGrams / 1000).toFixed(2),
      })),
      topMonthly: monthlyLeaders.leaderboard.slice(0, 3),
      topWeekly: weeklyLeaders.leaderboard.slice(0, 3),
    };
  }
}
