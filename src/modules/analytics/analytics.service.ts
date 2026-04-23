import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import OpenAI from "openai";
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
import { User } from 'src/database/schemas/user.auth.schema';
import { LeaderboardProfile, LeaderboardProfileDocument } from 'src/database/schemas/leaderboard-profile.schema';
import { FoodSavedEventLog, FoodSavedEventLogDocument } from 'src/database/schemas/food-saved-event-log.schema';
import { RedisService } from 'src/redis/redis.service';
import { normalizeCountry } from '../../utils/countries.util';
import { fallbackPriceInLocalCurrency, fallbackCo2SavedKg } from './utils/fallback-pricing.util';

export interface FoodSavedEvent {
  userId: string;
  foodSavedInGrams: number;
  ingredinatIds: string[];
  timestamp: Date;
  frameworkId?: string;  
  totalPriceInLocalCurrency?: number; 
  totalCo2SavedInGrams?: number;
  country?: string;
  idempotencyKey?: string | null;
}

export interface PriceCalculationResult {
  ingredient: string;
  weightInGrams: number;
  country: string;
  priceInLocalCurrency: number;
}

export interface Co2CalculationResult {
  ingredient: string;
  weightInGrams: number;
  country: string;
  co2SavedKg: number;
}

@Injectable()
export class AnalyticsService {
  private readonly logger = new Logger(AnalyticsService.name);
  private readonly openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
  });

  private readonly AI_TIMEOUT_MS = 4000;
  private readonly AI_MAX_ATTEMPTS = 2;
  private readonly PRICE_CACHE_TTL_SEC = 7 * 24 * 3600; // 7 days
  private readonly LEADERBOARD_CACHE_TTL_SEC = 60;
  private readonly TRENDING_CACHE_TTL_SEC = 5 * 60;

  constructor(
    @InjectModel(UserFoodAnalyticsProfile.name)
    private readonly userFoodAnallyticsProfileModel: Model<UserFoodAnalyticalProfileDocument>,
    @InjectModel(Ingredient.name)
    private readonly ingredinatModel: Model<IngredientDocument>,
    @InjectModel(Recipe.name)
    private readonly recipeModel: Model<RecipeDocument>,
    @InjectModel(User.name)
    private readonly userModel: Model<User>,
    @InjectModel(Feedback.name)
    private readonly feedbackModel: Model<FeedbackDocument>,
    @InjectModel(LeaderboardProfile.name)
    private readonly leaderboardProfileModel: Model<LeaderboardProfileDocument>,
    @InjectModel(FoodSavedEventLog.name)
    private readonly foodSavedEventLogModel: Model<FoodSavedEventLogDocument>,
    private readonly redisService: RedisService,
    private readonly eventEmmiter: EventEmitter2,
  ) {}
async saveFood(
  userId: string,
  ingredinatIds: string[] = [],
  frameworkId?: string,
  directIngredients?: { name: string; averageWeight: number }[],
  idempotencyKey?: string,
) {
  const user = await this.userModel.findOne({ _id: userId }).lean();
  if (!user) throw new NotFoundException('User not found');
  const country = normalizeCountry(user.country || 'India') || 'India';

  if (idempotencyKey) {
    const existing = await this.foodSavedEventLogModel
      .findOne({ userId: new Types.ObjectId(userId), idempotencyKey })
      .lean();
    if (existing) {
      return {
        success: true,
        duplicate: true,
        foodSavedInGrams: existing.foodSavedInGrams,
        ingredientNames: '',
        country: existing.country,
        totalPriceInLocalCurrency: existing.moneySaved,
        breakdown: [],
        co2Breakdown: [],
        totalCo2SavedInKg: Number(((existing.co2SavedInGrams ?? 0) / 1000).toFixed(3)),
      };
    }
  }

  let ingredinats: Array<{ name: string; averageWeight: number }>;
  if (ingredinatIds && ingredinatIds.length > 0) {
    const dbIngredients = await this.ingredinatModel.find({ _id: { $in: ingredinatIds } }).lean();
    ingredinats = dbIngredients.map(i => ({ name: i.name, averageWeight: i.averageWeight || 0 }));
  } else {
    ingredinats = (directIngredients || []).map(i => ({ name: i.name, averageWeight: i.averageWeight || 0 }));
  }

  const foodSavedInGrams = ingredinats.reduce((sum, i) => sum + (i.averageWeight || 0), 0);
  const ingredientNames = ingredinats.map(i => i.name).join(', ') || 'none';

  let aiResults: PriceCalculationResult[] = [];
  let co2Results: Co2CalculationResult[] = [];
  if (ingredinats.length > 0) {
    [aiResults, co2Results] = await Promise.all([
      Promise.all(ingredinats.map(i => this.calculatePriceWithAI(i.name, i.averageWeight || 0, country))),
      Promise.all(ingredinats.map(i => this.calculateCo2SavedWithAI(i.name, i.averageWeight || 0, country))),
    ]);
  }
  const totalPriceInLocalCurrency = aiResults.reduce(
    (sum, r) => sum + Math.max(0, r.priceInLocalCurrency || 0),
    0,
  );
  const totalCo2SavedInGrams = co2Results.reduce(
    (sum, r) => sum + Math.max(0, (r.co2SavedKg || 0) * 1000),
    0,
  );

  this.eventEmmiter.emit('food.saved', {
    userId,
    foodSavedInGrams,
    ingredinatIds,
    timestamp: new Date(),
    frameworkId,
    totalPriceInLocalCurrency,
    totalCo2SavedInGrams,
    country,
    idempotencyKey: idempotencyKey ?? null,
  });

  return {
    success: true,
    duplicate: false,
    foodSavedInGrams,
    ingredientNames,
    country,
    totalPriceInLocalCurrency,
    breakdown: aiResults,
    co2Breakdown: co2Results,
    totalCo2SavedInKg: Number((totalCo2SavedInGrams / 1000).toFixed(3)),
  };
}
private async callOpenAIWithRetry(
  messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[],
): Promise<string> {
  let lastErr: any;
  for (let attempt = 1; attempt <= this.AI_MAX_ATTEMPTS; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.AI_TIMEOUT_MS);
    try {
      const response = await this.openai.chat.completions.create(
        {
          model: 'gpt-4.1',
          messages,
          temperature: 0.2,
          response_format: { type: 'json_object' },
        },
        { signal: controller.signal as any },
      );
      const content = response.choices[0]?.message?.content;
      if (!content) throw new Error('empty AI content');
      return content;
    } catch (err: any) {
      lastErr = err;
      this.logger.warn(
        `openai attempt ${attempt}/${this.AI_MAX_ATTEMPTS} failed: ${err?.message}`,
      );
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastErr ?? new Error('openai failed');
}

private priceCacheKey(ingredient: string, country: string): string {
  return `analytics:price:v2:${country}:${ingredient.trim().toLowerCase().slice(0, 80)}`;
}
private co2CacheKey(ingredient: string, country: string): string {
  return `analytics:co2:v2:${country}:${ingredient.trim().toLowerCase().slice(0, 80)}`;
}


  async calculatePriceWithAI(
    ingredientName: string,
    weightInGrams: number,
    country: string,
  ): Promise<PriceCalculationResult> {
    const safeName = (ingredientName || '').trim();
    if (!safeName || weightInGrams <= 0) {
      return { ingredient: safeName, weightInGrams, country, priceInLocalCurrency: 0 };
    }

    const cacheKey = this.priceCacheKey(safeName, country);
    try {
      const cached = await this.redisService.get<number>(cacheKey);
      if (typeof cached === 'number' && cached >= 0) {
        return {
          ingredient: safeName,
          weightInGrams,
          country,
          priceInLocalCurrency: Number((cached * weightInGrams).toFixed(2)),
        };
      }
    } catch (err: any) {
      this.logger.warn(`price cache read failed: ${err?.message}`);
    }

    try {
      const content = await this.callOpenAIWithRetry([
        {
          role: 'system',
          content:
            'You estimate the price of a food ingredient in the local currency of a given country. Respond with STRICT JSON only — no prose.',
        },
        {
          role: 'user',
          content: `Estimate the price of:\n- ingredient: ${safeName}\n- weight: ${weightInGrams} grams\n- country: ${country}\n\nReturn JSON exactly:\n{"ingredient":"","weightInGrams":0,"country":"","priceInLocalCurrency":0}\nPrice must be in the local currency of ${country}.`,
        },
      ]);
      const parsed = JSON.parse(content);
      const price = Math.max(0, Number(parsed?.priceInLocalCurrency) || 0);
      if (price > 0) {
        // Cache as price-per-gram so a different weight still benefits.
        const perGram = price / weightInGrams;
        void this.redisService.set(cacheKey, perGram, this.PRICE_CACHE_TTL_SEC);
      }
      return {
        ingredient: safeName,
        weightInGrams,
        country,
        priceInLocalCurrency: price > 0
          ? Number(price.toFixed(2))
          : fallbackPriceInLocalCurrency(weightInGrams, country),
      };
    } catch (err: any) {
      this.logger.error(`price AI fallback for "${safeName}": ${err?.message}`);
      return {
        ingredient: safeName,
        weightInGrams,
        country,
        priceInLocalCurrency: fallbackPriceInLocalCurrency(weightInGrams, country),
      };
    }
  }

  async calculateCo2SavedWithAI(
    ingredientName: string,
    weightInGrams: number,
    country: string,
  ): Promise<Co2CalculationResult> {
    const safeName = (ingredientName || '').trim();
    if (!safeName || weightInGrams <= 0) {
      return { ingredient: safeName, weightInGrams, country, co2SavedKg: 0 };
    }

    const cacheKey = this.co2CacheKey(safeName, country);
    try {
      const cached = await this.redisService.get<number>(cacheKey);
      if (typeof cached === 'number' && cached >= 0) {
        return {
          ingredient: safeName,
          weightInGrams,
          country,
          co2SavedKg: Number((cached * weightInGrams).toFixed(4)),
        };
      }
    } catch (err: any) {
      this.logger.warn(`co2 cache read failed: ${err?.message}`);
    }

    try {
      const content = await this.callOpenAIWithRetry([
        {
          role: 'system',
          content:
            'You estimate CO2e emissions avoided (kg) by preventing food waste. Respond with STRICT JSON only — no prose.',
        },
        {
          role: 'user',
          content: `Estimate CO2e avoided for:\n- ingredient: ${safeName}\n- weight: ${weightInGrams} grams\n- country: ${country}\n\nReturn JSON exactly:\n{"ingredient":"","weightInGrams":0,"country":"","co2SavedKg":0}\nco2SavedKg must be CO2e saved, not produced.`,
        },
      ]);
      const parsed = JSON.parse(content);
      const co2 = Math.max(0, Number(parsed?.co2SavedKg) || 0);
      if (co2 > 0) {
        const perGram = co2 / weightInGrams;
        void this.redisService.set(cacheKey, perGram, this.PRICE_CACHE_TTL_SEC);
      }
      return {
        ingredient: safeName,
        weightInGrams,
        country,
        co2SavedKg: co2 > 0 ? Number(co2.toFixed(3)) : fallbackCo2SavedKg(weightInGrams),
      };
    } catch (err: any) {
      this.logger.error(`co2 AI fallback for "${safeName}": ${err?.message}`);
      return {
        ingredient: safeName,
        weightInGrams,
        country,
        co2SavedKg: fallbackCo2SavedKg(weightInGrams),
      };
    }
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
    const totalMoneySaved = Number(profile.totalMoneySaved || 0);
    const totalCo2SavedKg = Number((profile.totalCo2SavedInGrams || 0) / 1000);
    
    return {
      food_savings_user: foodSavedInKg.toFixed(2),
      completed_meals_count: profile.numberOfMealsCooked || 0,
      best_food_savings: null, // TODO: Track best savings
      total_co2_savings: totalCo2SavedKg.toFixed(2),
      // Return the accumulated money saved for the user.
      // Amount is computed based on the user's country during saveFood.
      total_cost_savings: totalMoneySaved.toFixed(2),
      best_co2_savings: null,
      best_cost_savings: null,
    };
  }

  async getTrendingRecipes(limit: number = 5, country?: string) {
    country = normalizeCountry(country);
    const cacheKey = `analytics:trending:v2:${limit}:${country ?? 'any'}`;
    try {
      const cached = await this.redisService.get<any>(cacheKey);
      if (cached && Array.isArray(cached?.trending)) return cached;
    } catch (err: any) {
      this.logger.warn(`trending cache read failed: ${err?.message}`);
    }

    // Define current month range
    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 1);

    const objectIdMatch = { $regex: /^[0-9a-fA-F]{24}$/ };

    // Aggregate feedbacks for current month with valid framework_id
    let results = await this.feedbackModel.aggregate([
      {
        $match: {
          createdAt: { $gte: startOfMonth, $lt: endOfMonth },
          framework_id: objectIdMatch,
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
            framework_id: objectIdMatch,
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

    // Safely convert string IDs to ObjectIds, skipping any invalid ones
    const objectIds = ids
      .filter(id => Types.ObjectId.isValid(id))
      .map(id => new Types.ObjectId(id));
    if (!objectIds.length) return { trending: [] };

    // Build recipe filter: match IDs + optional country restriction.
    // If country filtering yields no results, fall back to unfiltered.
    const recipeFilter: any = { _id: { $in: objectIds } };
    if (country) {
      recipeFilter.countries = country;
    }

    let recipes = await this.recipeModel
      .find(recipeFilter)
      .select('title heroImageUrl shortDescription')
      .lean();

    // Fallback: if country filter removed all results, fetch without country restriction
    if (!recipes.length && country) {
      recipes = await this.recipeModel
        .find({ _id: { $in: objectIds } })
        .select('title heroImageUrl shortDescription')
        .lean();
    }

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

    const payload = { trending };
    try {
      await this.redisService.set(cacheKey, payload, this.TRENDING_CACHE_TTL_SEC);
    } catch (err: any) {
      this.logger.warn(`trending cache write failed: ${err?.message}`);
    }
    return payload;
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

 
  async getLeaderboard(options: {
    period?: 'ALL_TIME' | 'YEARLY' | 'MONTHLY' | 'WEEKLY';
    metric?: 'MEALS_COOKED' | 'FOOD_SAVED' | 'MONEY_SAVED' | 'BADGES' | 'CO2_SAVED' | 'BOTH';
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

    const normalizedCountry = normalizeCountry(country);
    const cacheKey =
      `analytics:leaderboard:v2:${period}:${metric}:${limit}:${offset}` +
      `:${normalizedCountry ?? 'any'}:${stateCode ?? 'any'}`;
    try {
      const cached = await this.redisService.get<any>(cacheKey);
      if (cached) return cached;
    } catch (err: any) {
      this.logger.warn(`leaderboard cache read failed: ${err?.message}`);
    }

    let dateFilter: any = {};
    void dateFilter;
    const now = new Date();


    let windowFrom: Date | null = null;
    if (period === 'WEEKLY') {
      windowFrom = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    } else if (period === 'MONTHLY') {
      windowFrom = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    } else if (period === 'YEARLY') {
      windowFrom = new Date(Date.UTC(now.getUTCFullYear(), 0, 1));
    }

    if (windowFrom) {
      const periodPipeline: any[] = [
        { $match: { createdAt: { $gte: windowFrom } } },
        {
          $group: {
            _id: '$userId',
            foodSavedInGrams: { $sum: '$foodSavedInGrams' },
            totalMoneySaved: { $sum: '$moneySaved' },
            totalCo2SavedInGrams: { $sum: '$co2SavedInGrams' },
            numberOfMealsCooked: { $sum: 1 },
          },
        },
        {
          $lookup: {
            from: 'leaderboardprofiles',
            localField: '_id',
            foreignField: 'userId',
            as: 'lbProfile',
          },
        },
        {
          $match: {
            'lbProfile.0': { $exists: true },
            'lbProfile.isActive': true,
          },
        },
        { $unwind: '$lbProfile' },
        {
          $lookup: {
            from: 'users',
            localField: '_id',
            foreignField: '_id',
            as: 'user',
          },
        },
        { $unwind: '$user' },
        { $addFields: { userId: '$_id' } },
      ];

      const periodMatch: any = {};
      if (normalizedCountry) periodMatch['user.country'] = normalizedCountry;
      if (stateCode) periodMatch['user.stateCode'] = stateCode;
      if (Object.keys(periodMatch).length > 0) {
        periodPipeline.push({ $match: periodMatch });
      }

      if (metric === 'BADGES') {
        periodPipeline.push(
          {
            $lookup: {
              from: 'userbadges',
              localField: '_id',
              foreignField: 'userId',
              as: 'badges',
            },
          },
          { $addFields: { badgeCount: { $size: '$badges' } } },
        );
      }

      let periodSort: any;
      if (metric === 'MEALS_COOKED') periodSort = { numberOfMealsCooked: -1 };
      else if (metric === 'FOOD_SAVED') periodSort = { foodSavedInGrams: -1 };
      else if (metric === 'MONEY_SAVED') periodSort = { totalMoneySaved: -1 };
      else if (metric === 'CO2_SAVED') periodSort = { totalCo2SavedInGrams: -1 };
      else if (metric === 'BADGES') periodSort = { badgeCount: -1 };
      else {
        periodPipeline.push({
          $addFields: {
            combinedScore: {
              $add: [
                '$numberOfMealsCooked',
                { $divide: ['$foodSavedInGrams', 1000] },
              ],
            },
          },
        });
        periodSort = { combinedScore: -1 };
      }

      // Facet pattern avoids a second round-trip for the count.
      periodPipeline.push({
        $facet: {
          rows: [
            { $sort: periodSort },
            { $skip: offset },
            { $limit: limit },
            ...(metric !== 'BADGES'
              ? [
                  {
                    $lookup: {
                      from: 'userbadges',
                      localField: '_id',
                      foreignField: 'userId',
                      as: 'badges',
                    },
                  },
                ]
              : []),
            {
              $project: {
                userId: '$user._id',
                userName: '$lbProfile.displayName',
                country: '$user.country',
                stateCode: '$user.stateCode',
                numberOfMealsCooked: 1,
                foodSavedInGrams: 1,
                foodSavedInKg: { $divide: ['$foodSavedInGrams', 1000] },
                totalMoneySaved: 1,
                totalCo2SavedInGrams: { $ifNull: ['$totalCo2SavedInGrams', 0] },
                totalCo2SavedKg: {
                  $divide: [{ $ifNull: ['$totalCo2SavedInGrams', 0] }, 1000],
                },
                badgeCount: { $size: { $ifNull: ['$badges', []] } },
                combinedScore: 1,
              },
            },
          ],
          total: [{ $count: 'total' }],
        },
      });

      const [facet] = await this.foodSavedEventLogModel.aggregate(periodPipeline);
      const rowsRaw = facet?.rows ?? [];
      const totalEntries = facet?.total?.[0]?.total ?? 0;
      const leaderboard = rowsRaw.map((entry: any, index: number) => ({
        ...entry,
        rank: offset + index + 1,
        foodSavedInKg: Number((entry.foodSavedInKg || 0).toFixed(2)),
        totalMoneySaved: Number((entry.totalMoneySaved || 0).toFixed(2)),
        totalCo2SavedInGrams: entry.totalCo2SavedInGrams || 0,
        totalCo2SavedKg: Number((entry.totalCo2SavedKg || 0).toFixed(2)),
      }));

      const payload = {
        period,
        metric,
        limit,
        offset,
        filters: {
          country: normalizedCountry || 'all',
          stateCode: stateCode || 'all',
        },
        totalEntries,
        leaderboard,
      };
      try {
        await this.redisService.set(cacheKey, payload, this.LEADERBOARD_CACHE_TTL_SEC);
      } catch (err: any) {
        this.logger.warn(`leaderboard cache write failed: ${err?.message}`);
      }
      return payload;
    }

    // ──────────────────── all-time path ────────────────────
    // Read cumulative totals straight off UserFoodAnalyticsProfile.

    const pipeline: any[] = [
      {
        $lookup: {
          from: 'leaderboardprofiles',
          localField: 'userId',
          foreignField: 'userId',
          as: 'lbProfile',
        },
      },
      {
        $match: {
          'lbProfile.0': { $exists: true },
          'lbProfile.isActive': true,
        },
      },
      { $unwind: '$lbProfile' },
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

    const matchConditions: any = {};
    if (normalizedCountry) {
      matchConditions['user.country'] = normalizedCountry;
    }
    if (stateCode) {
      matchConditions['user.stateCode'] = stateCode;
    }
    if (Object.keys(matchConditions).length > 0) {
      pipeline.push({ $match: matchConditions });
    }

    let sortField: any = {};
    if (metric === 'MEALS_COOKED') {
      sortField = { numberOfMealsCooked: -1 };
    } else if (metric === 'FOOD_SAVED') {
      sortField = { foodSavedInGrams: -1 };
    } else if (metric === 'MONEY_SAVED') {
      sortField = { totalMoneySaved: -1 };
    } else if (metric === 'BADGES') {
      sortField = { badgeCount: -1 };
    } else if (metric === 'CO2_SAVED') {
      sortField = { totalCo2SavedInGrams: -1 };
    } else {
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

    if (metric === 'BADGES') {
      pipeline.push({
        $lookup: {
          from: 'userbadges',
          localField: 'userId',
          foreignField: 'userId',
          as: 'badges',
        },
      });
      pipeline.push({
        $addFields: {
          badgeCount: { $size: '$badges' },
        },
      });
    }

    pipeline.push({ $sort: sortField });
    pipeline.push({ $skip: offset });
    pipeline.push({ $limit: limit });

    if (metric !== 'BADGES') {
      pipeline.push({
        $lookup: {
          from: 'userbadges',
          localField: 'userId',
          foreignField: 'userId',
          as: 'badges',
        },
      });
    }

    pipeline.push({
      $project: {
        rank: 1,
        userId: '$user._id',
        userName: '$lbProfile.displayName',
        country: '$user.country',
        stateCode: '$user.stateCode',
          numberOfMealsCooked: 1,
          foodSavedInGrams: 1,
          foodSavedInKg: { $divide: ['$foodSavedInGrams', 1000] },
          totalMoneySaved: 1,
          totalCo2SavedInGrams: { $ifNull: ['$totalCo2SavedInGrams', 0] },
          totalCo2SavedKg: { $divide: [{ $ifNull: ['$totalCo2SavedInGrams', 0] }, 1000] },
          badgeCount: { $size: '$badges' },
          combinedScore: 1,
          updatedAt: 1,
        },
      },
    );

    const results = await this.userFoodAnallyticsProfileModel.aggregate(pipeline);

    const countPipeline = pipeline.slice(0, -3);
    const totalCount = await this.userFoodAnallyticsProfileModel.aggregate([
      ...countPipeline,
      { $count: 'total' }
    ]);
    const totalEntries = totalCount.length > 0 ? totalCount[0].total : 0;

    const leaderboard = results.map((entry, index) => ({
      ...entry,
      rank: offset + index + 1,
      foodSavedInKg: Number(entry.foodSavedInKg.toFixed(2)),
      totalMoneySaved: Number((entry.totalMoneySaved || 0).toFixed(2)),
      totalCo2SavedInGrams: entry.totalCo2SavedInGrams || 0,
      totalCo2SavedKg: Number((entry.totalCo2SavedKg || 0).toFixed(2)),
    }));

    const payload = {
      period,
      metric,
      limit,
      offset,
      filters: {
        country: normalizedCountry || 'all',
        stateCode: stateCode || 'all',
      },
      totalEntries,
      leaderboard,
    };
    try {
      await this.redisService.set(cacheKey, payload, this.LEADERBOARD_CACHE_TTL_SEC);
    } catch (err: any) {
      this.logger.warn(`leaderboard cache write failed: ${err?.message}`);
    }
    return payload;
  }

 
  async getUserRank(userId: string, options: {
    period?: 'ALL_TIME' | 'YEARLY' | 'MONTHLY' | 'WEEKLY';
    metric?: 'MEALS_COOKED' | 'FOOD_SAVED' | 'MONEY_SAVED' | 'CO2_SAVED' | 'BADGES' | 'BOTH';
  }) {
    const { period = 'ALL_TIME', metric = 'BOTH' } = options;

    const leaderboardData = await this.getLeaderboard({
      period,
      metric,
      limit: 1000, 
    });

   
    const userEntry = leaderboardData.leaderboard.find(
      (entry) => entry.userId.toString() === userId,
    );

    if (!userEntry) {
      return {
        found: false,
        message: 'User not found in leaderboard',
      };
    }

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

  async getRecipeRatingStatsBatch(
    frameworkIds: string[],
  ): Promise<Record<string, { totalRatings: number; averageRating: number; ratingDistribution: { rating: number; count: number; percentage: number }[] }>> {
    const result: Record<string, { totalRatings: number; averageRating: number; ratingDistribution: { rating: number; count: number; percentage: number }[] }> = {};

    if (!frameworkIds || frameworkIds.length === 0) return result;

    const empty = () => ({
      totalRatings: 0,
      averageRating: 0,
      ratingDistribution: [5, 4, 3, 2, 1].map(r => ({ rating: r, count: 0, percentage: 0 })),
    });

    // Single aggregation query across all requested recipe IDs
    const rows = await this.feedbackModel
      .aggregate([
        {
          $match: {
            framework_id: { $in: frameworkIds },
            'data.rating': { $exists: true, $ne: null },
          },
        },
        {
          $group: {
            _id: '$framework_id',
            ratings: { $push: '$data.rating' },
          },
        },
      ])
      .exec();

    for (const row of rows) {
      const ratings: number[] = (row.ratings as any[]).map(Number).filter(v => v >= 1 && v <= 5);
      const totalRatings = ratings.length;
      if (totalRatings === 0) {
        result[row._id] = empty();
        continue;
      }
      const distribution: Record<number, number> = {};
      let sum = 0;
      for (const v of ratings) {
        distribution[v] = (distribution[v] || 0) + 1;
        sum += v;
      }
      result[row._id] = {
        totalRatings,
        averageRating: Math.round((sum / totalRatings) * 10) / 10,
        ratingDistribution: [5, 4, 3, 2, 1].map(r => ({
          rating: r,
          count: distribution[r] || 0,
          percentage: Math.round(((distribution[r] || 0) / totalRatings) * 100),
        })),
      };
    }

    for (const id of frameworkIds) {
      if (!result[id]) result[id] = empty();
    }

    return result;
  }

  async getRecipeRatingStats(frameworkId: string): Promise<{
    totalRatings: number;
    averageRating: number;
    ratingDistribution: { rating: number; count: number; percentage: number }[];
  }> {
    if (!frameworkId) {
      return {
        totalRatings: 0,
        averageRating: 0,
        ratingDistribution: [
          { rating: 5, count: 0, percentage: 0 },
          { rating: 4, count: 0, percentage: 0 },
          { rating: 3, count: 0, percentage: 0 },
          { rating: 2, count: 0, percentage: 0 },
          { rating: 1, count: 0, percentage: 0 },
        ],
      };
    }

    const ratings = await this.feedbackModel
      .find({
        framework_id: frameworkId,
        'data.rating': { $exists: true, $ne: null },
      })
      .select('data.rating')
      .lean();

    const totalRatings = ratings.length;
    if (totalRatings === 0) {
      return {
        totalRatings: 0,
        averageRating: 0,
        ratingDistribution: [
          { rating: 5, count: 0, percentage: 0 },
          { rating: 4, count: 0, percentage: 0 },
          { rating: 3, count: 0, percentage: 0 },
          { rating: 2, count: 0, percentage: 0 },
          { rating: 1, count: 0, percentage: 0 },
        ],
      };
    }

    const distribution: Record<number, number> = ratings.reduce(
      (acc: Record<number, number>, r: any) => {
        const v = Number(r?.data?.rating) || 0;
        if (v >= 1 && v <= 5) acc[v] = (acc[v] || 0) + 1;
        return acc;
      },
      {},
    );

    const ratingDistribution = [5, 4, 3, 2, 1].map(r => ({
      rating: r,
      count: distribution[r] || 0,
      percentage: Math.round(((distribution[r] || 0) / totalRatings) * 100),
    }));

    const sumRatings = ratings.reduce(
      (sum: number, r: any) => sum + (Number(r?.data?.rating) || 0),
      0,
    );
    const averageRating = Math.round((sumRatings / totalRatings) * 10) / 10;

    return {
      totalRatings,
      averageRating,
      ratingDistribution,
    };
  }


  async getLeaderboardProfile(userId: string) {
    const profile = await this.leaderboardProfileModel
      .findOne({ userId: new Types.ObjectId(userId) })
      .lean();
    return { joined: !!profile, profile: profile || null };
  }

  async joinLeaderboard(userId: string, displayName: string) {
    const existing = await this.leaderboardProfileModel
      .findOne({ userId: new Types.ObjectId(userId) })
      .lean();
    if (existing) {
      // Re-activate if previously left
      if (!existing.isActive) {
        await this.leaderboardProfileModel.updateOne(
          { userId: new Types.ObjectId(userId) },
          { $set: { isActive: true, displayName } },
        );
      }
      const updated = await this.leaderboardProfileModel
        .findOne({ userId: new Types.ObjectId(userId) })
        .lean();
      return { joined: true, profile: updated };
    }
    const profile = await this.leaderboardProfileModel.create({
      userId: new Types.ObjectId(userId),
      displayName,
      isActive: true,
    });
    return { joined: true, profile };
  }

  async updateLeaderboardProfile(userId: string, updates: { displayName?: string; isActive?: boolean }) {
    const profile = await this.leaderboardProfileModel.findOneAndUpdate(
      { userId: new Types.ObjectId(userId) },
      { $set: updates },
      { new: true },
    ).lean();
    if (!profile) {
      return { joined: false, message: 'Not on leaderboard yet' };
    }
    return { joined: true, profile };
  }

  async leaveLeaderboard(userId: string) {
    await this.leaderboardProfileModel.updateOne(
      { userId: new Types.ObjectId(userId) },
      { $set: { isActive: false } },
    );
    return { joined: false, message: 'Left leaderboard successfully' };
  }
}
