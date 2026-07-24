import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
// CronExpression used for hourly job below
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { randomUUID } from 'crypto';
import {
  ChefImpactDaily,
  ChefImpactDailyDocument,
} from '../../database/schemas/chef-impact-daily.schema';
import {
  ChefCommunityDaily,
  ChefCommunityDailyDocument,
} from '../../database/schemas/chef-community-daily.schema';
import {
  ChefLeaderboardSnapshot,
  ChefLeaderboardSnapshotDocument,
} from '../../database/schemas/chef-leaderboard-snapshot.schema';
import {
  ChefProfile,
  ChefProfileDocument,
} from '../../database/schemas/chef-profile.schema';
import {
  FoodSavedEventLog,
  FoodSavedEventLogDocument,
} from '../../database/schemas/food-saved-event-log.schema';
import { RedisService } from '../../redis/redis.service';
import { ChefService } from './chef.service';
import { ChefFavouriteService } from './chef-favourite.service';
import { ChefProfileSyncService } from './chef-profile-sync.service';
import {
  CHEF_SNAPSHOT_KEYS,
  RISING_STAR,
  currencyFromCountry,
  normalizeMoneyByCurrency,
  utcDayStart,
} from './chef.constants';

@Injectable()
export class ChefAnalyticsCronService {
  private readonly logger = new Logger(ChefAnalyticsCronService.name);

  constructor(
    @InjectModel(ChefImpactDaily.name)
    private readonly impactDailyModel: Model<ChefImpactDailyDocument>,
    @InjectModel(ChefCommunityDaily.name)
    private readonly communityDailyModel: Model<ChefCommunityDailyDocument>,
    @InjectModel(ChefLeaderboardSnapshot.name)
    private readonly snapshotModel: Model<ChefLeaderboardSnapshotDocument>,
    @InjectModel(ChefProfile.name)
    private readonly chefProfileModel: Model<ChefProfileDocument>,
    @InjectModel(FoodSavedEventLog.name)
    private readonly foodSavedModel: Model<FoodSavedEventLogDocument>,
    private readonly redisService: RedisService,
    private readonly chefService: ChefService,
    private readonly favouriteService: ChefFavouriteService,
    private readonly syncService: ChefProfileSyncService,
  ) {}

  private async withLock(key: string, ttlSeconds: number, fn: () => Promise<void>) {
    const token = randomUUID();
    const acquired = await this.redisService.setIfAbsent(
      `lock:chef-cron:${key}`,
      token,
      ttlSeconds,
    );
    if (!acquired) {
      this.logger.debug(`Skipping ${key} — lock held`);
      return;
    }
    try {
      await fn();
    } finally {
      await this.redisService.releaseLock(`lock:chef-cron:${key}`, token);
    }
  }

  private async saveSnapshot(key: string, payload: Record<string, unknown>) {
    await this.snapshotModel.updateOne(
      { key },
      { $set: { key, payload, computedAt: new Date() } },
      { upsert: true },
    );
    await this.redisService.set(`chefs:snapshot:${key}`, payload, 600);
  }

  private periodRange(period: 'month' | 'year' | 'all'): Date | null {
    const now = new Date();
    if (period === 'all') return null;
    if (period === 'year') {
      return new Date(Date.UTC(now.getUTCFullYear(), 0, 1));
    }
    return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  }

  private moneyByCurrencyToObject(
    map?: Map<string, number> | Record<string, number> | null,
  ): Record<string, number> {
    if (!map) return {};
    if (map instanceof Map) return Object.fromEntries(map.entries());
    return { ...map };
  }

  @Cron('*/15 * * * *')
  async refreshPopularAndCuisineRail() {
    await this.withLock('popular-cuisine', 120, async () => {
      const since = utcDayStart(new Date(Date.now() - 7 * 24 * 60 * 60 * 1000));
      const rows = await this.impactDailyModel.aggregate([
        { $match: { day: { $gte: since } } },
        {
          $group: {
            _id: '$chefId',
            mealsCooked: { $sum: '$mealsCooked' },
          },
        },
        { $sort: { mealsCooked: -1 } },
        { $limit: 20 },
      ]);

      const profiles = await this.chefProfileModel
        .find({
          _id: { $in: rows.map((r) => r._id) },
          isPublished: true,
        })
        .lean()
        .exec();
      const byId = new Map(profiles.map((p) => [String(p._id), p]));

      const chefs = rows
        .map((r) => {
          const p = byId.get(String(r._id));
          if (!p) return null;
          return {
            id: String(p._id),
            slug: p.slug,
            displayName: p.displayName,
            country: p.country ?? null,
            avatarImageUrl: p.avatarImageUrl ?? null,
            heroImageUrl: p.heroImageUrl ?? p.avatarImageUrl ?? null,
            quote: p.quote ?? null,
            isFavourited: false,
            favouriteCount: p.favouriteCount ?? 0,
            publishedRecipeCount: p.publishedRecipeCount ?? 0,
            weekMeals: r.mealsCooked,
            order: p.order ?? 0,
          };
        })
        .filter(Boolean)
        .slice(0, 10);

      // Fallback: fill with curated published chefs if week is quiet
      if (chefs.length < 10) {
        const existing = new Set(chefs.map((c: any) => c.id));
        const fillers = await this.chefProfileModel
          .find({ isPublished: true, _id: { $nin: [...existing].map((id) => new Types.ObjectId(id)) } })
          .sort({ order: 1, 'lifetime.mealsCooked': -1 })
          .limit(10 - chefs.length)
          .lean()
          .exec();
        for (const p of fillers) {
          chefs.push({
            id: String(p._id),
            slug: p.slug,
            displayName: p.displayName,
            country: p.country ?? null,
            avatarImageUrl: p.avatarImageUrl ?? null,
            heroImageUrl: p.heroImageUrl ?? p.avatarImageUrl ?? null,
            quote: p.quote ?? null,
            isFavourited: false,
            favouriteCount: p.favouriteCount ?? 0,
            publishedRecipeCount: p.publishedRecipeCount ?? 0,
            weekMeals: 0,
            order: p.order ?? 0,
          });
        }
      }

      await this.saveSnapshot(CHEF_SNAPSHOT_KEYS.popularWeek, { chefs });
      const cuisines = await this.chefService.buildCuisineRail(20);
      await this.saveSnapshot(CHEF_SNAPSHOT_KEYS.cuisineRail, { cuisines });
      this.logger.log('Refreshed popular:week and cuisineRail snapshots');
    });
  }

  @Cron(CronExpression.EVERY_HOUR)
  async refreshCommunityAndAwards() {
    await this.withLock('community-awards', 300, async () => {
      const published = await this.chefProfileModel
        .find({ isPublished: true })
        .select({
          _id: 1,
          slug: 1,
          displayName: 1,
          country: 1,
          avatarImageUrl: 1,
          firstPublishedAt: 1,
        })
        .lean()
        .exec();
      const publishedById = new Map(published.map((p) => [String(p._id), p]));
      // Rising star uses a rolling 30/60d window — compute once, reuse for all periods
      const risingStar = await this.computeRisingStar(publishedById);

      for (const period of ['month', 'year', 'all'] as const) {
        await this.computeCommunity(period);
        await this.computeAwards(period, publishedById, risingStar);
      }
      this.logger.log('Refreshed community + awards snapshots');
    });
  }

  private async computeCommunity(period: 'month' | 'year' | 'all') {
    const from = this.periodRange(period);
    const match: any = {};
    if (from) match.day = { $gte: from };

    const rows = await this.communityDailyModel.aggregate([
      ...(Object.keys(match).length ? [{ $match: match }] : []),
      {
        $group: {
          _id: null,
          mealsCooked: { $sum: '$mealsCooked' },
          moneySaved: { $sum: '$moneySaved' },
          foodSavedInGrams: { $sum: '$foodSavedInGrams' },
          co2SavedInGrams: { $sum: '$co2SavedInGrams' },
          moneyByCurrencyDocs: { $push: '$moneyByCurrency' },
        },
      },
    ]);

    const row = rows[0];
    const moneyByCurrency: Record<string, number> = {};
    for (const doc of row?.moneyByCurrencyDocs || []) {
      const obj = this.moneyByCurrencyToObject(doc);
      for (const [k, v] of Object.entries(obj)) {
        moneyByCurrency[k] = (moneyByCurrency[k] || 0) + (Number(v) || 0);
      }
    }

    await this.saveSnapshot(CHEF_SNAPSHOT_KEYS.community(period), {
      mealsCooked: row?.mealsCooked ?? 0,
      moneySaved: row?.moneySaved ?? 0,
      moneyByCurrency,
      foodSavedInGrams: row?.foodSavedInGrams ?? 0,
      co2SavedInGrams: row?.co2SavedInGrams ?? 0,
    });
  }

  private async computeAwards(
    period: 'month' | 'year' | 'all',
    publishedById: Map<string, any>,
    risingStar: any | null,
  ) {
    const from = this.periodRange(period);
    const match: any = {};
    if (from) match.day = { $gte: from };

    const totals = await this.impactDailyModel.aggregate([
      ...(Object.keys(match).length ? [{ $match: match }] : []),
      {
        $group: {
          _id: '$chefId',
          mealsCooked: { $sum: '$mealsCooked' },
          foodSavedInGrams: { $sum: '$foodSavedInGrams' },
          co2SavedInGrams: { $sum: '$co2SavedInGrams' },
        },
      },
    ]);

    const eligible = totals.filter((t) => publishedById.has(String(t._id)));

    const pick = (metric: 'mealsCooked' | 'foodSavedInGrams' | 'co2SavedInGrams') => {
      if (!eligible.length) return null;
      const sorted = [...eligible].sort((a, b) => (b[metric] || 0) - (a[metric] || 0));
      const top = sorted[0];
      if (!top || !(top[metric] > 0)) return null;
      const p = publishedById.get(String(top._id));
      if (!p) return null;
      return {
        id: String(p._id),
        slug: p.slug,
        displayName: p.displayName,
        country: p.country ?? null,
        avatarImageUrl: p.avatarImageUrl ?? null,
        value: top[metric],
      };
    };

    await this.saveSnapshot(CHEF_SNAPSHOT_KEYS.awards(period), {
      mostMeals: pick('mealsCooked'),
      mostFood: pick('foodSavedInGrams'),
      mostCo2: pick('co2SavedInGrams'),
      risingStar,
    });
  }

  private async computeRisingStar(
    publishedById: Map<string, any>,
  ): Promise<any | null> {
    const now = Date.now();
    const currentStart = utcDayStart(new Date(now - 30 * 24 * 60 * 60 * 1000));
    const previousStart = utcDayStart(new Date(now - 60 * 24 * 60 * 60 * 1000));

    const [current, previous] = await Promise.all([
      this.impactDailyModel.aggregate([
        { $match: { day: { $gte: currentStart } } },
        { $group: { _id: '$chefId', meals: { $sum: '$mealsCooked' } } },
      ]),
      this.impactDailyModel.aggregate([
        {
          $match: {
            day: { $gte: previousStart, $lt: currentStart },
          },
        },
        { $group: { _id: '$chefId', meals: { $sum: '$mealsCooked' } } },
      ]),
    ]);

    const prevMap = new Map(previous.map((r) => [String(r._id), r.meals as number]));
    let best: { id: string; score: number; current: number } | null = null;

    for (const row of current) {
      const id = String(row._id);
      const profile = publishedById.get(id);
      if (!profile?.firstPublishedAt) continue;
      const cur = row.meals as number;
      if (cur < RISING_STAR.minMealsCurrent30d) continue;
      const prev = prevMap.get(id) || 0;
      const score = (cur - prev) / Math.max(prev, RISING_STAR.previousFloor);
      if (
        !best ||
        score > best.score ||
        (score === best.score && cur > best.current)
      ) {
        best = { id, score, current: cur };
      }
    }

    if (!best) return null;
    const p = publishedById.get(best.id);
    if (!p) return null;
    return {
      id: String(p._id),
      slug: p.slug,
      displayName: p.displayName,
      country: p.country ?? null,
      avatarImageUrl: p.avatarImageUrl ?? null,
      score: Number(best.score.toFixed(3)),
      currentMeals: best.current,
      description: 'One of our fastest growing chefs this month.',
    };
  }

  @Cron('0 30 2 * * *', {
    name: 'chef-impact-reconciliation',
    timeZone: 'Asia/Kolkata',
  })
  async nightlyReconciliation() {
    await this.withLock('reconcile', 1800, async () => {
      this.logger.log('Starting chef impact reconciliation');
      const since = utcDayStart(new Date(Date.now() - 3 * 24 * 60 * 60 * 1000));

      // Rebuild last 3 days of daily rollups from the event log.
      const events = await this.foodSavedModel
        .find({ createdAt: { $gte: since }, chefIds: { $exists: true, $ne: [] } })
        .select({
          chefIds: 1,
          foodSavedInGrams: 1,
          moneySaved: 1,
          co2SavedInGrams: 1,
          currency: 1,
          country: 1,
          createdAt: 1,
        })
        .lean()
        .exec();

      type Acc = {
        mealsCooked: number;
        moneySaved: number;
        foodSavedInGrams: number;
        co2SavedInGrams: number;
        moneyByCurrency: Record<string, number>;
      };
      const chefDay = new Map<string, Acc>();
      const communityDay = new Map<string, Acc>();

      const bump = (map: Map<string, Acc>, key: string, delta: Acc) => {
        const cur = map.get(key) || {
          mealsCooked: 0,
          moneySaved: 0,
          foodSavedInGrams: 0,
          co2SavedInGrams: 0,
          moneyByCurrency: {},
        };
        cur.mealsCooked += delta.mealsCooked;
        cur.moneySaved += delta.moneySaved;
        cur.foodSavedInGrams += delta.foodSavedInGrams;
        cur.co2SavedInGrams += delta.co2SavedInGrams;
        for (const [k, v] of Object.entries(delta.moneyByCurrency)) {
          cur.moneyByCurrency[k] = (cur.moneyByCurrency[k] || 0) + v;
        }
        map.set(key, cur);
      };

      // Resolve user chef ids → profile ids once
      const allUserIds = [
        ...new Set(
          events.flatMap((e) => (e.chefIds || []).map(String)),
        ),
      ];
      const profileIdByUserId = new Map<string, string>();
      if (allUserIds.length) {
        const profiles = await this.chefProfileModel
          .find({
            userId: { $in: allUserIds.map((id) => new Types.ObjectId(id)) },
          })
          .select({ _id: 1, userId: 1 })
          .lean()
          .exec();
        for (const p of profiles) {
          profileIdByUserId.set(String(p.userId), String(p._id));
        }
      }

      for (const e of events) {
        const day = utcDayStart(new Date(e.createdAt));
        const dayKey = day.toISOString();
        // Prefer country mapping; fold legacy UNKNOWN into DEFAULT_CURRENCY
        const rawCurrency = e.currency || currencyFromCountry(e.country);
        const moneyByCurrency = normalizeMoneyByCurrency({
          [rawCurrency]: e.moneySaved || 0,
        });
        const delta: Acc = {
          mealsCooked: 1,
          moneySaved: e.moneySaved || 0,
          foodSavedInGrams: e.foodSavedInGrams || 0,
          co2SavedInGrams: e.co2SavedInGrams || 0,
          moneyByCurrency,
        };

        const profileIds = (e.chefIds || [])
          .map((id) => profileIdByUserId.get(String(id)))
          .filter((id): id is string => !!id);

        if (!profileIds.length) continue;

        for (const pid of profileIds) {
          bump(chefDay, `${pid}|${dayKey}`, delta);
        }
        bump(communityDay, dayKey, delta);
      }

      // Upsert recomputed days (no blank-window delete — avoids racing live $inc)
      const impactOps = [...chefDay.entries()].map(([key, acc]) => {
        const [chefId, dayIso] = key.split('|');
        return {
          updateOne: {
            filter: {
              chefId: new Types.ObjectId(chefId),
              day: new Date(dayIso),
            },
            update: {
              $set: {
                chefId: new Types.ObjectId(chefId),
                day: new Date(dayIso),
                mealsCooked: acc.mealsCooked,
                moneySaved: acc.moneySaved,
                foodSavedInGrams: acc.foodSavedInGrams,
                co2SavedInGrams: acc.co2SavedInGrams,
                moneyByCurrency: normalizeMoneyByCurrency(acc.moneyByCurrency),
              },
            },
            upsert: true,
          },
        };
      });

      if (impactOps.length) {
        await this.impactDailyModel.bulkWrite(impactOps as any, {
          ordered: false,
        });
      }

      const communityOps = [...communityDay.entries()].map(([dayIso, acc]) => ({
        updateOne: {
          filter: { day: new Date(dayIso) },
          update: {
            $set: {
              day: new Date(dayIso),
              mealsCooked: acc.mealsCooked,
              moneySaved: acc.moneySaved,
              foodSavedInGrams: acc.foodSavedInGrams,
              co2SavedInGrams: acc.co2SavedInGrams,
              moneyByCurrency: normalizeMoneyByCurrency(acc.moneyByCurrency),
            },
          },
          upsert: true,
        },
      }));
      if (communityOps.length) {
        await this.communityDailyModel.bulkWrite(communityOps as any, {
          ordered: false,
        });
      }

      // Delete orphan days in the window that were not recomputed
      const keptChefDays = [...chefDay.keys()].map((key) => {
        const [chefId, dayIso] = key.split('|');
        return {
          chefId: new Types.ObjectId(chefId),
          day: new Date(dayIso),
        };
      });
      if (keptChefDays.length) {
        await this.impactDailyModel.deleteMany({
          day: { $gte: since },
          $nor: keptChefDays.map((k) => ({ chefId: k.chefId, day: k.day })),
        });
      } else {
        await this.impactDailyModel.deleteMany({ day: { $gte: since } });
      }

      const keptCommunityDays = [...communityDay.keys()].map(
        (dayIso) => new Date(dayIso),
      );
      if (keptCommunityDays.length) {
        await this.communityDailyModel.deleteMany({
          day: { $gte: since, $nin: keptCommunityDays },
        });
      } else {
        await this.communityDailyModel.deleteMany({ day: { $gte: since } });
      }

      // Recompute lifetime from full ChefImpactDaily for ALL profiles
      const lifetimes = await this.impactDailyModel.aggregate([
        {
          $group: {
            _id: '$chefId',
            mealsCooked: { $sum: '$mealsCooked' },
            moneySaved: { $sum: '$moneySaved' },
            foodSavedInGrams: { $sum: '$foodSavedInGrams' },
            co2SavedInGrams: { $sum: '$co2SavedInGrams' },
            moneyByCurrencyDocs: { $push: '$moneyByCurrency' },
          },
        },
      ]);

      const lifetimeByChefId = new Map<string, any>();
      for (const row of lifetimes) {
        const moneyByCurrency: Record<string, number> = {};
        for (const doc of row.moneyByCurrencyDocs || []) {
          const obj = this.moneyByCurrencyToObject(doc);
          for (const [k, v] of Object.entries(obj)) {
            moneyByCurrency[k] = (moneyByCurrency[k] || 0) + (Number(v) || 0);
          }
        }
        lifetimeByChefId.set(String(row._id), {
          mealsCooked: row.mealsCooked,
          moneySaved: row.moneySaved,
          foodSavedInGrams: row.foodSavedInGrams,
          co2SavedInGrams: row.co2SavedInGrams,
          moneyByCurrency: normalizeMoneyByCurrency(moneyByCurrency),
        });
      }

      const allProfiles = await this.chefProfileModel
        .find({})
        .select({ _id: 1 })
        .lean()
        .exec();
      const lifetimeOps = allProfiles.map((p) => {
        const lifetime = lifetimeByChefId.get(String(p._id)) || {
          mealsCooked: 0,
          moneySaved: 0,
          foodSavedInGrams: 0,
          co2SavedInGrams: 0,
          moneyByCurrency: {},
        };
        return {
          updateOne: {
            filter: { _id: p._id },
            update: {
              $set: {
                'lifetime.mealsCooked': lifetime.mealsCooked,
                'lifetime.moneySaved': lifetime.moneySaved,
                'lifetime.foodSavedInGrams': lifetime.foodSavedInGrams,
                'lifetime.co2SavedInGrams': lifetime.co2SavedInGrams,
                'lifetime.moneyByCurrency': lifetime.moneyByCurrency,
              },
            },
          },
        };
      });
      if (lifetimeOps.length) {
        await this.chefProfileModel.bulkWrite(lifetimeOps as any, {
          ordered: false,
        });
      }

      await this.favouriteService.flushFavouriteCountsToMongo();
      await this.syncService.syncAll();
      await this.refreshPopularAndCuisineRail();
      await this.refreshCommunityAndAwards();
      await this.chefService.invalidateCaches();
      this.logger.log(
        `Reconciliation complete — events=${events.length} chefDays=${chefDay.size}`,
      );
    });
  }
}
