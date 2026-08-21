import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { createHash } from 'crypto';
import { Model, Types } from 'mongoose';
import {
  ChefProfile,
  ChefProfileDocument,
} from '../../database/schemas/chef-profile.schema';
import {
  ChefFavourite,
  ChefFavouriteDocument,
} from '../../database/schemas/chef-favourite.schema';
import {
  ChefLeaderboardSnapshot,
  ChefLeaderboardSnapshotDocument,
} from '../../database/schemas/chef-leaderboard-snapshot.schema';
import {
  Cuisine,
  CuisineDocument,
} from '../../database/schemas/cuisine.schema';
import {
  Recipe,
  RecipeDocument,
} from '../../database/schemas/recipe.schema';
import { RedisService } from '../../redis/redis.service';
import { normalizeCountry } from '../../utils/countries.util';
import { DataVersionService } from '../data-version/data-version.service';
import { ChefFavouriteService } from './chef-favourite.service';
import {
  CHEF_CACHE_KEYS,
  CHEF_CACHE_TTL,
  CHEF_HOME_CACHE_TTL,
  CHEF_SNAPSHOT_KEYS,
  DEFAULT_CURRENCY,
  PUBLIC_CHEF_FILTER,
  currencyFromCountry,
  formatCurrencyLabel,
  normalizeMoneyByCurrency,
} from './chef.constants';

function toObjectId(
  value: string | Types.ObjectId | null | undefined,
): Types.ObjectId | null {
  if (!value) return null;
  if (value instanceof Types.ObjectId) return value;
  if (!Types.ObjectId.isValid(String(value))) return null;
  return new Types.ObjectId(String(value));
}

/**
 * Where a chef is discoverable when browsing by cuisine: the inspiration they
 * chose themselves when they picked any, otherwise the cuisines their published
 * recipes cover. Keeps cuisine listings and counts consistent with the
 * "My Cuisine Inspiration" block on their profile.
 */
const NO_FEATURED_CUISINES = {
  $or: [{ featuredCuisineIds: null }, { featuredCuisineIds: { $size: 0 } }],
};

function effectiveCuisineFilter(match: Types.ObjectId | Record<string, any>) {
  return {
    $or: [
      { featuredCuisineIds: match },
      { $and: [NO_FEATURED_CUISINES, { cuisineIds: match }] },
    ],
  };
}

/** The same rule as an aggregation stage, exposed as `effectiveCuisineIds`. */
const EFFECTIVE_CUISINE_STAGE = {
  $addFields: {
    effectiveCuisineIds: {
      $cond: [
        { $gt: [{ $size: { $ifNull: ['$featuredCuisineIds', []] } }, 0] },
        '$featuredCuisineIds',
        { $ifNull: ['$cuisineIds', []] },
      ],
    },
  },
};

function encodeCursor(sortValue: string | number, id: string): string {
  return Buffer.from(`${sortValue}|${id}`, 'utf8').toString('base64url');
}

function decodeCursor(
  cursor?: string,
): { sortValue: string; id: string } | null {
  if (!cursor) return null;
  try {
    const raw = Buffer.from(cursor, 'base64url').toString('utf8');
    const idx = raw.lastIndexOf('|');
    if (idx < 0) return null;
    return { sortValue: raw.slice(0, idx), id: raw.slice(idx + 1) };
  } catch {
    return null;
  }
}

function moneyByCurrencyToObject(
  map?: Map<string, number> | Record<string, number> | null,
): Record<string, number> {
  if (!map) return {};
  if (map instanceof Map) {
    return Object.fromEntries(map.entries());
  }
  return { ...map };
}

function pickMoney(
  moneyByCurrency: Record<string, number>,
  country?: string,
): { amount: number; currency: string } {
  const normalized = normalizeMoneyByCurrency(moneyByCurrency);
  const preferred = currencyFromCountry(country);
  if (normalized[preferred] != null) {
    return { amount: normalized[preferred], currency: preferred };
  }
  if (normalized[DEFAULT_CURRENCY] != null) {
    return { amount: normalized[DEFAULT_CURRENCY], currency: DEFAULT_CURRENCY };
  }
  const entries = Object.entries(normalized);
  if (!entries.length) return { amount: 0, currency: preferred };
  entries.sort((a, b) => b[1] - a[1]);
  return { amount: entries[0][1], currency: entries[0][0] };
}

@Injectable()
export class ChefService {
  constructor(
    @InjectModel(ChefProfile.name)
    private readonly chefProfileModel: Model<ChefProfileDocument>,
    @InjectModel(ChefFavourite.name)
    private readonly favouriteModel: Model<ChefFavouriteDocument>,
    @InjectModel(ChefLeaderboardSnapshot.name)
    private readonly snapshotModel: Model<ChefLeaderboardSnapshotDocument>,
    @InjectModel(Cuisine.name)
    private readonly cuisineModel: Model<CuisineDocument>,
    @InjectModel(Recipe.name)
    private readonly recipeModel: Model<RecipeDocument>,
    private readonly redisService: RedisService,
    private readonly favouriteService: ChefFavouriteService,
    private readonly dataVersion: DataVersionService,
  ) {}

  private toCard(doc: any, isFavourited = false) {
    return {
      id: String(doc._id),
      slug: doc.slug,
      displayName: doc.displayName,
      country: doc.country ?? null,
      avatarImageUrl: doc.avatarImageUrl ?? null,
      heroImageUrl: doc.heroImageUrl ?? doc.avatarImageUrl ?? null,
      quote: doc.quote ?? null,
      isFavourited,
      favouriteCount: doc.favouriteCount ?? 0,
      publishedRecipeCount: doc.publishedRecipeCount ?? 0,
      order: doc.order ?? 0,
    };
  }

  private impactCopy(lifetime: any, country?: string) {
    const moneyByCurrency = normalizeMoneyByCurrency(
      moneyByCurrencyToObject(lifetime?.moneyByCurrency),
    );
    const money = pickMoney(moneyByCurrency, country);
    const meals = lifetime?.mealsCooked ?? 0;
    const foodKg = Number(((lifetime?.foodSavedInGrams ?? 0) / 1000).toFixed(2));
    const co2Kg = Number(((lifetime?.co2SavedInGrams ?? 0) / 1000).toFixed(2));

    return {
      meals: {
        value: meals,
        label: `${meals.toLocaleString()} Meals Cooked`,
        description:
          'Estimated meals cooked using my recipes.',
      },
      money: {
        value: money.amount,
        currency: money.currency,
        label: formatCurrencyLabel(money.currency, money.amount),
        description:
          'Estimated household savings from cooking my recipes.',
        moneyByCurrency,
      },
      food: {
        valueKg: foodKg,
        valueGrams: lifetime?.foodSavedInGrams ?? 0,
        label: `${foodKg.toLocaleString()} kg of food saved`,
        description:
          'Estimated food saved by using ingredients already at home.',
      },
      co2: {
        valueKg: co2Kg,
        valueGrams: lifetime?.co2SavedInGrams ?? 0,
        label: `${co2Kg.toLocaleString()} kg of CO2 avoided`,
        description:
          'Estimated emissions avoided from saving food while cooking my recipes.',
      },
    };
  }

  private async filterPublishedChefCards(chefs: any[] | null | undefined) {
    if (!chefs?.length) return [];
    const ids = chefs
      .map((c) => toObjectId(c?.id))
      .filter((v): v is Types.ObjectId => v !== null);
    if (!ids.length) return [];

    const published = await this.chefProfileModel
      .find({ _id: { $in: ids }, ...PUBLIC_CHEF_FILTER })
      .select({ _id: 1 })
      .lean()
      .exec();
    const ok = new Set(published.map((p) => String(p._id)));
    return chefs.filter((c) => ok.has(String(c?.id)));
  }

  private async filterPublishedAwards(awards: any | null | undefined) {
    const empty = {
      mostMeals: null,
      mostFood: null,
      mostCo2: null,
      risingStar: null,
    };
    if (!awards) return empty;

    const cards = [
      awards.mostMeals,
      awards.mostFood,
      awards.mostCo2,
      awards.risingStar,
    ].filter(Boolean);
    const publishedCards = await this.filterPublishedChefCards(cards);
    const ok = new Set(publishedCards.map((c: any) => String(c.id)));
    const keep = (card: any) =>
      card && ok.has(String(card.id)) ? card : null;

    return {
      mostMeals: keep(awards.mostMeals),
      mostFood: keep(awards.mostFood),
      mostCo2: keep(awards.mostCo2),
      risingStar: keep(awards.risingStar),
    };
  }

  async getHome(userId?: string | null, country?: string) {
    const cacheKey = CHEF_CACHE_KEYS.home(country);
    let payload = await this.redisService.get<any>(cacheKey);

    if (!payload) {
      const [popularSnap, cuisineSnap] = await Promise.all([
        this.getSnapshot(CHEF_SNAPSHOT_KEYS.popularWeek),
        this.getSnapshot(CHEF_SNAPSHOT_KEYS.cuisineRail),
      ]);

      // Snapshots can lag behind publish toggles — always re-check live flags.
      let popularThisWeek = await this.filterPublishedChefCards(
        popularSnap?.chefs as any[],
      );
      if (!popularThisWeek.length) {
        popularThisWeek = await this.fallbackPopularChefs();
      }

      const cuisineRail =
        (cuisineSnap?.cuisines as any[]) || (await this.buildCuisineRail(10));

      payload = {
        cuisineRail,
        popularThisWeek,
      };

      await this.redisService.set(cacheKey, payload, CHEF_HOME_CACHE_TTL);
    } else {
      let popularThisWeek = await this.filterPublishedChefCards(
        payload.popularThisWeek,
      );
      if (!popularThisWeek.length) {
        popularThisWeek = await this.fallbackPopularChefs();
      }
      payload = {
        ...payload,
        popularThisWeek,
      };
    }

    let favouriteChefs: any[] = [];
    let favouriteTotal = 0;
    let hasFavourites = false;

    if (userId) {
      const favPage = await this.getFavourites(userId, undefined, 12);
      favouriteChefs = favPage.items;
      favouriteTotal = favPage.total;
      hasFavourites = favouriteTotal > 0;

      const favIds = await this.favouriteService.getFavouriteIds(userId);
      payload = {
        ...payload,
        popularThisWeek: (payload.popularThisWeek || []).map((c: any) => ({
          ...c,
          isFavourited: favIds.has(String(c.id)),
        })),
      };
    }

    return {
      favouriteChefs,
      favouriteTotal,
      hasFavourites,
      cuisineRail: payload.cuisineRail,
      popularThisWeek: payload.popularThisWeek,
    };
  }

  private async fallbackPopularChefs() {
    const docs = await this.chefProfileModel
      .find(PUBLIC_CHEF_FILTER)
      .sort({ 'lifetime.mealsCooked': -1, order: 1 })
      .limit(10)
      .lean()
      .exec();
    return docs.map((d) => this.toCard(d, false));
  }

  async listChefs(params: {
    cursor?: string;
    limit?: number;
    q?: string;
    cuisineId?: string;
    sort?: 'curated' | 'popular' | 'alphabetical';
    userId?: string | null;
  }) {
    const limit = Math.min(Math.max(params.limit || 24, 1), 48);
    const sort = params.sort || 'curated';
    const q = (params.q || '').trim().toLowerCase();
    const cuisineId = toObjectId(params.cuisineId);

    const queryHash = createHash('sha1')
      .update(
        JSON.stringify({
          cursor: params.cursor || '',
          limit,
          q,
          cuisineId: cuisineId ? String(cuisineId) : '',
          sort,
        }),
      )
      .digest('hex')
      .slice(0, 16);

    const cacheKey = CHEF_CACHE_KEYS.list(queryHash);
    let page = await this.redisService.get<any>(cacheKey);

    if (!page) {
      const filter: any = { ...PUBLIC_CHEF_FILTER };
      if (cuisineId) {
        filter.$and = [
          ...(filter.$and || []),
          effectiveCuisineFilter(cuisineId),
        ];
      }

      if (q) {
        const escaped = q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        // Word-boundary style match so "moran" finds "Matt Moran"
        const nameRegex = `(^|\\s|-)${escaped}`;
        const matchingCuisines = await this.cuisineModel
          .find({
            isActive: true,
            title: { $regex: escaped, $options: 'i' },
          })
          .select({ _id: 1 })
          .lean()
          .exec();
        const cuisineMatchIds = matchingCuisines.map((c) => c._id);
        filter.$or = [
          { displayNameLower: { $regex: nameRegex } },
          ...(cuisineMatchIds.length
            ? [effectiveCuisineFilter({ $in: cuisineMatchIds })]
            : []),
        ];
      }

      // Snapshot the filter before cursor conditions so `total` counts the whole
      // result set, not just the page that is left. The cursor block below
      // reassigns filter.$and rather than mutating it, so this stays intact.
      const totalFilter: any = { ...filter, $and: [...(filter.$and || [])] };
      if (!totalFilter.$and.length) delete totalFilter.$and;

      const decoded = decodeCursor(params.cursor);
      if (decoded && Types.ObjectId.isValid(decoded.id)) {
        const cid = new Types.ObjectId(decoded.id);
        if (sort === 'alphabetical') {
          filter.$and = [
            ...(filter.$and || []),
            {
              $or: [
                { displayNameLower: { $gt: decoded.sortValue } },
                {
                  displayNameLower: decoded.sortValue,
                  _id: { $gt: cid },
                },
              ],
            },
          ];
        } else if (sort === 'popular') {
          const sortNum = Number(decoded.sortValue);
          filter.$and = [
            ...(filter.$and || []),
            {
              $or: [
                { 'lifetime.mealsCooked': { $lt: sortNum } },
                {
                  'lifetime.mealsCooked': sortNum,
                  _id: { $gt: cid },
                },
              ],
            },
          ];
        } else {
          const sortNum = Number(decoded.sortValue);
          filter.$and = [
            ...(filter.$and || []),
            {
              $or: [
                { order: { $gt: sortNum } },
                { order: sortNum, _id: { $gt: cid } },
              ],
            },
          ];
        }
      }

      let sortSpec: any = { order: 1, _id: 1 };
      if (sort === 'popular') sortSpec = { 'lifetime.mealsCooked': -1, _id: 1 };
      if (sort === 'alphabetical') sortSpec = { displayNameLower: 1, _id: 1 };

      const [docs, total] = await Promise.all([
        this.chefProfileModel
          .find(filter)
          .sort(sortSpec)
          .limit(limit + 1)
          .lean()
          .exec(),
        this.chefProfileModel.countDocuments(totalFilter),
      ]);

      const hasMore = docs.length > limit;
      const slice = hasMore ? docs.slice(0, limit) : docs;
      const items = slice.map((d) => this.toCard(d, false));
      let nextCursor: string | null = null;
      if (hasMore && slice.length) {
        const last = slice[slice.length - 1] as any;
        const sortValue =
          sort === 'alphabetical'
            ? last.displayNameLower
            : sort === 'popular'
              ? last.lifetime?.mealsCooked ?? 0
              : last.order ?? 0;
        nextCursor = encodeCursor(sortValue, String(last._id));
      }

      page = { items, nextCursor, hasMore, total };
      await this.redisService.set(cacheKey, page, CHEF_CACHE_TTL);
    }

    if (params.userId) {
      const favIds = await this.favouriteService.getFavouriteIds(params.userId);
      page = {
        ...page,
        items: page.items.map((c: any) => ({
          ...c,
          isFavourited: favIds.has(String(c.id)),
        })),
      };
    }

    return page;
  }

  async getFavourites(userId: string, cursor?: string, limit = 24) {
    const uid = toObjectId(userId);
    if (!uid) throw new BadRequestException('Invalid user');

    const take = Math.min(Math.max(limit, 1), 48);
    const decoded = decodeCursor(cursor);

    const filter: any = { userId: uid };
    if (decoded && Types.ObjectId.isValid(decoded.id)) {
      // cursor encodes createdAt ISO | favourite _id
      const createdAt = new Date(decoded.sortValue);
      if (!Number.isNaN(createdAt.getTime())) {
        filter.$or = [
          { createdAt: { $lt: createdAt } },
          {
            createdAt,
            _id: { $lt: new Types.ObjectId(decoded.id) },
          },
        ];
      }
    }

    const [rows, total] = await Promise.all([
      this.favouriteModel
        .find(filter)
        .sort({ createdAt: -1, _id: -1 })
        .limit(take + 1)
        .lean()
        .exec(),
      this.favouriteModel.countDocuments({ userId: uid }),
    ]);

    const hasMore = rows.length > take;
    const slice = hasMore ? rows.slice(0, take) : rows;
    const chefIds = slice.map((r) => r.chefId);

    const chefs = await this.chefProfileModel
      .find({ _id: { $in: chefIds }, ...PUBLIC_CHEF_FILTER })
      .lean()
      .exec();
    const byId = new Map(chefs.map((c) => [String(c._id), c]));

    const items = slice
      .map((r) => {
        const chef = byId.get(String(r.chefId));
        if (!chef) return null;
        return this.toCard(chef, true);
      })
      .filter(Boolean);

    let nextCursor: string | null = null;
    if (hasMore && slice.length) {
      const last = slice[slice.length - 1];
      nextCursor = encodeCursor(
        new Date(last.createdAt).toISOString(),
        String(last._id),
      );
    }

    return { items, nextCursor, hasMore, total };
  }

  async getFavouriteRecipes(
    userId: string,
    cursor?: string,
    limit = 24,
    country?: string,
  ) {
    const uid = toObjectId(userId);
    if (!uid) throw new BadRequestException('Invalid user');

    const favs = await this.favouriteModel
      .find({ userId: uid })
      .select({ chefId: 1 })
      .lean()
      .exec();

    if (!favs.length) {
      return { items: [], nextCursor: null, hasMore: false };
    }

    const profiles = await this.chefProfileModel
      .find({
        _id: { $in: favs.map((f) => f.chefId) },
        ...PUBLIC_CHEF_FILTER,
      })
      .select({ userId: 1, displayName: 1, avatarImageUrl: 1, heroImageUrl: 1 })
      .lean()
      .exec();

    const userIds = profiles.map((p) => p.userId);
    const chefNameByUserId = new Map(
      profiles.map((p) => [String(p.userId), p.displayName]),
    );
    const chefAvatarByUserId = new Map(
      profiles.map((p) => [
        String(p.userId),
        p.avatarImageUrl ?? p.heroImageUrl ?? null,
      ]),
    );

    return this.listRecipesForChefUsers(userIds, {
      cursor,
      limit,
      country,
      chefNameByUserId,
      chefAvatarByUserId,
    });
  }

  async getProfile(slugOrId: string, userId?: string | null, country?: string) {
    const cacheKey = CHEF_CACHE_KEYS.profile(slugOrId.toLowerCase());
    let profile = await this.redisService.get<any>(cacheKey);

    if (!profile) {
      const filter: any = { ...PUBLIC_CHEF_FILTER };
      if (Types.ObjectId.isValid(slugOrId)) {
        filter.$or = [
          { _id: new Types.ObjectId(slugOrId) },
          { slug: slugOrId.toLowerCase() },
        ];
      } else {
        filter.slug = slugOrId.toLowerCase();
      }

      const doc = await this.chefProfileModel.findOne(filter).lean().exec();
      if (!doc) throw new NotFoundException('Chef not found');

      // "My Cuisine Inspiration" is the chef's own pick when they made one,
      // otherwise what their recipes cover. Anything their recipes cover beyond
      // that pick is shown separately as "also cooks" so the profile accounts
      // for every cuisine they actually make.
      const featuredIds = doc.featuredCuisineIds ?? [];
      const derivedIds = doc.cuisineIds ?? [];
      const cuisineSourceIds = featuredIds.length > 0 ? featuredIds : derivedIds;
      const featuredKeys = new Set(cuisineSourceIds.map(String));
      const alsoCookedIds = derivedIds.filter(
        (id) => !featuredKeys.has(String(id)),
      );

      const allIds = [...cuisineSourceIds, ...alsoCookedIds];
      const cuisineDocs = allIds.length
        ? await this.cuisineModel
            .find({ _id: { $in: allIds }, isActive: true })
            .select({ title: 1, imageUrl: 1, order: 1 })
            .sort({ order: 1, title: 1 })
            .lean()
            .exec()
        : [];

      const cuisines = cuisineDocs.filter((c) =>
        featuredKeys.has(String(c._id)),
      );
      const alsoCooked = cuisineDocs.filter(
        (c) => !featuredKeys.has(String(c._id)),
      );

      profile = {
        id: String(doc._id),
        userId: String(doc.userId),
        slug: doc.slug,
        displayName: doc.displayName,
        country: doc.country ?? null,
        avatarImageUrl: doc.avatarImageUrl ?? null,
        heroImageUrl: doc.heroImageUrl ?? doc.avatarImageUrl ?? null,
        quote: doc.quote ?? null,
        bio: doc.bio ?? null,
        socialLinks: doc.socialLinks ?? {},
        cuisines: cuisines.map((c) => ({
          id: String(c._id),
          title: c.title,
          imageUrl: c.imageUrl ?? null,
        })),
        alsoCooks: alsoCooked.map((c) => ({
          id: String(c._id),
          title: c.title,
          imageUrl: c.imageUrl ?? null,
        })),
        publishedRecipeCount: doc.publishedRecipeCount ?? 0,
        lifetime: {
          mealsCooked: doc.lifetime?.mealsCooked ?? 0,
          moneySaved: doc.lifetime?.moneySaved ?? 0,
          moneyByCurrency: moneyByCurrencyToObject(
            doc.lifetime?.moneyByCurrency,
          ),
          foodSavedInGrams: doc.lifetime?.foodSavedInGrams ?? 0,
          co2SavedInGrams: doc.lifetime?.co2SavedInGrams ?? 0,
        },
        favouriteCount: doc.favouriteCount ?? 0,
      };

      await this.redisService.set(cacheKey, profile, CHEF_CACHE_TTL);
      await this.redisService.set(
        CHEF_CACHE_KEYS.profile(profile.id),
        profile,
        CHEF_CACHE_TTL,
      );
    }

    const [isFavourited, favouriteCount] = await Promise.all([
      this.favouriteService.isFavourited(userId, profile.id),
      this.favouriteService.getFavouriteCount(profile.id),
    ]);

    const { lifetime, ...rest } = profile;
    return {
      ...rest,
      isFavourited,
      favouriteCount,
      impact: this.impactCopy(lifetime, country),
    };
  }

  async getChefRecipes(
    chefId: string,
    cursor?: string,
    limit = 24,
    country?: string,
  ) {
    const cid = toObjectId(chefId);
    if (!cid) throw new BadRequestException('Invalid chef id');

    const profile = await this.chefProfileModel
      .findOne({ _id: cid, ...PUBLIC_CHEF_FILTER })
      .select({ userId: 1, displayName: 1, avatarImageUrl: 1, heroImageUrl: 1 })
      .lean()
      .exec();
    if (!profile) throw new NotFoundException('Chef not found');

    const avatar =
      profile.avatarImageUrl ?? profile.heroImageUrl ?? null;

    return this.listRecipesForChefUsers([profile.userId], {
      cursor,
      limit,
      country,
      chefNameByUserId: new Map([[String(profile.userId), profile.displayName]]),
      chefAvatarByUserId: new Map([[String(profile.userId), avatar]]),
    });
  }

  private async listRecipesForChefUsers(
    userIds: Types.ObjectId[],
    opts: {
      cursor?: string;
      limit?: number;
      country?: string;
      chefNameByUserId?: Map<string, string>;
      chefAvatarByUserId?: Map<string, string | null>;
    },
  ) {
    const take = Math.min(Math.max(opts.limit || 24, 1), 48);
    // Recipes store canonical country names, and every /recipe endpoint
    // normalizes before matching — do the same here so a stored "AU" or
    // "australia" does not silently return an empty list.
    const country = normalizeCountry(opts.country) || '';
    const chefsHash = createHash('sha1')
      .update(userIds.map(String).sort().join(','))
      .digest('hex')
      .slice(0, 16);
    const cacheKey = CHEF_CACHE_KEYS.recipes(
      chefsHash,
      country || 'all',
      opts.cursor || 'start',
    );

    const cached = await this.redisService.get<any>(cacheKey);
    if (cached) return cached;

    const filter: any = {
      isActive: true,
      chefIds: { $in: userIds },
    };
    if (country) {
      filter.$or = [
        { countries: { $size: 0 } },
        { countries: country },
        { countries: { $exists: false } },
      ];
    }

    const decoded = decodeCursor(opts.cursor);
    if (decoded && Types.ObjectId.isValid(decoded.id)) {
      const order = Number(decoded.sortValue);
      const rid = new Types.ObjectId(decoded.id);
      filter.$and = [
        ...(filter.$and || []),
        {
          $or: [
            { order: { $gt: order } },
            { order, _id: { $gt: rid } },
          ],
        },
      ];
    }

    const docs = await this.recipeModel
      .find(filter)
      .select({
        title: 1,
        heroImageUrl: 1,
        order: 1,
        frameworkCategories: 1,
        cuisines: 1,
        stickerId: 1,
        cookCount: 1,
        chefIds: 1,
        prepCookTime: 1,
        portions: 1,
        shortDescription: 1,
        components: 1,
      })
      .populate('stickerId', 'imageUrl title')
      .sort({ order: 1, _id: 1 })
      .limit(take + 1)
      .lean()
      .exec();

    const hasMore = docs.length > take;
    const slice = hasMore ? docs.slice(0, take) : docs;

    const items = slice.map((r: any) => {
      const firstChefUserId = r.chefIds?.[0] ? String(r.chefIds[0]) : null;
      const slug = String(r.title || '')
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9\s-]/g, '')
        .replace(/\s+/g, '-');
      const variantTags = Array.from(
        new Set(
          (r.components || []).flatMap((w: any) =>
            Array.isArray(w?.variantTags) ? w.variantTags : [],
          ),
        ),
      );
      return {
        _id: String(r._id),
        id: String(r._id),
        title: r.title,
        slug,
        heroImageUrl: r.heroImageUrl ?? null,
        order: r.order ?? 0,
        frameworkCategoryIds: (r.frameworkCategories || []).map(String),
        cuisineIds: (r.cuisines || []).map(String),
        prepCookTime: r.prepCookTime ?? null,
        portions: r.portions ?? null,
        shortDescription: r.shortDescription ?? null,
        variantTags,
        sticker: r.stickerId
          ? {
              id: String(r.stickerId._id || r.stickerId),
              imageUrl: r.stickerId.imageUrl,
              title: r.stickerId.title,
            }
          : undefined,
        chefName: firstChefUserId
          ? opts.chefNameByUserId?.get(firstChefUserId) ?? null
          : null,
        chefAvatarImageUrl: firstChefUserId
          ? opts.chefAvatarByUserId?.get(firstChefUserId) ?? null
          : null,
        cookCount: r.cookCount ?? 0,
      };
    });

    let nextCursor: string | null = null;
    if (hasMore && slice.length) {
      const last: any = slice[slice.length - 1];
      nextCursor = encodeCursor(last.order ?? 0, String(last._id));
    }

    const page = { items, nextCursor, hasMore };
    await this.redisService.set(cacheKey, page, CHEF_CACHE_TTL);
    return page;
  }

  async getCommunityImpact(period: 'month' | 'year' | 'all' = 'month') {
    const [community, awards] = await Promise.all([
      this.getSnapshot(CHEF_SNAPSHOT_KEYS.community(period)),
      this.getSnapshot(CHEF_SNAPSHOT_KEYS.awards(period)),
    ]);

    return {
      period,
      community: community || {
        mealsCooked: 0,
        moneySaved: 0,
        moneyByCurrency: {},
        foodSavedInGrams: 0,
        co2SavedInGrams: 0,
      },
      awards: await this.filterPublishedAwards(awards),
    };
  }

  async getCuisines() {
    // Full library: all active cuisines, including those with zero published chefs
    const [cuisines, counts] = await Promise.all([
      this.cuisineModel
        .find({ isActive: true })
        .sort({ order: 1, title: 1 })
        .lean()
        .exec(),
      this.chefProfileModel.aggregate([
        { $match: { ...PUBLIC_CHEF_FILTER } },
        EFFECTIVE_CUISINE_STAGE,
        { $match: { effectiveCuisineIds: { $ne: [] } } },
        { $unwind: '$effectiveCuisineIds' },
        {
          $group: {
            _id: '$effectiveCuisineIds',
            chefCount: { $sum: 1 },
          },
        },
      ]),
    ]);

    const countById = new Map(
      counts.map((r) => [String(r._id), r.chefCount as number]),
    );

    return {
      cuisines: cuisines.map((c) => ({
        id: String(c._id),
        title: c.title,
        description: c.description ?? null,
        imageUrl: c.imageUrl ?? null,
        chefCount: countById.get(String(c._id)) || 0,
      })),
    };
  }

  async getCuisineDetail(cuisineId: string) {
    const cid = toObjectId(cuisineId);
    if (!cid) throw new NotFoundException('Cuisine not found');

    const cuisine = await this.cuisineModel.findById(cid).lean().exec();
    if (!cuisine || cuisine.isActive === false) {
      throw new NotFoundException('Cuisine not found');
    }

    const chefCount = await this.chefProfileModel.countDocuments({
      ...PUBLIC_CHEF_FILTER,
      ...effectiveCuisineFilter(cid),
    });

    return {
      id: String(cuisine._id),
      title: cuisine.title,
      description: cuisine.description ?? null,
      imageUrl: cuisine.imageUrl ?? null,
      chefCount,
    };
  }

  async buildCuisineRail(limit = 10) {
    const rows = await this.chefProfileModel.aggregate([
      { $match: { ...PUBLIC_CHEF_FILTER } },
      EFFECTIVE_CUISINE_STAGE,
      { $match: { effectiveCuisineIds: { $ne: [] } } },
      { $unwind: '$effectiveCuisineIds' },
      {
        $group: {
          _id: '$effectiveCuisineIds',
          chefCount: { $sum: 1 },
        },
      },
      { $sort: { chefCount: -1 } },
      { $limit: limit },
    ]);

    if (!rows.length) return [];

    const cuisines = await this.cuisineModel
      .find({
        _id: { $in: rows.map((r) => r._id) },
        isActive: true,
      })
      .lean()
      .exec();
    const byId = new Map(cuisines.map((c) => [String(c._id), c]));

    return rows
      .map((r) => {
        const c = byId.get(String(r._id));
        if (!c) return null;
        return {
          id: String(c._id),
          title: c.title,
          description: c.description ?? null,
          imageUrl: c.imageUrl ?? null,
          chefCount: r.chefCount,
        };
      })
      .filter(Boolean);
  }

  private async getSnapshot(key: string): Promise<any | null> {
    const cacheKey = `chefs:snapshot:${key}`;
    const cached = await this.redisService.get<any>(cacheKey);
    if (cached) return cached;

    const doc = await this.snapshotModel.findOne({ key }).lean().exec();
    if (!doc) return null;
    await this.redisService.set(cacheKey, doc.payload, CHEF_HOME_CACHE_TTL);
    return doc.payload;
  }

  async invalidateCaches(): Promise<void> {
    await this.redisService.delByPattern(CHEF_CACHE_KEYS.patternAll);
    await this.redisService.delByPattern('chefs:snapshot:*');
    await this.redisService.del('chefs:published-user-ids:v1');
  }

  /**
   * When a chef is published/unpublished, Make must drop their recipes too.
   * Mirrors RecipeService.invalidateRecipeCaches without a circular import.
   */
  async invalidateRecipeVisibilityCaches(): Promise<void> {
    try {
      await this.redisService.incr('cache:gen:recipes');
      await this.redisService.delByPattern('recipes:*');
      await this.redisService.delByPattern('dietary:*');
    } catch (error: any) {
      // non-fatal — version bump still forces clients to refetch
    }
    await this.dataVersion.bump('recipes');
    await this.dataVersion.bump('chefs');
  }
}
