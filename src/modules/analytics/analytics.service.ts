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
import { UserBadge, UserBadgeDocument } from 'src/database/schemas/user-badge.schema';
import { RedisService } from 'src/redis/redis.service';
import { normalizeCountry } from '../../utils/countries.util';
import { fallbackPriceInLocalCurrency, fallbackCo2SavedKg } from './utils/fallback-pricing.util';
import {
  CO2_KG_PER_KG_FOOD_SAVED,
  moneySavedFromFoodGrams,
  co2SavedInGramsFromFood,
  resolveCostPerGram,
} from './utils/impact-pricing.util';
import { normalizeObjectIdArray } from 'src/modules/analytics/utils/object-id-array.util';
import { SurveyConfigService } from '../survey-config/survey-config.service';

type LeaderboardPeriodOption = 'ALL_TIME' | 'YEARLY' | 'MONTHLY' | 'WEEKLY' | 'DAILY';
type LeaderboardMetricOption = 'MEALS_COOKED' | 'FOOD_SAVED' | 'MONEY_SAVED' | 'BADGES' | 'CO2_SAVED' | 'BOTH';

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

type RawCookedRecipesProfile = {
  _id?: Types.ObjectId;
  cookedRecipes?: unknown[];
  numberOfMealsCooked?: number;
} | null;

export interface Co2CalculationResult {
  ingredient: string;
  weightInGrams: number;
  country: string;
  co2SavedKg: number;
}

export interface QuantityResolutionResult {
  ingredient: string;
  quantity: string;
  country: string;
  weightInGrams: number;
  priceInLocalCurrency: number;
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
    @InjectModel(UserBadge.name)
    private readonly userBadgeModel: Model<UserBadgeDocument>,
    private readonly redisService: RedisService,
    private readonly eventEmmiter: EventEmitter2,
    private readonly surveyConfigService: SurveyConfigService,
  ) {}

  private getLeaderboardWindowStart(period: LeaderboardPeriodOption): Date | null {
    const now = new Date();

    switch (period) {
      case 'DAILY':
        return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
      case 'WEEKLY':
        return new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
      case 'MONTHLY':
        return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
      case 'YEARLY':
        return new Date(Date.UTC(now.getUTCFullYear(), 0, 1));
      default:
        return null;
    }
  }

  private async getBadgeLeaderboard(options: {
    period: LeaderboardPeriodOption;
    limit: number;
    offset: number;
    normalizedCountry?: string;
    stateCode?: string;
    cacheKey: string;
  }) {
    const {
      period,
      limit,
      offset,
      normalizedCountry,
      stateCode,
      cacheKey,
    } = options;

    const windowFrom = this.getLeaderboardWindowStart(period);
    const pipeline: any[] = [];

    if (windowFrom) {
      pipeline.push({
        $match: {
          earnedAt: { $gte: windowFrom },
        },
      });
    }

    pipeline.push(
      {
        $group: {
          _id: '$userId',
          badgeCount: { $sum: 1 },
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
    );

    const matchConditions: Record<string, string> = {};
    if (normalizedCountry) {
      matchConditions['user.country'] = normalizedCountry;
    }
    if (stateCode) {
      matchConditions['user.stateCode'] = stateCode;
    }
    if (Object.keys(matchConditions).length > 0) {
      pipeline.push({ $match: matchConditions });
    }

    pipeline.push({
      $facet: {
        rows: [
          { $sort: { badgeCount: -1, _id: 1 } },
          { $skip: offset },
          { $limit: limit },
          {
            $project: {
              userId: '$user._id',
              userName: '$lbProfile.displayName',
              country: '$user.country',
              stateCode: '$user.stateCode',
              numberOfMealsCooked: { $literal: 0 },
              foodSavedInGrams: { $literal: 0 },
              foodSavedInKg: { $literal: 0 },
              totalMoneySaved: { $literal: 0 },
              totalCo2SavedInGrams: { $literal: 0 },
              totalCo2SavedKg: { $literal: 0 },
              badgeCount: 1,
              combinedScore: { $literal: 0 },
            },
          },
        ],
        total: [{ $count: 'total' }],
      },
    });

    const [facet] = await this.userBadgeModel.aggregate(pipeline);
    const rowsRaw = facet?.rows ?? [];
    const totalEntries = facet?.total?.[0]?.total ?? 0;
    const leaderboard = rowsRaw.map((entry: any, index: number) => ({
      ...entry,
      rank: offset + index + 1,
      totalMoneySaved: Number((entry.totalMoneySaved || 0).toFixed(2)),
      totalCo2SavedInGrams: entry.totalCo2SavedInGrams || 0,
      totalCo2SavedKg: Number((entry.totalCo2SavedKg || 0).toFixed(2)),
    }));

    const payload = {
      period,
      metric: 'BADGES' as const,
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

/**
 * Persist cook impact for a household.
 *
 * Platform formulas (AI is NOT used for money or CO₂ totals):
 * - foodSavedInGrams = Σ ingredient weights (g)
 * - moneySaved = foodSavedInGrams × survey costPerGram (else fallback $/kg × kg)
 * - co2SavedInGrams = foodSavedInGrams × 2.1
 *
 * AI may still resolve free-form quantity → grams when needed.
 */
async saveFood(
  userId: string,
  ingredinatIds: string[] = [],
  frameworkId?: string,
  directIngredients?: { name: string; averageWeight?: number; quantity?: string }[],
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

  // Resolve ingredients to { name, grams }.
  //
  // Three possible sources, in priority order:
  //   1. `ingredinatIds` → DB lookup, uses stored averageWeight.
  //   2. `directIngredients[i].quantity` → AI quantity→grams resolver.
  //   3. `directIngredients[i].averageWeight` → already-known weight.
  let ingredinats: Array<{ name: string; averageWeight: number }> = [];

  if (ingredinatIds && ingredinatIds.length > 0) {
    const dbIngredients = await this.ingredinatModel
      .find({ _id: { $in: ingredinatIds } })
      .lean();
    ingredinats = dbIngredients.map(i => ({
      name: i.name,
      averageWeight: i.averageWeight || 0,
    }));
  } else if (directIngredients && directIngredients.length > 0) {
    const resolutions = await Promise.all(
      directIngredients.map(i =>
        i.quantity && i.quantity.trim().length > 0
          ? this.resolveIngredientByQuantity(i.name, i.quantity, country)
          : Promise.resolve(null),
      ),
    );

    for (let idx = 0; idx < directIngredients.length; idx++) {
      const i = directIngredients[idx];
      const r = resolutions[idx];
      if (r) {
        ingredinats.push({ name: i.name, averageWeight: r.weightInGrams });
      } else {
        ingredinats.push({ name: i.name, averageWeight: i.averageWeight || 0 });
      }
    }
  }

  const foodSavedInGrams = ingredinats.reduce((sum, i) => sum + (i.averageWeight || 0), 0);
  const ingredientNames = ingredinats.map(i => i.name).join(', ') || 'none';

  let countryRates: Array<{ countryCode: string; countryName?: string; costPerGram: number; isActive?: boolean }> | null =
    null;
  try {
    const surveyConfig = await this.surveyConfigService.getActiveConfig();
    countryRates = surveyConfig?.countryRates ?? null;
  } catch (err: any) {
    this.logger.warn(`survey config unavailable for money calc: ${err?.message}`);
  }

  const costPerGram = resolveCostPerGram(country, countryRates);
  const totalPriceInLocalCurrency = moneySavedFromFoodGrams(
    foodSavedInGrams,
    country,
    countryRates,
  );
  const totalCo2SavedInGrams = co2SavedInGramsFromFood(foodSavedInGrams);

  const priceResults: PriceCalculationResult[] = ingredinats.map((i) => {
    const weightInGrams = Math.max(0, i.averageWeight || 0);
    const priceInLocalCurrency =
      costPerGram != null && costPerGram > 0
        ? Math.round(weightInGrams * costPerGram * 100) / 100
        : fallbackPriceInLocalCurrency(weightInGrams, country);
    return {
      ingredient: i.name,
      weightInGrams,
      country,
      priceInLocalCurrency,
    };
  });

  const co2Results: Co2CalculationResult[] = ingredinats.map((i) => {
    const weightInGrams = Math.max(0, i.averageWeight || 0);
    return {
      ingredient: i.name,
      weightInGrams,
      country,
      co2SavedKg: Number(
        ((weightInGrams / 1000) * CO2_KG_PER_KG_FOOD_SAVED).toFixed(4),
      ),
    };
  });

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
    breakdown: priceResults,
    co2Breakdown: co2Results,
    totalCo2SavedInKg: Number((totalCo2SavedInGrams / 1000).toFixed(3)),
  };
}

/**
 * Single-shot AI resolver: given an ingredient NAME and a free-form
 * QUANTITY string (e.g. "6 large", "2 tablespoons", "1 teaspoon",
 * "to taste"), return estimated weight + local price + CO2e avoided.
 *
 * Cached in Redis for 7 days by (country, name|quantity). This means
 * "onion | 1 large" in India is resolved ONCE and reused across every
 * user that cooks any recipe containing that exact line — the hot
 * ingredients (tomato, onion, oil, salt) cost zero tokens after the
 * very first user.
 *
 * On AI failure returns null so the caller can decide on a fallback.
 */
async resolveIngredientByQuantity(
  ingredientName: string,
  quantity: string,
  country: string,
): Promise<QuantityResolutionResult | null> {
  const safeName = (ingredientName || '').trim();
  const safeQty = (quantity || '').trim();
  if (!safeName || !safeQty) return null;

  // "to taste", "for garnish", "as needed" → negligible weight, skip AI.
  const negligible = /^(to taste|for garnish|as needed|optional|pinch)$/i;
  if (negligible.test(safeQty)) {
    return {
      ingredient: safeName,
      quantity: safeQty,
      country,
      weightInGrams: 0,
      priceInLocalCurrency: 0,
      co2SavedKg: 0,
    };
  }

  const cacheKey = `analytics:qty:v1:${country}:${safeName.toLowerCase().slice(0, 60)}|${safeQty.toLowerCase().slice(0, 40)}`;
  try {
    const cached = await this.redisService.get<{
      w: number;
      p: number;
      c: number;
    }>(cacheKey);
    if (cached && typeof cached.w === 'number') {
      return {
        ingredient: safeName,
        quantity: safeQty,
        country,
        weightInGrams: cached.w,
        priceInLocalCurrency: cached.p,
        co2SavedKg: cached.c,
      };
    }
  } catch (err: any) {
    this.logger.warn(`qty cache read failed: ${err?.message}`);
  }

  try {
    const content = await this.callOpenAIWithRetry([
      {
        role: 'system',
        content:
          'You estimate ingredient weight (grams), local-currency price, and CO2e emissions avoided from preventing that ingredient from being wasted. Respond with STRICT JSON only — no prose.',
      },
      {
        role: 'user',
        content:
          `Resolve the following line from a recipe:\n` +
          `- ingredient: ${safeName}\n` +
          `- quantity: ${safeQty}\n` +
          `- country: ${country}\n\n` +
          `Return JSON exactly:\n` +
          `{"weightInGrams":0,"priceInLocalCurrency":0,"co2SavedKg":0}\n` +
          `- weightInGrams: realistic edible weight in grams for the given quantity.\n` +
          `- priceInLocalCurrency: typical retail price for that weight in ${country}.\n` +
          `- co2SavedKg: CO2e in kg that would be avoided by NOT wasting that weight of ${safeName}.`,
      },
    ]);
    const parsed = JSON.parse(content);
    const w = Math.max(0, Number(parsed?.weightInGrams) || 0);
    const p = Math.max(0, Number(parsed?.priceInLocalCurrency) || 0);
    const c = Math.max(0, Number(parsed?.co2SavedKg) || 0);

    // Only cache when weight is meaningful — avoids poisoning the cache
    // with zero-weight results from a bad AI response.
    if (w > 0) {
      void this.redisService.set(
        cacheKey,
        { w, p, c },
        this.PRICE_CACHE_TTL_SEC,
      );
    }

    return {
      ingredient: safeName,
      quantity: safeQty,
      country,
      weightInGrams: Number(w.toFixed(1)),
      priceInLocalCurrency: Number(p.toFixed(2)),
      co2SavedKg: Number(c.toFixed(4)),
    };
  } catch (err: any) {
    this.logger.error(`qty AI failed for "${safeName} ${safeQty}": ${err?.message}`);
    return null;
  }
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
  

  private async getNormalizedCookedRecipesProfile(userId: string) {
    const profile = (await this.userFoodAnallyticsProfileModel.collection.findOne(
      { userId: new Types.ObjectId(userId) },
      { projection: { cookedRecipes: 1, numberOfMealsCooked: 1 } },
    )) as RawCookedRecipesProfile;

    const normalizedCookedRecipes = normalizeObjectIdArray(
      profile?.cookedRecipes,
    );

    if (profile?._id && normalizedCookedRecipes.changed) {
      await this.userFoodAnallyticsProfileModel.updateOne(
        { _id: profile._id },
        { $set: { cookedRecipes: normalizedCookedRecipes.objectIds } },
      );
    }

    return {
      cookedRecipeIds: normalizedCookedRecipes.stringIds,
      cookedRecipeObjectIds: normalizedCookedRecipes.objectIds,
      numberOfMealsCooked: profile?.numberOfMealsCooked || 0,
    };
  }


  async getUserCookedRecipes(userId: string) {
    const { cookedRecipeIds, numberOfMealsCooked } =
      await this.getNormalizedCookedRecipesProfile(userId);
    
    return { 
      cookedRecipes: cookedRecipeIds,
      numberOfMealsCooked,
    };
  }

  async getUserCookedRecipesDetails(userId: string) {
    const { cookedRecipeIds, cookedRecipeObjectIds } =
      await this.getNormalizedCookedRecipesProfile(userId);

    if (!cookedRecipeIds.length) {
      return { cookedRecipes: [] };
    }

    const recipes = await this.recipeModel
      .find({ _id: { $in: cookedRecipeObjectIds } })
      .select('title heroImageUrl shortDescription')
      .lean();

    const items = (recipes as any[]).map(r => ({
      id: r._id.toString(),
      title: r.title,
      shortDescription: r.shortDescription,
      heroImageUrl: r.heroImageUrl,
    }));

    // Preserve the recent ordering (last 3)
  const idOrder = cookedRecipeIds.slice(-3);
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
    period?: LeaderboardPeriodOption;
    metric?: LeaderboardMetricOption;
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

    if (metric === 'BADGES') {
      return this.getBadgeLeaderboard({
        period,
        limit,
        offset,
        normalizedCountry: normalizedCountry ?? undefined,
        stateCode,
        cacheKey,
      });
    }

    const windowFrom = this.getLeaderboardWindowStart(period);

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

      let periodSort: any;
      if (metric === 'MEALS_COOKED') periodSort = { numberOfMealsCooked: -1 };
      else if (metric === 'FOOD_SAVED') periodSort = { foodSavedInGrams: -1 };
      else if (metric === 'MONEY_SAVED') periodSort = { totalMoneySaved: -1 };
      else if (metric === 'CO2_SAVED') periodSort = { totalCo2SavedInGrams: -1 };
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
            {
              $lookup: {
                from: 'userbadges',
                localField: '_id',
                foreignField: 'userId',
                as: 'badges',
              },
            },
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

    pipeline.push({ $sort: sortField });
    pipeline.push({ $skip: offset });
    pipeline.push({ $limit: limit });

    pipeline.push({
      $lookup: {
        from: 'userbadges',
        localField: 'userId',
        foreignField: 'userId',
        as: 'badges',
      },
    });

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
    period?: LeaderboardPeriodOption;
    metric?: LeaderboardMetricOption;
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
