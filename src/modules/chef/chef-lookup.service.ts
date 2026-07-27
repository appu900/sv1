import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import {
  Recipe,
  RecipeDocument,
} from '../../database/schemas/recipe.schema';
import {
  ChefProfile,
  ChefProfileDocument,
} from '../../database/schemas/chef-profile.schema';
import { RedisService } from '../../redis/redis.service';
import {
  CHEF_CACHE_KEYS,
  CHEF_RECIPE_CHEFS_TTL,
  PUBLIC_CHEF_FILTER,
} from './chef.constants';

function toObjectId(
  value: string | Types.ObjectId | { _id?: unknown; id?: unknown } | null | undefined,
): Types.ObjectId | null {
  if (!value) return null;
  if (value instanceof Types.ObjectId) return value;
  if (typeof value === 'object') {
    const nested = (value as { _id?: unknown; id?: unknown })._id
      ?? (value as { id?: unknown }).id;
    if (nested !== undefined && nested !== value) {
      return toObjectId(
        nested as string | Types.ObjectId | { _id?: unknown; id?: unknown },
      );
    }
  }
  if (!Types.ObjectId.isValid(String(value))) return null;
  return new Types.ObjectId(String(value));
}

@Injectable()
export class ChefLookupService {
  private readonly logger = new Logger(ChefLookupService.name);

  constructor(
    @InjectModel(Recipe.name)
    private readonly recipeModel: Model<RecipeDocument>,
    @InjectModel(ChefProfile.name)
    private readonly chefProfileModel: Model<ChefProfileDocument>,
    private readonly redisService: RedisService,
  ) {}

  async getChefUserIdsForRecipe(
    recipeId?: string | Types.ObjectId | null,
  ): Promise<Types.ObjectId[]> {
    const id = toObjectId(recipeId);
    if (!id) return [];

    const cacheKey = CHEF_CACHE_KEYS.recipeChefs(String(id));
    try {
      const cached = await this.redisService.get<string[]>(cacheKey);
      if (cached) {
        return cached
          .map((v) => toObjectId(v))
          .filter((v): v is Types.ObjectId => v !== null);
      }
    } catch (err: any) {
      this.logger.warn(`recipe chef cache read failed: ${err?.message}`);
    }

    const recipe = await this.recipeModel
      .findById(id)
      .select({ chefIds: 1 })
      .lean()
      .exec();

    const chefIds = (recipe?.chefIds ?? [])
      .map((v) => toObjectId(v))
      .filter((v): v is Types.ObjectId => v !== null);

    try {
      await this.redisService.set(
        cacheKey,
        chefIds.map(String),
        CHEF_RECIPE_CHEFS_TTL,
      );
    } catch {
      // non-fatal
    }

    return chefIds;
  }


  async resolveProfileIds(
    userIds: Array<string | Types.ObjectId>,
  ): Promise<Types.ObjectId[]> {
    const unique = Array.from(
      new Set(
        userIds
          .map((v) => toObjectId(v))
          .filter((v): v is Types.ObjectId => v !== null)
          .map(String),
      ),
    ).map((s) => new Types.ObjectId(s));

    if (!unique.length) return [];

    const profiles = await this.chefProfileModel
      .find({ userId: { $in: unique } })
      .select({ _id: 1 })
      .lean()
      .exec();

    return profiles
      .map((p) => toObjectId(p._id))
      .filter((v): v is Types.ObjectId => v !== null);
  }

  async invalidateRecipeChefCache(
    recipeId?: string | Types.ObjectId | null,
  ): Promise<void> {
    const id = toObjectId(recipeId);
    if (!id) return;
    await this.redisService.del(CHEF_CACHE_KEYS.recipeChefs(String(id)));
  }

  async getPublishedChefUserIds(): Promise<Types.ObjectId[]> {
    const cacheKey = 'chefs:published-user-ids:v1';
    try {
      const cached = await this.redisService.get<string[]>(cacheKey);
      if (cached) {
        return cached
          .map((v) => toObjectId(v))
          .filter((v): v is Types.ObjectId => v !== null);
      }
    } catch {
      // non-fatal
    }

    const profiles = await this.chefProfileModel
      .find(PUBLIC_CHEF_FILTER)
      .select({ userId: 1 })
      .lean()
      .exec();

    const userIds = profiles
      .map((p) => toObjectId(p.userId))
      .filter((v): v is Types.ObjectId => v !== null);

    try {
      await this.redisService.set(
        cacheKey,
        userIds.map(String),
        CHEF_RECIPE_CHEFS_TTL,
      );
    } catch {
      // non-fatal
    }

    return userIds;
  }

  async isRecipePubliclyVisible(
    chefIds?: Array<string | Types.ObjectId | { _id?: unknown; id?: unknown }> | null,
  ): Promise<boolean> {
    const attributed = (chefIds ?? [])
      .map((v) => toObjectId(v))
      .filter((v): v is Types.ObjectId => v !== null);
    if (!attributed.length) return true;

    const published = await this.getPublishedChefUserIds();
    if (!published.length) return false;
    const publishedSet = new Set(published.map(String));
    return attributed.some((id) => publishedSet.has(String(id)));
  }
}
