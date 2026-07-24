import * as dotenv from 'dotenv';
import * as path from 'path';
import * as mongoose from 'mongoose';
import {
  FoodSavedEventLog,
  FoodSavedEventLogSchema,
} from '../src/database/schemas/food-saved-event-log.schema';
import { Recipe, RecipeSchema } from '../src/database/schemas/recipe.schema';

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
  const RecipeModel = mongoose.model(Recipe.name, RecipeSchema);

  const recipes = await RecipeModel.find({})
    .select({ _id: 1, chefIds: 1 })
    .lean();
  const chefMap = new Map<string, mongoose.Types.ObjectId[]>(
    recipes.map((r) => [
      String(r._id),
      (r.chefIds || []) as mongoose.Types.ObjectId[],
    ]),
  );
  console.log(`Loaded ${chefMap.size} recipes into memory`);

  const cursor = FoodSavedModel.find({
    $or: [
      { chefIds: { $exists: false } },
      { chefIds: null },
      { chefIds: { $size: 0 } },
    ],
    frameworkId: { $ne: null },
  })
    .select({ _id: 1, frameworkId: 1 })
    .cursor();

  let scanned = 0;
  let updated = 0;
  let batch: any[] = [];

  const flush = async () => {
    if (!batch.length) return;
    await FoodSavedModel.bulkWrite(batch, { ordered: false });
    updated += batch.length;
    batch = [];
  };

  for await (const doc of cursor) {
    scanned += 1;
    const chefIds = chefMap.get(String(doc.frameworkId)) || [];
    batch.push({
      updateOne: {
        filter: { _id: doc._id },
        update: { $set: { chefIds } },
      },
    });
    if (batch.length >= 1000) await flush();
  }
  await flush();

  console.log(
    `FoodSavedEventLog chefIds backfill complete. scanned=${scanned} updated=${updated}`,
  );
  await mongoose.disconnect();
}

main().catch(async (err) => {
  console.error(err);
  await mongoose.disconnect();
  process.exit(1);
});
