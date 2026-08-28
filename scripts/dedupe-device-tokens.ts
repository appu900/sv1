import * as dotenv from 'dotenv';
import * as path from 'path';
import * as mongoose from 'mongoose';
import {
  DeviceToken,
  DeviceTokenSchema,
} from '../src/database/schemas/device-token.schema';

dotenv.config({ path: path.resolve(__dirname, '../.env') });

/**
 * One-off cleanup for the duplicate push notifications users reported.
 *
 * Tokens registered before installationId existed cannot be matched back to the device
 * that superseded them, so a phone that was reinstalled (or had its push token re-issued)
 * still has every old row marked active — and receives the nightly reminder once per row.
 *
 * This keeps the newest active token per user + platform + bundle and deactivates the
 * rest. It is self-healing: a second real device re-registers on its next app launch,
 * which reactivates its token and stamps it with an installationId, so from then on the
 * server can tell the devices apart without guessing.
 *
 * Dry run by default — pass --apply to write.
 */
async function dedupeDeviceTokens() {
  const uri = process.env.MONGODB_URI;
  const dbName = process.env.MONGODB_DBNAME || 'saveful';
  const apply = process.argv.includes('--apply');

  if (!uri) {
    throw new Error('MONGODB_URI is not set in .env');
  }

  await mongoose.connect(uri, { dbName });
  console.log(`Connected to MongoDB (${apply ? 'APPLY' : 'DRY RUN'})`);

  const TokenModel = mongoose.model(DeviceToken.name, DeviceTokenSchema);

  const groups = await TokenModel.aggregate<{
    _id: { userId: mongoose.Types.ObjectId; platform: string; appBundle?: string };
    tokens: { _id: mongoose.Types.ObjectId; token: string; freshness: Date }[];
  }>([
    { $match: { isActive: true } },
    {
      $group: {
        _id: {
          userId: '$userId',
          platform: '$platform',
          appBundle: '$appBundle',
        },
        tokens: {
          $push: {
            _id: '$_id',
            token: '$token',
            // Newest signal of life this row has, whichever field carries it.
            freshness: {
              $max: ['$lastRegisteredAt', '$lastSuccessAt', '$updatedAt', '$createdAt'],
            },
          },
        },
      },
    },
    { $match: { 'tokens.1': { $exists: true } } },
  ]);

  if (groups.length === 0) {
    console.log('No device holds more than one active token. Nothing to do.');
    return;
  }

  const staleIds: mongoose.Types.ObjectId[] = [];

  for (const group of groups) {
    const sorted = [...group.tokens].sort(
      (a, b) => new Date(b.freshness).getTime() - new Date(a.freshness).getTime(),
    );
    const [keep, ...stale] = sorted;

    console.log(
      `user=${group._id.userId} platform=${group._id.platform} — keeping ${keep.token.slice(0, 24)}…, retiring ${stale.length}`,
    );
    staleIds.push(...stale.map((t) => t._id));
  }

  console.log(
    `\n${groups.length} devices with duplicates, ${staleIds.length} tokens to retire.`,
  );

  if (!apply) {
    console.log('Dry run — re-run with --apply to write these changes.');
    return;
  }

  const result = await TokenModel.updateMany(
    { _id: { $in: staleIds } },
    {
      $set: {
        isActive: false,
        deactivationReason: 'superseded_by_newer_token',
        lastFailureAt: new Date(),
      },
    },
  );

  console.log(`Retired ${result.modifiedCount} duplicate device tokens.`);
}

dedupeDeviceTokens()
  .then(async () => {
    await mongoose.disconnect();
    console.log('Done. Disconnected from MongoDB.');
  })
  .catch(async (error) => {
    console.error('Script failed:', error);
    await mongoose.disconnect();
    process.exit(1);
  });
