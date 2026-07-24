import * as dotenv from 'dotenv';
import * as path from 'path';
import * as mongoose from 'mongoose';

dotenv.config({ path: path.resolve(__dirname, '../.env') });

const EMAIL = 'swagatdash164@gmail.com';

async function main() {
  const uri = process.env.MONGODB_URI;
  const dbName = process.env.MONGODB_DBNAME || 'saveful';

  if (!uri) {
    throw new Error('MONGODB_URI is not set in .env');
  }

  await mongoose.connect(uri, { dbName });
  console.log('Connected to MongoDB');

  const db = mongoose.connection.db!;

  // 1. Find user by email
  const user = await db.collection('users').findOne({ email: EMAIL });
  if (!user) {
    console.error(`User not found: ${EMAIL}`);
    process.exit(1);
  }
  console.log(`Found user: ${user._id} (${user.email})`);

  // 2. Build dates
  const now = new Date();
  const expiresAt = new Date(now);
  expiresAt.setFullYear(expiresAt.getFullYear() + 1);

  // 3. Upsert subscription to legend 1-year
  const result = await db.collection('subscriptions').findOneAndUpdate(
    { userId: user._id },
    {
      $set: {
        plan: 'legend',
        status: 'active',
        productId: 'saveful.legend.yearly',
        periodType: 'non_renewing',
        purchasedAt: now,
        expiresAt,
        willRenew: false,
        entitlement: 'saveful_pro',
        store: 'manual',
      },
      $setOnInsert: {
        userId: user._id,
      },
      $unset: {
        cancelledAt: '',
        trialEndsAt: '',
        cancelFeedback: '',
      },
    },
    { upsert: true, returnDocument: 'after' },
  );

  const sub = result;
  console.log(
    `Subscription updated → plan=${sub?.plan} status=${sub?.status} expiresAt=${sub?.expiresAt?.toISOString()}`,
  );
  console.log('Done.');
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => mongoose.disconnect());
