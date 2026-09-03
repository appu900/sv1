/**
 * Deletes demo accounts created by `create-demo-account.ts`, and everything
 * hanging off them.
 *
 * Scoped hard, on purpose. It resolves the exact emails you pass to exact user
 * ids, then walks every collection in the database and removes only documents
 * whose `userId` is one of those ids. Nothing is deleted by pattern, prefix or
 * date, so it cannot reach another member's data even if a collection is added
 * later.
 *
 * Usage:
 *   npm run delete:demo-account -- --email a@b.com --email c@d.com
 *   npm run delete:demo-account -- --email a@b.com --apply
 *
 * Dry run by default: it prints exactly which documents it would remove.
 *
 * It cannot delete the matching WeMAD account — that lives on their system and
 * only they can remove it. The Saveful side going away is enough to stop the
 * account being used; the upstream record simply keeps its phone number
 * reserved, which matters because WeMAD allow a number on one account only.
 */
import * as dotenv from 'dotenv';
import * as path from 'path';
import mongoose, { Types } from 'mongoose';

dotenv.config({ path: path.resolve(__dirname, '../.env') });

/** Every `--email` given. Required — there is deliberately no default. */
function emails(): string[] {
  const found: string[] = [];
  for (let i = 0; i < process.argv.length; i += 1) {
    if (process.argv[i] === '--email' && process.argv[i + 1]) {
      found.push(process.argv[i + 1].trim().toLowerCase());
    }
  }
  return found;
}

const APPLY = process.argv.includes('--apply');
/** A guard against a fat-fingered command taking out more than intended. */
const MAX_ACCOUNTS = 5;

async function main() {
  const wanted = emails();
  if (!wanted.length) {
    throw new Error(
      'Pass at least one --email. This script never picks accounts itself.',
    );
  }
  if (wanted.length > MAX_ACCOUNTS) {
    throw new Error(
      `Refusing to delete ${wanted.length} accounts in one run (limit ${MAX_ACCOUNTS}).`,
    );
  }

  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error('MONGODB_URI is not set');
  await mongoose.connect(uri, { dbName: process.env.MONGODB_DBNAME ?? 'saveful' });
  const db = mongoose.connection.db!;

  // --- resolve emails to ids; refuse to guess ---------------------------
  const users = await db
    .collection('users')
    .find({ email: { $in: wanted } })
    .project({ email: 1, name: 1, createdAt: 1 })
    .toArray();

  console.log(`asked for ${wanted.length} account(s), matched ${users.length}`);
  for (const email of wanted) {
    const hit = users.find((u) => u.email === email);
    console.log(
      `  ${hit ? String(hit._id) : '(not found)'.padEnd(24)}  ${email}` +
        (hit?.name ? `  ${hit.name}` : ''),
    );
  }
  if (!users.length) {
    console.log('\nNothing to do.');
    await mongoose.disconnect();
    return;
  }

  const ids = users.map((u) => u._id as Types.ObjectId);

  // --- find every document owned by those ids ---------------------------
  // Walking the collections rather than naming them means a collection added
  // after this was written is still cleaned up.
  const collections = await db.listCollections().toArray();
  const plan: Array<{ name: string; filter: Record<string, unknown>; count: number }> =
    [];

  for (const { name } of collections) {
    const filter =
      name === 'users' ? { _id: { $in: ids } } : { userId: { $in: ids } };
    const count = await db.collection(name).countDocuments(filter);
    if (count > 0) plan.push({ name, filter, count });
  }

  console.log(`\ndocuments belonging to these account(s):`);
  let total = 0;
  for (const row of plan) {
    total += row.count;
    console.log(`  ${String(row.count).padStart(4)}  ${row.name}`);
  }
  console.log(`  ${String(total).padStart(4)}  TOTAL`);

  if (!APPLY) {
    console.log('\nDry run — nothing deleted. Re-run with --apply.');
    await mongoose.disconnect();
    return;
  }

  console.log('\ndeleting…');
  for (const row of plan) {
    const result = await db.collection(row.name).deleteMany(row.filter);
    console.log(
      `  ${String(result.deletedCount).padStart(4)}  ${row.name}` +
        (result.deletedCount === row.count ? '' : `  (expected ${row.count})`),
    );
  }

  // --- prove they are gone ----------------------------------------------
  const left = await db
    .collection('users')
    .countDocuments({ email: { $in: wanted } });
  console.log(`\nusers remaining with those emails: ${left}`);
  console.log(
    'Note: the matching WeMAD accounts still exist upstream — only they can ' +
      'remove those, and their phone numbers stay reserved.',
  );

  await mongoose.disconnect();
}

main().catch((error) => {
  console.error('FAILED:', error instanceof Error ? error.message : error);
  process.exit(1);
});
