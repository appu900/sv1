import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import {
  ChefFavourite,
  ChefFavouriteDocument,
} from '../../database/schemas/chef-favourite.schema';
import {
  ChefProfile,
  ChefProfileDocument,
} from '../../database/schemas/chef-profile.schema';
import { RedisService } from '../../redis/redis.service';
import {
  CHEF_CACHE_KEYS,
  CHEF_FAV_SET_TTL,
} from './chef.constants';

function toObjectId(
  value: string | Types.ObjectId | null | undefined,
): Types.ObjectId | null {
  if (!value) return null;
  if (value instanceof Types.ObjectId) return value;
  if (!Types.ObjectId.isValid(String(value))) return null;
  return new Types.ObjectId(String(value));
}

@Injectable()
export class ChefFavouriteService {
  constructor(
    @InjectModel(ChefFavourite.name)
    private readonly favouriteModel: Model<ChefFavouriteDocument>,
    @InjectModel(ChefProfile.name)
    private readonly chefProfileModel: Model<ChefProfileDocument>,
    private readonly redisService: RedisService,
  ) {}

  async getFavouriteIds(userId: string): Promise<Set<string>> {
    const uid = toObjectId(userId);
    if (!uid) return new Set();

    const key = CHEF_CACHE_KEYS.favSet(String(uid));
    try {
      const members = await this.redisService.sMembers(key);
      if (members.length > 0) {
        return new Set(members);
      }
      // Distinguish empty-set cache miss: check existence via a sentinel key miss
      // by loading from Mongo when Redis set is empty.
    } catch {
      // fall through to Mongo
    }

    const rows = await this.favouriteModel
      .find({ userId: uid })
      .select({ chefId: 1 })
      .lean()
      .exec();
    const ids = rows.map((r) => String(r.chefId));

    if (ids.length) {
      await this.redisService.sAdd(key, ...ids);
      await this.redisService.expire(key, CHEF_FAV_SET_TTL);
    }

    return new Set(ids);
  }

  async isFavourited(userId: string | null | undefined, chefId: string): Promise<boolean> {
    if (!userId) return false;
    const favs = await this.getFavouriteIds(userId);
    return favs.has(String(chefId));
  }

  async getFavouriteCount(chefId: string): Promise<number> {
    const cid = toObjectId(chefId);
    if (!cid) return 0;

    const key = CHEF_CACHE_KEYS.favCount(String(cid));
    try {
      const raw = await this.redisService.getRaw(key);
      if (raw != null && raw !== '') {
        const n = Number(raw);
        if (Number.isFinite(n)) return Math.max(0, n);
      }
    } catch {
      // fall through
    }

    const profile = await this.chefProfileModel
      .findById(cid)
      .select({ favouriteCount: 1 })
      .lean()
      .exec();
    const count = Math.max(0, profile?.favouriteCount ?? 0);
    await this.redisService.setRaw(key, String(count));
    return count;
  }

  async addFavourite(
    userId: string,
    chefId: string,
  ): Promise<{ isFavourited: boolean; favouriteCount: number }> {
    const uid = toObjectId(userId);
    const cid = toObjectId(chefId);
    if (!uid || !cid) throw new BadRequestException('Invalid id');

    const profile = await this.chefProfileModel
      .findOne({ _id: cid, isPublished: true })
      .select({ _id: 1 })
      .lean()
      .exec();
    if (!profile) throw new NotFoundException('Chef not found');

    try {
      await this.favouriteModel.create({ userId: uid, chefId: cid });
      await this.chefProfileModel.updateOne(
        { _id: cid },
        { $inc: { favouriteCount: 1 } },
      );
      await this.redisService.sAdd(CHEF_CACHE_KEYS.favSet(String(uid)), String(cid));
      await this.redisService.expire(
        CHEF_CACHE_KEYS.favSet(String(uid)),
        CHEF_FAV_SET_TTL,
      );
      await this.redisService.incr(CHEF_CACHE_KEYS.favCount(String(cid)));
    } catch (err: any) {
      if (err?.code !== 11000) throw err;
      // already favourited — idempotent
    }

    return {
      isFavourited: true,
      favouriteCount: await this.getFavouriteCount(String(cid)),
    };
  }

  async removeFavourite(
    userId: string,
    chefId: string,
  ): Promise<{ isFavourited: boolean; favouriteCount: number }> {
    const uid = toObjectId(userId);
    const cid = toObjectId(chefId);
    if (!uid || !cid) throw new BadRequestException('Invalid id');

    const deleted = await this.favouriteModel
      .findOneAndDelete({ userId: uid, chefId: cid })
      .lean()
      .exec();

    if (deleted) {
      await this.chefProfileModel.updateOne(
        { _id: cid, favouriteCount: { $gt: 0 } },
        { $inc: { favouriteCount: -1 } },
      );
      await this.redisService.sRem(CHEF_CACHE_KEYS.favSet(String(uid)), String(cid));
      const next = await this.redisService.decr(CHEF_CACHE_KEYS.favCount(String(cid)));
      if (next < 0) {
        await this.redisService.setRaw(CHEF_CACHE_KEYS.favCount(String(cid)), '0');
      }
    }

    return {
      isFavourited: false,
      favouriteCount: await this.getFavouriteCount(String(cid)),
    };
  }

  async flushFavouriteCountsToMongo(): Promise<void> {
    const profiles = await this.chefProfileModel
      .find({})
      .select({ _id: 1 })
      .lean()
      .exec();
    if (!profiles.length) return;

    const keys = profiles.map((p) => CHEF_CACHE_KEYS.favCount(String(p._id)));
    const values = await this.redisService.mGet(keys);

    const ops = profiles
      .map((p, i) => {
        const raw = values[i];
        if (raw == null) return null;
        const n = Number(raw);
        if (!Number.isFinite(n)) return null;
        return {
          updateOne: {
            filter: { _id: p._id },
            update: {
              $set: { favouriteCount: Math.max(0, Math.floor(n)) },
            },
          },
        };
      })
      .filter(Boolean);

    if (ops.length) {
      await this.chefProfileModel.bulkWrite(ops as any, { ordered: false });
    }
  }
}
