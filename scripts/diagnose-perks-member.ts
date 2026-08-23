import 'reflect-metadata';
import * as dotenv from 'dotenv';
import * as path from 'path';
import { createHash, createHmac } from 'crypto';
import mongoose, { Types } from 'mongoose';

dotenv.config({ path: path.resolve(__dirname, '../.env') });

/**
 * Why one member cannot use My Perks. READ-ONLY, on purpose.
 *
 * WeMAD's production API is IP-whitelisted to the backend host and Amit asked
 * for no testing or data-modifying calls against it, so this only ever reads:
 * our own Mongo, and — with `--wemad` — the two WeMAD GETs that create nothing.
 * It never calls `/auth/autologin`, which would register a user upstream.
 *
 *   npm run diagnose:perks-member -- --user 698c1ffc6a7c3806736a1bd4
 *   npm run diagnose:perks-member -- --email someone@example.com --wemad
 *   npm run diagnose:perks-member -- --phone 0412228301
 *
 * `--phone` answers the question the membership row cannot: whether the number
 * is attached to more than one Saveful account, which is what makes WeMAD
 * reject the second one as already registered.
 */

type Args = {
  userId?: string;
  email?: string;
  phone?: string;
  wemad: boolean;
};

function parseArgs(argv: string[]): Args {
  const args: Args = { wemad: false };
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    const value = argv[i + 1];
    if (flag === '--user') args.userId = value;
    if (flag === '--email') args.email = value?.toLowerCase();
    if (flag === '--phone') args.phone = value;
    if (flag === '--wemad') args.wemad = true;
  }
  return args;
}

/** Same rule the session service applies before sending a phone to WeMAD. */
function normalisePhone(value: unknown): string | null {
  const digits = String(value ?? '').replace(/\D+/g, '');
  return digits.length >= 8 && digits.length <= 11 ? digits : null;
}

function line(label: string, value: unknown) {
  console.log(`  ${label.padEnd(22)} ${value === undefined ? '(unset)' : String(value)}`);
}

async function wemadReadOnlyCheck() {
  const base = process.env.WMAD_CORP_BASE_URL;
  const site = process.env.WMAD_CORP_SITE_ID;
  const key = process.env.WMAD_CORP_CLIENT_KEY;
  const secret = process.env.WMAD_CORP_CLIENT_SECRET;
  if (!base || !site || !key || !secret) {
    console.log('  WeMAD credentials are not in the environment — skipping');
    return;
  }

  const timestamp = Math.floor(Date.now() / 1000).toString();
  const signature = createHmac('sha256', secret)
    .update(`${site}|${key}|${timestamp}`)
    .digest('hex');

  const response = await fetch(`${base}/category`, {
    headers: {
      Accept: 'application/json',
      'X-SITE-ID': site,
      'X-CLIENT-KEY': key,
      'X-TIMESTAMP': timestamp,
      'X-REQUEST-TYPE': process.env.WMAD_CORP_REQUEST_TYPE ?? 'CORP',
      'X-SIGNATURE': signature,
    },
  });
  const body = await response.text();

  line('host', base);
  line('GET /category', response.status);
  if (response.status === 403 && body.includes('whitelist')) {
    console.log(
      '  >> This host is NOT on WeMAD\'s IP allowlist. Every Perks sign-up will\n' +
        '     fail here, whatever the member\'s details are.',
    );
  } else if (!response.ok) {
    console.log(`  >> ${body.slice(0, 300)}`);
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.userId && !args.email && !args.phone) {
    throw new Error('Pass one of --user <id>, --email <address>, --phone <number>');
  }

  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error('MONGODB_URI is not set');
  await mongoose.connect(uri, { dbName: process.env.MONGODB_DBNAME ?? 'saveful' });
  const db = mongoose.connection.db!;

  // --- who --------------------------------------------------------------
  const userQuery = args.userId
    ? { _id: new Types.ObjectId(args.userId) }
    : args.email
      ? { email: args.email }
      : { phoneNumber: args.phone };
  const user = await db.collection('users').findOne(userQuery);

  if (args.phone) {
    // A number on two accounts is the usual reason WeMAD rejects a sign-up:
    // the first account took it, and the second cannot have it.
    const digits = normalisePhone(args.phone);
    const holders = await db
      .collection('users')
      .find({ phoneNumber: { $regex: `${digits}$` } })
      .project({ email: 1, phoneNumber: 1, createdAt: 1 })
      .toArray();
    console.log(`\n=== accounts holding ${args.phone} (as sent: ${digits}) ===`);
    if (!holders.length) console.log('  none');
    for (const holder of holders) {
      console.log(
        `  ${String(holder._id)}  ${holder.email}  ${holder.phoneNumber}  ${holder.createdAt?.toISOString?.() ?? ''}`,
      );
    }
    if (holders.length > 1) {
      console.log(
        '  >> More than one Saveful account carries this number. WeMAD allows it\n' +
          '     on one account only, so every account after the first is refused.',
      );
    }
  }

  if (!user) {
    console.log('\nNo Saveful user matched.');
    await mongoose.disconnect();
    return;
  }

  const userId = user._id as Types.ObjectId;
  console.log('\n=== user ===');
  line('id', String(userId));
  line('email', user.email);
  line('country', user.country);
  line('phone (stored)', user.phoneNumber);
  line('phone (to WeMAD)', normalisePhone(user.phoneNumber) ?? 'REJECTED — profile gap');
  line('name', user.name);
  line('pincode', user.pincode);
  line('gender', user.gender);

  // --- membership -------------------------------------------------------
  const membership = await db
    .collection('perksmemberships')
    .findOne({ userId });
  console.log('\n=== perks membership ===');
  if (!membership) {
    console.log('  (no membership row)');
  } else {
    for (const field of [
      'status',
      'plan',
      'billingStatus',
      'cancelAtPeriodEnd',
      'accessEndsAt',
      'registeredAt',
      'wmadUserId',
      'credentialVersion',
      'stripeCustomerId',
      'stripeSubscriptionId',
      'lastStripeEventId',
      'lastStripeEventAt',
      'lastErrorCode',
      'lastErrorMessage',
    ]) {
      line(field, membership[field]);
    }
    if (membership.plan === 'paid' && membership.status !== 'active') {
      console.log(
        '\n  >> PAID BUT NOT ACTIVE. The money arrived and WeMAD sign-up did not\n' +
          '     complete. `lastErrorMessage` above is WeMAD\'s own reason.',
      );
    }
  }

  // --- audit trail ------------------------------------------------------
  const events = await db
    .collection('perksmembershipevents')
    .find({ userId })
    .sort({ createdAt: -1 })
    .limit(20)
    .toArray();
  console.log('\n=== membership events (newest first) ===');
  for (const event of events) {
    const when = event.createdAt?.toISOString?.() ?? String(event.createdAt);
    console.log(`  ${when}  ${event.type}  ${JSON.stringify(event.metadata ?? null)}`);
  }
  if (!events.length) console.log('  none');

  // --- derived credentials, so WeMAD can look the account up ------------
  console.log('\n=== derived WeMAD identity ===');
  line(
    'device_id',
    `sv-${createHash('sha256').update(String(userId)).digest('hex').slice(0, 24)}`,
  );
  line('email sent', String(user.email).toLowerCase());

  if (args.wemad) {
    console.log('\n=== WeMAD reachability (read-only) ===');
    await wemadReadOnlyCheck();
  }

  await mongoose.disconnect();
}

main().catch((error) => {
  console.error('FAILED:', error instanceof Error ? error.message : error);
  process.exit(1);
});
