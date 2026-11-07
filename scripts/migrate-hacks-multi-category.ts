/**
 * Kitchen Tips can now sit in several categories. Copies each tip's
 * existing categoryId into the new categoryIds list where it is missing.
 * The API already falls back to categoryId, so this only tidies the data.
 *
 * Dry run by default; pass --apply to write. Safe to run more than once.
 *
 *   npm run migrate:hacks-multi-category
 *   npm run migrate:hacks-multi-category -- --apply
 */
import * as dotenv from 'dotenv';
import * as path from 'path';
import * as mongoose from 'mongoose';

dotenv.config({ path: path.resolve(__dirname, '../.env') });

async function main() {
  const apply = process.argv.includes('--apply');
  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error('MONGODB_URI is not set');
  await mongoose.connect(uri, { dbName: process.env.MONGODB_DBNAME || 'saveful' });

  const hacks = mongoose.connection.collection('hacks');
  const filter = {
    categoryId: { $exists: true, $ne: null },
    $or: [{ categoryIds: { $exists: false } }, { categoryIds: { $size: 0 } }],
  };
  const count = await hacks.countDocuments(filter);
  if (!apply) {
    console.log(`Dry run: ${count} tip(s) would get categoryIds = [categoryId]. Pass --apply to write.`);
  } else {
    const result = await hacks.updateMany(filter, [{ $set: { categoryIds: ['$categoryId'] } }]);
    console.log(`Updated ${result.modifiedCount} tip(s).`);
  }
  await mongoose.disconnect();
}

main().catch(async error => {
  console.error(error);
  await mongoose.disconnect().catch(() => undefined);
  process.exit(1);
});
