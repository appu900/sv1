import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import {
  DataVersion,
  DataVersionDocument,
} from '../../database/schemas/data-version.schema';
import { RedisService } from '../../redis/redis.service';

export const DATA_VERSION_KEYS = [
  'recipes',
  'ingredients',
  'frameworkCategories',
  'stickers',
] as const;

export type DataVersionKey = (typeof DATA_VERSION_KEYS)[number];

export type DataVersionManifest = Record<DataVersionKey, number>;

/**
 * Deliberately outside the `recipes:*` and `Ingredients:*` namespaces, which are
 * wiped wholesale by `delByPattern` on startup and on every mutation.
 *
 * Kept in sync with saveful-india-web/lib/invalidateRecipeCache.ts, which bumps
 * the same keys for writes that bypass Nest.
 */
export const DATA_VERSION_REDIS_PREFIX = 'dataversion:';

@Injectable()
export class DataVersionService {
  private readonly logger = new Logger(DataVersionService.name);

  constructor(
    @InjectModel(DataVersion.name)
    private readonly dataVersionModel: Model<DataVersionDocument>,
    private readonly redisService: RedisService,
  ) {}

  async getManifest(): Promise<DataVersionManifest> {
    const keys = DATA_VERSION_KEYS.map(
      (key) => `${DATA_VERSION_REDIS_PREFIX}${key}`,
    );

    let cached: (string | null)[] = [];
    try {
      cached = await this.redisService.mGet(keys);
    } catch (error) {
      this.logger.warn(
        `Data version cache read failed: ${this.message(error)}`,
      );
    }

    const manifest = {} as DataVersionManifest;
    const missing: DataVersionKey[] = [];

    DATA_VERSION_KEYS.forEach((key, index) => {
      const parsed = Number(cached[index]);
      if (cached[index] != null && Number.isFinite(parsed)) {
        manifest[key] = parsed;
      } else {
        missing.push(key);
      }
    });

    if (missing.length === 0) {
      return manifest;
    }

    // Redis lost the counter (flush, eviction, cold start). Reload the durable
    // floor from Mongo and reseed. Clients treat any change — including a
    // decrease — as "refetch", so this is self-healing rather than sticky-stale.
    const rows = await this.dataVersionModel
      .find({ collectionKey: { $in: missing } })
      .select('collectionKey version')
      .lean();
    const byKey = new Map(rows.map((row) => [row.collectionKey, row.version]));

    for (const key of missing) {
      const version = byKey.get(key) ?? 0;
      manifest[key] = version;
      try {
        await this.redisService.setRaw(
          `${DATA_VERSION_REDIS_PREFIX}${key}`,
          String(version),
        );
      } catch {
        // Serving the manifest matters more than reseeding the cache.
      }
    }

    return manifest;
  }

  async getVersion(key: DataVersionKey): Promise<number> {
    const manifest = await this.getManifest();
    return manifest[key] ?? 0;
  }

  /**
   * Increments in Redis so bumps compose with the ones issued by the web admin,
   * then records the result in Mongo as a durable floor via `$max`.
   *
   * Never throws: a failed bump must not fail the mutation that triggered it.
   */
  async bump(key: DataVersionKey): Promise<number | null> {
    try {
      const version = await this.redisService.incr(
        `${DATA_VERSION_REDIS_PREFIX}${key}`,
      );
      await this.persistFloor(key, version);
      return version;
    } catch (redisError) {
      this.logger.warn(
        `Data version Redis bump failed for ${key}, falling back to Mongo: ${this.message(redisError)}`,
      );
      try {
        const updated = await this.dataVersionModel.findOneAndUpdate(
          { collectionKey: key },
          { $inc: { version: 1 } },
          { upsert: true, new: true, setDefaultsOnInsert: true },
        );
        return updated?.version ?? null;
      } catch (mongoError) {
        this.logger.error(
          `Failed to bump data version for ${key}: ${this.message(mongoError)}`,
        );
        return null;
      }
    }
  }

  private async persistFloor(key: DataVersionKey, version: number) {
    try {
      await this.dataVersionModel.updateOne(
        { collectionKey: key },
        { $max: { version } },
        { upsert: true },
      );
    } catch (error) {
      this.logger.warn(
        `Failed to persist data version floor for ${key}: ${this.message(error)}`,
      );
    }
  }

  private message(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }
}
