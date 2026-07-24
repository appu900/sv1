import { BadRequestException, Injectable, Logger, Optional } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Model, Types } from 'mongoose';
import {
  FoodSavedEventLog,
  FoodSavedEventLogDocument,
} from '../../database/schemas/food-saved-event-log.schema';
import {
  IngredientSearchEvent,
  IngredientSearchEventDocument,
} from '../../database/schemas/ingredient-search-event.schema';
import {
  ClientAnalyticsEvent,
  ClientAnalyticsEventDocument,
} from '../../database/schemas/client-analytics-event.schema';
import {
  Recipe,
  RecipeDocument,
} from '../../database/schemas/recipe.schema';
import {
  Ingredient,
  IngredientDocument,
} from '../../database/schemas/ingredient.schema';
import { MetricsWindow } from './dto/metrics.dto';
import { windowStart, GLOBAL_SCOPE_MAX_WINDOW_MS } from './utils/time-window.util';
import { ChefLookupService } from '../chef/chef-lookup.service';
import { currencyFromCountry } from '../chef/chef.constants';

function toObjectId(value: string | Types.ObjectId | null | undefined): Types.ObjectId | null {
  if (!value) return null;
  if (value instanceof Types.ObjectId) return value;
  try {
    return new Types.ObjectId(String(value));
  } catch {
    return null;
  }
}


function globalScopeFloor(): Date {
  return new Date(Date.now() - GLOBAL_SCOPE_MAX_WINDOW_MS);
}

export interface UserMetricsRow {
  window: MetricsWindow;
  from: string | null;
  to: string;
  mealsCooked: number;
  foodSavedInGrams: number;
  foodSavedInKg: number;
  moneySaved: number;
  country: string | null;
  co2SavedInGrams: number;
  co2SavedInKg: number;
}

export interface MostCookedRecipe {
  frameworkId: string;
  count: number;
  title?: string;
  heroImageUrl?: string;
}

export interface MostSearchedIngredient {
  ingredientId: string | null;
  query: string | null;
  count: number;
  title?: string;
  icon?: string;
}

export interface ImpactMetrics {
  week: UserMetricsRow;
  month: UserMetricsRow;
  year: UserMetricsRow;
  all: UserMetricsRow;
}

@Injectable()
export class MetricsService {
  private readonly logger = new Logger(MetricsService.name);

  constructor(
    @InjectModel(FoodSavedEventLog.name)
    private readonly foodSavedModel: Model<FoodSavedEventLogDocument>,
    @InjectModel(IngredientSearchEvent.name)
    private readonly searchModel: Model<IngredientSearchEventDocument>,
    @InjectModel(ClientAnalyticsEvent.name)
    private readonly clientEventModel: Model<ClientAnalyticsEventDocument>,
    @InjectModel(Recipe.name)
    private readonly recipeModel: Model<RecipeDocument>,
    @InjectModel(Ingredient.name)
    private readonly ingredientModel: Model<IngredientDocument>,
    private readonly eventEmitter: EventEmitter2,
    @Optional() private readonly chefLookup?: ChefLookupService,
  ) {}


  async logFoodSaved(payload: {
    userId: string;
    frameworkId?: string | null;
    ingredientIds?: string[];
    foodSavedInGrams: number;
    moneySaved: number;
    co2SavedInGrams: number;
    country?: string | null;
    idempotencyKey?: string | null;
  }): Promise<void> {
    try {
      const userObjectId = toObjectId(payload.userId);
      if (!userObjectId) {
        this.logger.warn(`logFoodSaved skipped — invalid userId=${payload.userId}`);
        return;
      }

      const chefIds = this.chefLookup
        ? await this.chefLookup.getChefUserIdsForRecipe(payload.frameworkId)
        : [];

      const currency = currencyFromCountry(payload.country);

      const doc = await this.foodSavedModel.create({
        userId: userObjectId,
        frameworkId: toObjectId(payload.frameworkId),
        chefIds,
        ingredientIds: (payload.ingredientIds ?? [])
          .map((id) => toObjectId(id))
          .filter((id): id is Types.ObjectId => id !== null),
        foodSavedInGrams: Math.max(0, Math.floor(payload.foodSavedInGrams || 0)),
        moneySaved: Math.max(0, Number(payload.moneySaved) || 0),
        currency,
        co2SavedInGrams: Math.max(0, Math.floor(payload.co2SavedInGrams || 0)),
        country: payload.country ?? null,
        idempotencyKey: payload.idempotencyKey ?? null,
      });

      // Only emit after a successful insert so rollups are exactly-once.
      this.eventEmitter.emit('food.saved.persisted', {
        logId: String(doc._id),
        userId: String(doc.userId),
        frameworkId: doc.frameworkId ? String(doc.frameworkId) : null,
        chefIds: (doc.chefIds ?? []).map(String),
        foodSavedInGrams: doc.foodSavedInGrams,
        moneySaved: doc.moneySaved,
        currency: doc.currency,
        country: doc.country,
        co2SavedInGrams: doc.co2SavedInGrams,
        createdAt: doc.createdAt,
      });
    } catch (err: any) {
      // Duplicate-key on (userId, idempotencyKey) means the same retry
      // was already persisted — this is a success, not an error.
      if (err?.code === 11000) {
        this.logger.debug(
          `logFoodSaved duplicate suppressed for key=${payload.idempotencyKey}`,
        );
        return;
      }
      this.logger.error(`logFoodSaved failed: ${err?.message}`, err?.stack);
    }
  }


  async logIngredientSearch(params: {
    userId: string;
    ingredientId?: string | null;
    query?: string | null;
    source?: string | null;
  }): Promise<void> {
    const userObjectId = toObjectId(params.userId);
    if (!userObjectId) throw new BadRequestException('Invalid user');

    const ingredientObjectId = params.ingredientId ? toObjectId(params.ingredientId) : null;
    const normalizedQuery = params.query ? params.query.trim().toLowerCase().slice(0, 80) : null;

    if (!ingredientObjectId && !normalizedQuery) {
      throw new BadRequestException('Either ingredientId or query is required');
    }

    try {
      await this.searchModel.create({
        userId: userObjectId,
        ingredientId: ingredientObjectId,
        query: normalizedQuery,
        source: params.source ?? null,
      });
    } catch (err: any) {
      this.logger.error(`logIngredientSearch failed: ${err?.message}`);
      // Non-fatal for the caller — analytics should never break search UX.
    }
  }


  async getUserMetrics(userId: string, window: MetricsWindow, tz?: string | null): Promise<UserMetricsRow> {
    const userOid = toObjectId(userId);
    if (!userOid) throw new BadRequestException('Invalid user');

    const now = new Date();
    const from = windowStart(window, tz ?? null, now);
    const match: Record<string, any> = { userId: userOid };
    if (from) match.createdAt = { $gte: from };

    const agg = await this.foodSavedModel.aggregate([
      { $match: match },
      {
        $group: {
          _id: null,
          mealsCooked: { $sum: 1 },
          foodSavedInGrams: { $sum: '$foodSavedInGrams' },
          moneySaved: { $sum: '$moneySaved' },
          co2SavedInGrams: { $sum: '$co2SavedInGrams' },
          countries: { $addToSet: '$country' },
        },
      },
    ]);

    const row = agg[0];
    const countries = (row?.countries ?? []).filter((c: string | null) => !!c);
    const country = countries.length === 1 ? countries[0] : null;

    return {
      window,
      from: from ? from.toISOString() : null,
      to: now.toISOString(),
      mealsCooked: row?.mealsCooked ?? 0,
      foodSavedInGrams: row?.foodSavedInGrams ?? 0,
      foodSavedInKg: row ? Number(((row.foodSavedInGrams ?? 0) / 1000).toFixed(3)) : 0,
      moneySaved: row ? Number((row.moneySaved ?? 0).toFixed(2)) : 0,
      country,
      co2SavedInGrams: row?.co2SavedInGrams ?? 0,
      co2SavedInKg: row ? Number(((row.co2SavedInGrams ?? 0) / 1000).toFixed(3)) : 0,
    };
  }


  async getImpactMetrics(userId: string, tz?: string | null): Promise<ImpactMetrics> {
    const [week, month, year, all] = await Promise.all([
      this.getUserMetrics(userId, MetricsWindow.WEEK, tz),
      this.getUserMetrics(userId, MetricsWindow.MONTH, tz),
      this.getUserMetrics(userId, MetricsWindow.YEAR, tz),
      this.getUserMetrics(userId, MetricsWindow.ALL, tz),
    ]);
    return { week, month, year, all };
  }

  async getMostCookedRecipes(params: {
    userId: string;
    scope?: 'mine' | 'global';
    window?: MetricsWindow;
    tz?: string | null;
    limit?: number;
  }): Promise<MostCookedRecipe[]> {
    const limit = Math.min(Math.max(params.limit ?? 10, 1), 50);
    const window = params.window ?? MetricsWindow.ALL;
    const scope = params.scope ?? 'mine';

    const match: Record<string, any> = { frameworkId: { $ne: null } };
    if (scope === 'mine') {
      const userOid = toObjectId(params.userId);
      if (!userOid) throw new BadRequestException('Invalid user');
      match.userId = userOid;
    }
    const from = windowStart(window, params.tz ?? null);
    if (from) {
      match.createdAt = { $gte: from };
    } else if (scope === 'global') {

      match.createdAt = { $gte: globalScopeFloor() };
    }

    const rows = await this.foodSavedModel.aggregate([
      { $match: match },
      { $group: { _id: '$frameworkId', count: { $sum: 1 } } },
      { $sort: { count: -1 } },
      { $limit: limit },
    ]);

    if (rows.length === 0) return [];

    const frameworkIds = rows.map((r) => r._id).filter(Boolean);
    const recipes = await this.recipeModel
      .find({ _id: { $in: frameworkIds } })
      .select('_id title heroImageUrl')
      .lean();
    const byId = new Map(recipes.map((r: any) => [String(r._id), r]));

    return rows.map((r) => {
      const recipe = byId.get(String(r._id));
      return {
        frameworkId: String(r._id),
        count: r.count,
        title: recipe?.title,
        heroImageUrl: recipe?.heroImageUrl,
      };
    });
  }

  async getMostSearchedIngredients(params: {
    userId: string;
    scope?: 'mine' | 'global';
    window?: MetricsWindow;
    tz?: string | null;
    limit?: number;
  }): Promise<MostSearchedIngredient[]> {
    const limit = Math.min(Math.max(params.limit ?? 10, 1), 50);
    const window = params.window ?? MetricsWindow.ALL;
    const scope = params.scope ?? 'mine';

    const match: Record<string, any> = {};
    if (scope === 'mine') {
      const userOid = toObjectId(params.userId);
      if (!userOid) throw new BadRequestException('Invalid user');
      match.userId = userOid;
    }
    const from = windowStart(window, params.tz ?? null);
    if (from) {
      match.createdAt = { $gte: from };
    } else if (scope === 'global') {
      match.createdAt = { $gte: globalScopeFloor() };
    }

    const rows = await this.searchModel.aggregate([
      { $match: match },
      {
        $group: {
          _id: {
            ingredientId: '$ingredientId',
            query: {
              $cond: [
                { $ifNull: ['$ingredientId', false] },
                null,
                '$query',
              ],
            },
          },
          count: { $sum: 1 },
        },
      },
      { $sort: { count: -1 } },
      { $limit: limit },
    ]);

    if (rows.length === 0) return [];

    const ingredientIds = rows
      .map((r) => r._id?.ingredientId)
      .filter(Boolean);
    const ingredients = ingredientIds.length
      ? await this.ingredientModel
          .find({ _id: { $in: ingredientIds } })
          .select('_id name heroImageUrl')
          .lean()
      : [];
    const byId = new Map(ingredients.map((i: any) => [String(i._id), i]));

    return rows.map((r) => {
      const id = r._id?.ingredientId ? String(r._id.ingredientId) : null;
      const ingredient = id ? byId.get(id) : undefined;
      return {
        ingredientId: id,
        query: r._id?.query ?? null,
        count: r.count,
        title: ingredient?.name,
        icon: ingredient?.heroImageUrl,
      };
    });
  }


  async logClientEvent(payload: {
    userId: string | null;
    event: string;
    properties?: Record<string, any> | null;
    route?: string | null;
    platform?: string | null;
    appVersion?: string | null;
    sessionId?: string | null;
  }): Promise<void> {
    try {
      const event = (payload.event || '').trim();
      if (!event) return;
      await this.clientEventModel.create({
        userId: payload.userId ? toObjectId(payload.userId) : null,
        event: event.slice(0, 120),
        properties: sanitizeProperties(payload.properties),
        route: payload.route ? String(payload.route).slice(0, 120) : null,
        platform: payload.platform ? String(payload.platform).slice(0, 20) : null,
        appVersion: payload.appVersion ? String(payload.appVersion).slice(0, 40) : null,
        sessionId: payload.sessionId ? String(payload.sessionId).slice(0, 80) : null,
      });
    } catch (err: any) {
      this.logger.error(`logClientEvent failed: ${err?.message}`, err?.stack);
    }
  }

  async logClientEvents(
    userId: string | null,
    events: Array<{
      event: string;
      properties?: Record<string, any>;
      route?: string;
      platform?: string;
      appVersion?: string;
      sessionId?: string;
    }>,
  ): Promise<{ inserted: number }> {
    if (!events?.length) return { inserted: 0 };
    const userObjectId = userId ? toObjectId(userId) : null;
    const docs = events
      .map((e) => {
        const name = (e.event || '').trim();
        if (!name) return null;
        return {
          userId: userObjectId,
          event: name.slice(0, 120),
          properties: sanitizeProperties(e.properties),
          route: e.route ? String(e.route).slice(0, 120) : null,
          platform: e.platform ? String(e.platform).slice(0, 20) : null,
          appVersion: e.appVersion ? String(e.appVersion).slice(0, 40) : null,
          sessionId: e.sessionId ? String(e.sessionId).slice(0, 80) : null,
        };
      })
      .filter((d): d is NonNullable<typeof d> => d !== null);

    if (!docs.length) return { inserted: 0 };

    try {
      const res = await this.clientEventModel.insertMany(docs, { ordered: false });
      return { inserted: res.length };
    } catch (err: any) {
      const partial = err?.insertedDocs?.length ?? 0;
      this.logger.error(`logClientEvents partial/failure: ${err?.message}`, err?.stack);
      return { inserted: partial };
    }
  }
}


function sanitizeProperties(
  props: Record<string, any> | null | undefined,
): Record<string, any> {
  if (!props || typeof props !== 'object') return {};
  try {
    const json = JSON.stringify(props);
    if (json.length <= 4096) return JSON.parse(json);
    const out: Record<string, any> = {};
    for (const [k, v] of Object.entries(props)) {
      if (v === null || ['string', 'number', 'boolean'].includes(typeof v)) {
        out[k] = typeof v === 'string' ? v.slice(0, 500) : v;
      }
    }
    out.__truncated = true;
    return out;
  } catch {
    return {};
  }
}
