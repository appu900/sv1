/**
 * Rebuilds the subscription analytics history (periods, transactions, daily
 * states) that the admin Subscriptions dashboard reads. Also the backfill:
 * history comes from the RevenueCat API, so the first run fills April 2026
 * onwards.
 *
 *   npm run analytics:subscriptions:rebuild                # write a new run
 *   npm run analytics:subscriptions:rebuild -- --dry-run   # compute + print, write nothing
 *   ... --dry-run --export /tmp/out.json                   # also save computed rows
 *   ... --skip-revenuecat                                  # webhook log + rows only
 *
 * Reads billing data only; never changes subscriptions or the webhook log.
 */
import 'reflect-metadata';
import * as dotenv from 'dotenv';
import * as fs from 'fs';
import * as path from 'path';
import * as mongoose from 'mongoose';
import { Subscription, SubscriptionSchema } from '../src/database/schemas/subscription.schema';
import { RevenueCatEvent, RevenueCatEventSchema } from '../src/database/schemas/revenuecat-event.schema';
import {
  SubscriptionAnalyticsRun,
  SubscriptionAnalyticsRunSchema,
  SubscriptionDailyState,
  SubscriptionDailyStateSchema,
  SubscriptionPeriod,
  SubscriptionPeriodSchema,
  SubscriptionTransaction,
  SubscriptionTransactionSchema,
} from '../src/database/schemas/subscription-analytics.schema';
import { SubscriptionAnalyticsService } from '../src/modules/subscription-analytics/subscription-analytics.service';

dotenv.config({ path: path.resolve(__dirname, '../.env') });

const args = process.argv.slice(2);
const flag = (name: string) => args.includes(name);
const value = (name: string) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};

async function main() {
  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error('MONGODB_URI is not set');
  const dryRun = flag('--dry-run');
  const exportPath = value('--export');
  if (exportPath && !dryRun) throw new Error('--export only works with --dry-run');

  const conn = await mongoose.createConnection(uri, { dbName: process.env.MONGODB_DBNAME || 'saveful' }).asPromise();
  try {
    // Untyped on purpose: passing these large schemas through mongoose's generic
    // model<T>() makes the TypeScript build run out of memory (nest build OOM).
    const model = (name: string, schema: unknown): any => conn.model(name, schema as any);
    const service = new SubscriptionAnalyticsService(
      model(Subscription.name, SubscriptionSchema) as any,
      model(RevenueCatEvent.name, RevenueCatEventSchema) as any,
      // Only `country` is read; a minimal schema avoids loading the full user model.
      model('User', new mongoose.Schema({ country: String }, { collection: 'users', strict: false })) as any,
      model(SubscriptionPeriod.name, SubscriptionPeriodSchema) as any,
      model(SubscriptionTransaction.name, SubscriptionTransactionSchema) as any,
      model(SubscriptionDailyState.name, SubscriptionDailyStateSchema) as any,
      model(SubscriptionAnalyticsRun.name, SubscriptionAnalyticsRunSchema) as any,
      { get: (key: string) => process.env[key] } as any,
    );

    const summary = await service.rebuild({
      trigger: dryRun ? 'script:dry-run' : 'script',
      dryRun,
      skipRevenueCat: flag('--skip-revenuecat'),
      includeData: !!exportPath,
    });

    if (exportPath && summary.data) {
      fs.writeFileSync(exportPath, JSON.stringify(summary.data));
      console.log(`Exported computed rows to ${exportPath}`);
    }
    const { data: _data, ...printable } = summary;
    console.log(JSON.stringify(printable, null, 2));
    if (summary.status !== 'success') process.exitCode = 1;
  } finally {
    await conn.close();
  }
}

main().catch((err: Error) => {
  console.error(`Subscription analytics rebuild failed: ${err.message}`);
  process.exitCode = 1;
});
