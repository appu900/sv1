import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import {
  ChefProfile,
  ChefProfileDocument,
} from '../../database/schemas/chef-profile.schema';
import {
  Recipe,
  RecipeDocument,
} from '../../database/schemas/recipe.schema';
import { RedisService } from '../../redis/redis.service';
import { CHEF_CACHE_KEYS } from './chef.constants';

function toObjectId(
  value: string | Types.ObjectId | null | undefined,
): Types.ObjectId | null {
  if (!value) return null;
  if (value instanceof Types.ObjectId) return value;
  if (!Types.ObjectId.isValid(String(value))) return null;
  return new Types.ObjectId(String(value));
}

@Injectable()
export class ChefProfileSyncService {
  private readonly logger = new Logger(ChefProfileSyncService.name);

  constructor(
    @InjectModel(ChefProfile.name)
    private readonly chefProfileModel: Model<ChefProfileDocument>,
    @InjectModel(Recipe.name)
    private readonly recipeModel: Model<RecipeDocument>,
    private readonly redisService: RedisService,
  ) {}

  /**
   * Recompute publishedRecipeCount, cuisineIds, firstPublishedAt for the
   * given chef *user* ids (recipe.chefIds values).
   */
  async syncChefs(
    chefUserIds: Array<string | Types.ObjectId | null | undefined>,
  ): Promise<void> {
    const unique = [
      ...new Set(
        chefUserIds
          .map((v) => toObjectId(v))
          .filter((v): v is Types.ObjectId => v !== null)
          .map(String),
      ),
    ];

    if (!unique.length) return;

    try {
      await Promise.all(unique.map((id) => this.syncOne(new Types.ObjectId(id))));
      await this.redisService.delByPattern(CHEF_CACHE_KEYS.patternAll);
    } catch (err: any) {
      this.logger.warn(`syncChefs failed: ${err?.message}`);
    }
  }

  async syncAll(): Promise<number> {
    const profiles = await this.chefProfileModel
      .find({})
      .select({ userId: 1 })
      .lean()
      .exec();
    await this.syncChefs(profiles.map((p) => p.userId));
    return profiles.length;
  }

  private async syncOne(userId: Types.ObjectId): Promise<void> {
    const rows = await this.recipeModel.aggregate<{
      publishedRecipeCount: number;
      cuisineIds: Types.ObjectId[];
      firstPublishedAt: Date | null;
    }>([
      {
        $match: {
          isActive: true,
          chefIds: userId,
        },
      },
      {
        $group: {
          _id: null,
          publishedRecipeCount: { $sum: 1 },
          cuisineIds: { $addToSet: '$cuisines' },
          firstPublishedAt: { $min: '$createdAt' },
        },
      },
      {
        $project: {
          publishedRecipeCount: 1,
          firstPublishedAt: 1,
          cuisineIds: {
            $reduce: {
              input: '$cuisineIds',
              initialValue: [],
              in: { $setUnion: ['$$value', '$$this'] },
            },
          },
        },
      },
    ]);

    const stats = rows[0] ?? {
      publishedRecipeCount: 0,
      cuisineIds: [] as Types.ObjectId[],
      firstPublishedAt: null as Date | null,
    };

    await this.chefProfileModel.updateOne(
      { userId },
      {
        $set: {
          publishedRecipeCount: stats.publishedRecipeCount,
          cuisineIds: stats.cuisineIds ?? [],
          firstPublishedAt: stats.firstPublishedAt,
        },
      },
    );
  }
}
