import * as dotenv from 'dotenv';
import * as path from 'path';
import * as mongoose from 'mongoose';
import {
  UserFoodAnalyticalProfileSchema,
  UserFoodAnalyticsProfile,
} from '../src/database/schemas/user.food.analyticsProfile.schema';
import { normalizeObjectIdArray } from '../src/modules/analytics/utils/object-id-array.util';

dotenv.config({ path: path.resolve(__dirname, '../.env') });

async function backfillCookedRecipesObjectIds() {
  const uri = process.env.MONGODB_URI;
  const dbName = process.env.MONGODB_DBNAME || 'saveful';

  if (!uri) {
    throw new Error('MONGODB_URI is not set in .env');
  }

  await mongoose.connect(uri, { dbName });
  console.log('Connected to MongoDB');

  const ProfileModel = mongoose.model(
    UserFoodAnalyticsProfile.name,
    UserFoodAnalyticalProfileSchema,
  );
  const collection = mongoose.connection.collection(
    ProfileModel.collection.collectionName,
  );

  let scanned = 0;
  let updated = 0;

  const cursor = collection.find(
    {},
    { projection: { cookedRecipes: 1 } },
  );

  for await (const profile of cursor) {
    scanned += 1;
    const normalizedCookedRecipes = normalizeObjectIdArray(
      profile?.cookedRecipes,
    );

    if (!normalizedCookedRecipes.changed) {
      continue;
    }

    await collection.updateOne(
      { _id: profile._id },
      { $set: { cookedRecipes: normalizedCookedRecipes.objectIds } },
    );
    updated += 1;
  }

  console.log(
    `Cooked recipes backfill complete. Scanned=${scanned}, Updated=${updated}`,
  );
}

backfillCookedRecipesObjectIds()
  .then(async () => {
    await mongoose.disconnect();
    console.log('Disconnected from MongoDB');
  })
  .catch(async (error) => {
    console.error('Cooked recipes backfill failed:', error);
    await mongoose.disconnect();
    process.exit(1);
  });