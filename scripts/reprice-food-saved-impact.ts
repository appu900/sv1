/**
 * Reprice FoodSavedEventLog money/CO₂ using platform formulas, then rebuild
 * chef impact rollups and user analytics money/CO₂ totals.
 *
 * Formulas:
 *   moneySaved = foodSavedInGrams × survey costPerGram (else fallback $/kg)
 *   co2SavedInGrams = foodSavedInGrams × 2.1
 *
 * Usage (from sv1/):
 *   npm run reprice:food-saved-impact
 *
 * Requires MONGODB_URI (and optional MONGODB_DBNAME) in .env
 */
import * as dotenv from 'dotenv';
import * as path from 'path';
import * as mongoose from 'mongoose';
import { spawnSync } from 'child_process';
import {
  FoodSavedEventLog,
  FoodSavedEventLogSchema,
} from '../src/database/schemas/food-saved-event-log.schema';
import {
  UserFoodAnalyticsProfile,
  UserFoodAnalyticalProfileSchema,
} from '../src/database/schemas/user.food.analyticsProfile.schema';
import {
  SurveyConfig,
  SurveyConfigSchema,
} from '../src/database/schemas/survey-config.schema';
import {
  moneySavedFromFoodGrams,
  co2SavedInGramsFromFood,
} from '../src/modules/analytics/utils/impact-pricing.util';
import { currencyFromCountry } from '../src/modules/chef/chef.constants';

dotenv.config({ path: path.resolve(__dirname, '../.env') });

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
  const ProfileModel = mongoose.model(
    UserFoodAnalyticsProfile.name,
    UserFoodAnalyticalProfileSchema,
  );
  const SurveyConfigModel = mongoose.model(SurveyConfig.name, SurveyConfigSchema);

  const activeConfig = await SurveyConfigModel.findOne({ isActive: true })
    .select({ countryRates: 1 })
    .lean();
  const countryRates = activeConfig?.countryRates ?? null;
  console.log(
    countryRates
      ? `Using survey countryRates (${countryRates.length} rows)`
      : 'No active survey config — using default costPerGram / fallback $/kg',
  );

  const cursor = FoodSavedModel.find({})
    .select({
      _id: 1,
      foodSavedInGrams: 1,
      moneySaved: 1,
      co2SavedInGrams: 1,
      country: 1,
      currency: 1,
    })
    .lean()
    .cursor();

  let scanned = 0;
  let updated = 0;
  let moneyDelta = 0;
  const bulk: any[] = [];

  for await (const doc of cursor) {
    scanned += 1;
    const food = Math.max(0, Math.floor(Number(doc.foodSavedInGrams) || 0));
    const country = doc.country || 'Australia';
    const nextMoney = moneySavedFromFoodGrams(food, country, countryRates);
    const nextCo2 = Math.max(0, Math.floor(co2SavedInGramsFromFood(food)));
    const nextCurrency = currencyFromCountry(country);

    const prevMoney = Number(doc.moneySaved) || 0;
    const prevCo2 = Number(doc.co2SavedInGrams) || 0;
    const moneyChanged = Math.abs(prevMoney - nextMoney) > 0.001;
    const co2Changed = prevCo2 !== nextCo2;
    const currencyChanged = (doc.currency || '') !== nextCurrency;

    if (!moneyChanged && !co2Changed && !currencyChanged) continue;

    moneyDelta += nextMoney - prevMoney;
    updated += 1;
    bulk.push({
      updateOne: {
        filter: { _id: doc._id },
        update: {
          $set: {
            moneySaved: nextMoney,
            co2SavedInGrams: nextCo2,
            currency: nextCurrency,
          },
        },
      },
    });

    if (bulk.length >= 500) {
      await FoodSavedModel.bulkWrite(bulk, { ordered: false });
      bulk.length = 0;
      console.log(`…updated ${updated}/${scanned} events`);
    }
  }

  if (bulk.length) {
    await FoodSavedModel.bulkWrite(bulk, { ordered: false });
  }

  console.log(
    `Event reprice done. scanned=${scanned} updated=${updated} moneyDelta=${moneyDelta.toFixed(2)}`,
  );

  // Rebuild user analytics money/CO₂/food/meals from events
  const byUser = await FoodSavedModel.aggregate([
    {
      $group: {
        _id: '$userId',
        foodSavedInGrams: { $sum: { $ifNull: ['$foodSavedInGrams', 0] } },
        totalMoneySaved: { $sum: { $ifNull: ['$moneySaved', 0] } },
        totalCo2SavedInGrams: { $sum: { $ifNull: ['$co2SavedInGrams', 0] } },
        numberOfMealsCooked: { $sum: 1 },
      },
    },
  ]);

  let profilesUpdated = 0;
  for (let i = 0; i < byUser.length; i += 200) {
    const chunk = byUser.slice(i, i + 200);
    const ops = chunk
      .filter((row) => row._id)
      .map((row) => ({
        updateOne: {
          filter: { userId: row._id },
          update: {
            $set: {
              foodSavedInGrams: Math.max(0, Math.floor(row.foodSavedInGrams || 0)),
              totalMoneySaved: Math.max(0, Number(row.totalMoneySaved) || 0),
              totalCo2SavedInGrams: Math.max(
                0,
                Math.floor(row.totalCo2SavedInGrams || 0),
              ),
              numberOfMealsCooked: Math.max(0, Math.floor(row.numberOfMealsCooked || 0)),
            },
          },
          upsert: false,
        },
      }));
    if (ops.length) {
      const result = await ProfileModel.bulkWrite(ops as any, { ordered: false });
      profilesUpdated += result.modifiedCount + result.matchedCount;
    }
  }
  console.log(`User analytics profiles synced from events (${byUser.length} users with events)`);

  await mongoose.disconnect();

  // Rebuild chef daily/lifetime rollups from the corrected events
  console.log('Running rebuild:chef-impact-rollups…');
  const rebuild = spawnSync(
    'npx',
    ['ts-node', '-r', 'tsconfig-paths/register', 'scripts/rebuild-chef-impact-rollups.ts'],
    {
      cwd: path.resolve(__dirname, '..'),
      stdio: 'inherit',
      env: process.env,
    },
  );
  if (rebuild.status !== 0) {
    throw new Error(`rebuild-chef-impact-rollups failed with status ${rebuild.status}`);
  }

  console.log('reprice-food-saved-impact complete.');
  void profilesUpdated;
}

main().catch(async (err) => {
  console.error(err);
  try {
    await mongoose.disconnect();
  } catch {
    /* ignore */
  }
  process.exit(1);
});
