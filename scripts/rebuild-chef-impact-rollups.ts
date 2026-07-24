import * as dotenv from 'dotenv';
import * as path from 'path';
import * as mongoose from 'mongoose';
import {
  FoodSavedEventLog,
  FoodSavedEventLogSchema,
} from '../src/database/schemas/food-saved-event-log.schema';
import {
  ChefProfile,
  ChefProfileSchema,
} from '../src/database/schemas/chef-profile.schema';
import {
  ChefImpactDaily,
  ChefImpactDailySchema,
} from '../src/database/schemas/chef-impact-daily.schema';
import {
  ChefCommunityDaily,
  ChefCommunityDailySchema,
} from '../src/database/schemas/chef-community-daily.schema';
import { Recipe, RecipeSchema } from '../src/database/schemas/recipe.schema';

dotenv.config({ path: path.resolve(__dirname, '../.env') });

const COUNTRY_CURRENCY: Record<string, string> = {
  AU: 'AUD',
  Australia: 'AUD',
  IN: 'INR',
  India: 'INR',
  US: 'USD',
  USA: 'USD',
  GB: 'GBP',
  UK: 'GBP',
  NZ: 'NZD',
  CA: 'CAD',
};

function currencyFromCountry(country?: string | null): string {
  if (!country) return 'UNKNOWN';
  return COUNTRY_CURRENCY[country] || country.toUpperCase();
}

function utcDayStart(date: Date): Date {
  return new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()),
  );
}

type Acc = {
  mealsCooked: number;
  moneySaved: number;
  foodSavedInGrams: number;
  co2SavedInGrams: number;
  moneyByCurrency: Record<string, number>;
};

function bump(map: Map<string, Acc>, key: string, delta: Acc) {
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
}

async function main() {
  const uri = process.env.MONGODB_URI;
  const dbName = process.env.MONGODB_DBNAME || 'saveful';
  if (!uri) throw new Error('MONGODB_URI is not set in .env');

  await mongoose.connect(uri, { dbName });
  console.log('Connected to MongoDB');

  const FoodSavedModel = mongoose.model(
    FoodSavedEventLog.name,
    FoodSavedEventLogSchema,
  );
  const ChefProfileModel = mongoose.model(ChefProfile.name, ChefProfileSchema);
  const ImpactDailyModel = mongoose.model(
    ChefImpactDaily.name,
    ChefImpactDailySchema,
  );
  const CommunityDailyModel = mongoose.model(
    ChefCommunityDaily.name,
    ChefCommunityDailySchema,
  );
  const RecipeModel = mongoose.model(Recipe.name, RecipeSchema);

  const profiles = await ChefProfileModel.find({})
    .select({ _id: 1, userId: 1 })
    .lean();
  const profileByUserId = new Map(
    profiles.map((p) => [String(p.userId), String(p._id)]),
  );

  // Sync derived cuisine/recipe fields
  for (const p of profiles) {
    const rows = await RecipeModel.aggregate([
      { $match: { isActive: true, chefIds: p.userId } },
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
    const stats = rows[0] || {
      publishedRecipeCount: 0,
      cuisineIds: [],
      firstPublishedAt: null,
    };
    await ChefProfileModel.updateOne(
      { _id: p._id },
      {
        $set: {
          publishedRecipeCount: stats.publishedRecipeCount,
          cuisineIds: stats.cuisineIds || [],
          firstPublishedAt: stats.firstPublishedAt,
        },
      },
    );
  }

  const chefDay = new Map<string, Acc>();
  const communityDay = new Map<string, Acc>();

  const oldest = await FoodSavedModel.findOne({})
    .sort({ createdAt: 1 })
    .select({ createdAt: 1 })
    .lean();
  if (!oldest?.createdAt) {
    console.log('No food saved events — nothing to rebuild');
    await mongoose.disconnect();
    return;
  }

  let cursorDate = new Date(oldest.createdAt);
  cursorDate = new Date(
    Date.UTC(cursorDate.getUTCFullYear(), cursorDate.getUTCMonth(), 1),
  );
  const now = new Date();

  while (cursorDate <= now) {
    const monthStart = new Date(cursorDate);
    const monthEnd = new Date(
      Date.UTC(monthStart.getUTCFullYear(), monthStart.getUTCMonth() + 1, 1),
    );
    console.log(`Processing ${monthStart.toISOString()} .. ${monthEnd.toISOString()}`);

    const events = await FoodSavedModel.find({
      createdAt: { $gte: monthStart, $lt: monthEnd },
      chefIds: { $exists: true, $ne: [] },
    })
      .select({
        chefIds: 1,
        foodSavedInGrams: 1,
        moneySaved: 1,
        co2SavedInGrams: 1,
        currency: 1,
        country: 1,
        createdAt: 1,
      })
      .lean();

    for (const e of events) {
      const day = utcDayStart(new Date(e.createdAt));
      const dayKey = day.toISOString();
      const currency = e.currency || currencyFromCountry(e.country);
      const delta: Acc = {
        mealsCooked: 1,
        moneySaved: e.moneySaved || 0,
        foodSavedInGrams: e.foodSavedInGrams || 0,
        co2SavedInGrams: e.co2SavedInGrams || 0,
        moneyByCurrency: { [currency]: e.moneySaved || 0 },
      };
      const profileIds = (e.chefIds || [])
        .map((id) => profileByUserId.get(String(id)))
        .filter((id): id is string => !!id);
      if (!profileIds.length) continue;
      for (const pid of profileIds) bump(chefDay, `${pid}|${dayKey}`, delta);
      bump(communityDay, dayKey, delta);
    }

    cursorDate = monthEnd;
  }

  await ImpactDailyModel.deleteMany({});
  await CommunityDailyModel.deleteMany({});

  const impactOps = [...chefDay.entries()].map(([key, acc]) => {
    const [chefId, dayIso] = key.split('|');
    return {
      updateOne: {
        filter: {
          chefId: new mongoose.Types.ObjectId(chefId),
          day: new Date(dayIso),
        },
        update: {
          $set: {
            chefId: new mongoose.Types.ObjectId(chefId),
            day: new Date(dayIso),
            ...acc,
          },
        },
        upsert: true,
      },
    };
  });

  for (let i = 0; i < impactOps.length; i += 1000) {
    await ImpactDailyModel.bulkWrite(impactOps.slice(i, i + 1000) as any, {
      ordered: false,
    });
  }

  const communityOps = [...communityDay.entries()].map(([dayIso, acc]) => ({
    updateOne: {
      filter: { day: new Date(dayIso) },
      update: { $set: { day: new Date(dayIso), ...acc } },
      upsert: true,
    },
  }));
  if (communityOps.length) {
    await CommunityDailyModel.bulkWrite(communityOps as any, {
      ordered: false,
    });
  }

  // Lifetime from daily
  const lifetimes = await ImpactDailyModel.aggregate([
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

  for (const row of lifetimes) {
    const moneyByCurrency: Record<string, number> = {};
    for (const doc of row.moneyByCurrencyDocs || []) {
      const obj =
        doc instanceof Map
          ? Object.fromEntries(doc.entries())
          : { ...(doc || {}) };
      for (const [k, v] of Object.entries(obj)) {
        moneyByCurrency[k] = (moneyByCurrency[k] || 0) + (Number(v) || 0);
      }
    }
    await ChefProfileModel.updateOne(
      { _id: row._id },
      {
        $set: {
          'lifetime.mealsCooked': row.mealsCooked,
          'lifetime.moneySaved': row.moneySaved,
          'lifetime.foodSavedInGrams': row.foodSavedInGrams,
          'lifetime.co2SavedInGrams': row.co2SavedInGrams,
          'lifetime.moneyByCurrency': moneyByCurrency,
        },
      },
    );
  }

  console.log(
    `Rebuild complete. chefDays=${chefDay.size} communityDays=${communityDay.size} lifetimes=${lifetimes.length}`,
  );
  await mongoose.disconnect();
}

main().catch(async (err) => {
  console.error(err);
  await mongoose.disconnect();
  process.exit(1);
});
