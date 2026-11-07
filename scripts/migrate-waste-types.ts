/**
 * Rewrites stored bin categories on discarded inventory items to the
 * redesign's bins: wet_waste → food_organics, dry_waste → recycling,
 * hazardous → general_waste. The API already reads both, so this only
 * tidies the data (and the admin analytics that read it directly).
 *
 * Dry run by default; pass --apply to write. Safe to run more than once.
 *
 *   npm run migrate:waste-types            # counts only
 *   npm run migrate:waste-types -- --apply
 */
import * as dotenv from 'dotenv';
import * as path from 'path';
import * as mongoose from 'mongoose';

dotenv.config({ path: path.resolve(__dirname, '../.env') });

const MAPPING: Record<string, string> = {
  wet_waste: 'food_organics',
  dry_waste: 'recycling',
  hazardous: 'general_waste',
};

async function main() {
  const apply = process.argv.includes('--apply');
  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error('MONGODB_URI is not set');
  const dbName = process.env.MONGODB_DBNAME || 'saveful';

  await mongoose.connect(uri, { dbName });
  const items = mongoose.connection.collection('userinventoryitems');

  console.log(apply ? 'Applying changes' : 'Dry run (pass --apply to write)');
  for (const [from, to] of Object.entries(MAPPING)) {
    const count = await items.countDocuments({ wasteType: from });
    if (!apply) {
      console.log(`  ${from} → ${to}: ${count} item(s)`);
      continue;
    }
    const result = await items.updateMany({ wasteType: from }, { $set: { wasteType: to } });
    console.log(`  ${from} → ${to}: ${result.modifiedCount} updated`);
  }

  await mongoose.disconnect();
}

main().catch(async error => {
  console.error(error);
  await mongoose.disconnect().catch(() => undefined);
  process.exit(1);
});
