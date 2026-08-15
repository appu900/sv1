/**
 * Clears Perks memberships created against the RETIRED WeMAD product.
 *
 * Those records carry a `wmadUserId` from a different system and no matching
 * corp account, yet many are marked `active` — so the app shows the member UI
 * for people who were never registered with the corp API.
 *
 * Resetting them to "not registered" (i.e. removing the record) puts those
 * users back on the Join screen, where a tap registers them properly. The
 * removal is recorded in perksmembershipevents so the history is not lost.
 *
 * Legacy records are identified by a missing `credentialVersion`, which only
 * corp-era registrations set.
 *
 * Usage:
 *   npm run reset:legacy-perks              # dry run — reports, changes nothing
 *   npm run reset:legacy-perks -- --apply   # performs the reset
 */
import { NestFactory } from '@nestjs/core';
import { getModelToken } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { AppModule } from '../src/app.module';
import {
  PerksMembershipEvent,
  PerksMembershipEventType,
} from '../src/database/schemas/perks-membership-event.schema';
import { PerksMembership } from '../src/database/schemas/perks-membership.schema';

async function main() {
  const apply = process.argv.includes('--apply');
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn'],
  });

  try {
    const memberships: Model<any> = app.get(
      getModelToken(PerksMembership.name),
    );
    const events: Model<any> = app.get(
      getModelToken(PerksMembershipEvent.name),
    );

    const legacy = await memberships
      .find({
        $or: [
          { credentialVersion: { $exists: false } },
          { credentialVersion: null },
        ],
      })
      .lean();

    console.log(
      `\n${legacy.length} legacy membership(s) found${apply ? '' : ' (dry run)'}\n`,
    );
    for (const row of legacy) {
      console.log(
        `  user=${row.userId} status=${row.status} legacyWmadUserId=${row.wmadUserId} email=${row.email}`,
      );
    }

    if (!legacy.length) {
      console.log('\nNothing to do.');
      return;
    }

    if (!apply) {
      console.log('\nRe-run with --apply to reset these records.');
      return;
    }

    // Record first: if the delete succeeds but the audit write fails, we would
    // otherwise lose the fact that these people were ever members.
    await events.insertMany(
      legacy.map((row) => ({
        userId: row.userId,
        type: PerksMembershipEventType.LEGACY_RESET,
        metadata: {
          legacyWmadUserId: row.wmadUserId ?? null,
          previousStatus: row.status,
          registeredAt: row.registeredAt ?? null,
        },
      })),
      { ordered: false },
    );

    const result = await memberships.deleteMany({
      _id: { $in: legacy.map((row) => row._id) },
    });

    console.log(
      `\nReset ${result.deletedCount} membership(s). Those users will see the Join screen and register against the corp API on their next visit.`,
    );
  } finally {
    await app.close();
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('Reset failed:', error?.message ?? error);
    process.exit(1);
  });
