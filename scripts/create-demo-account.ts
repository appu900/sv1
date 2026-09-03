/**
 * Creates a fully-enabled Saveful demo account: Legend subscription plus an
 * active My Perks membership, registered with WeMAD so it can actually browse
 * and buy.
 *
 * Built for App Store / Play review logins and for handing a working account to
 * a tester, without putting a card through Stripe.
 *
 * Usage:
 *   npm run create:demo-account                      # dry run — shows the plan
 *   npm run create:demo-account -- --apply
 *   npm run create:demo-account -- --apply \
 *     --email demo@saveful.app --password 'S0meth1ng!' --phone 0412345678
 *
 * Notes worth reading before you run it:
 *
 * - The Perks membership is written as `plan: paid` / `billingStatus: active`
 *   with NO Stripe subscription. `resolveEntitlement` grants access on those
 *   two fields alone, so the account behaves exactly like a paying member and
 *   nothing is ever charged. It also survives the grandfather cutoff, which a
 *   `free` plan would not.
 *
 * - The phone must not already be on a WeMAD account. They allow a number on
 *   one account only and reject the second with
 *   "phone already registered", so pass `--phone` if the default is taken.
 *
 * - Registration is done by calling the app's own `ensureMembership`, so the
 *   demo account goes through the identical path a real member does — WeMAD
 *   autologin, profile validation, the nine-digit phone rule, all of it. If it
 *   fails here, it would have failed for a real member too.
 */
import 'reflect-metadata';
import * as dotenv from 'dotenv';
import * as path from 'path';
import * as bcrypt from 'bcrypt';
import { NestFactory } from '@nestjs/core';
import { getModelToken } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';

dotenv.config({ path: path.resolve(__dirname, '../.env') });

import { AppModule } from '../src/app.module';
import { Gender } from '../src/database/schemas/nutrition/health-profile.schema';
import {
  PerksMembership,
  PerksBillingStatus,
  PerksMembershipPlan,
  PerksMembershipStatus,
} from '../src/database/schemas/perks-membership.schema';
import { User, UserRole } from '../src/database/schemas/user.auth.schema';
import { PerksService } from '../src/modules/perks/perks.service';

function arg(flag: string, fallback: string): string {
  const i = process.argv.indexOf(flag);
  return i === -1 ? fallback : (process.argv[i + 1] ?? fallback);
}

const APPLY = process.argv.includes('--apply');
const EMAIL = arg('--email', 'demo.perks@saveful.app').toLowerCase();
const PASSWORD = arg('--password', 'SavefulDemo!2026');
const NAME = arg('--name', 'Perks Demo');
// Australian mobile. WeMAD take the nine-digit national number; `toWemadPhone`
// strips the leading zero for us.
const PHONE = arg('--phone', '0412345678');
const PINCODE = arg('--pincode', '3205');
const COUNTRY = arg('--country', 'AU');

async function main() {
  console.log('Saveful demo account');
  console.log('  email    :', EMAIL);
  console.log('  password :', PASSWORD);
  console.log('  name     :', NAME);
  console.log('  phone    :', PHONE);
  console.log('  country  :', COUNTRY, ' pincode:', PINCODE);
  console.log('  mode     :', APPLY ? 'APPLY' : 'dry run (pass --apply to write)');

  if (!APPLY) {
    console.log('\nWould create/update the user, grant Legend for one year,');
    console.log('activate My Perks (paid, no Stripe) and register with WeMAD.');
    return;
  }

  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn'],
  });

  try {
    const users: Model<any> = app.get(getModelToken(User.name));
    const memberships: Model<any> = app.get(
      getModelToken(PerksMembership.name),
    );
    const perks = app.get(PerksService);
    const db = users.db;

    // --- 1. the account ---------------------------------------------------
    const passwordHash = await bcrypt.hash(PASSWORD, 10);
    const user = await users.findOneAndUpdate(
      { email: EMAIL },
      {
        $set: {
          name: NAME,
          passwordHash,
          role: UserRole.USER,
          country: COUNTRY,
          pincode: PINCODE,
          phoneNumber: PHONE,
          gender: Gender.OTHER,
          isUserSubscribed: true,
        },
        $setOnInsert: { email: EMAIL },
      },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    );
    const userId = String(user._id);
    console.log('\nuser        :', userId);

    // --- 2. Legend --------------------------------------------------------
    // Same shape as scripts/grant-legend-access.ts, kept in step with it.
    const now = new Date();
    const expiresAt = new Date(now);
    expiresAt.setFullYear(expiresAt.getFullYear() + 1);

    await db.collection('subscriptions').updateOne(
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
        $setOnInsert: { userId: user._id },
        $unset: { cancelledAt: '', trialEndsAt: '', cancelFeedback: '' },
      },
      { upsert: true },
    );
    console.log('legend      : active until', expiresAt.toISOString().slice(0, 10));

    // --- 3. Perks entitlement, without Stripe -----------------------------
    // `resolveEntitlement` reads plan + billingStatus, so these two fields are
    // the whole of it. Status stays PENDING until WeMAD registration below
    // flips it to ACTIVE, exactly as it would for a real member.
    await memberships.updateOne(
      { userId: new Types.ObjectId(userId) },
      {
        $set: {
          email: EMAIL,
          plan: PerksMembershipPlan.PAID,
          billingStatus: PerksBillingStatus.ACTIVE,
          cancelAtPeriodEnd: false,
          cancelledAt: null,
          accessEndsAt: null,
        },
        $setOnInsert: {
          userId: new Types.ObjectId(userId),
          status: PerksMembershipStatus.PENDING,
          credentialVersion: 1,
        },
      },
      { upsert: true },
    );
    console.log('perks       : entitled (paid, no Stripe subscription)');

    // --- 4. register with WeMAD ------------------------------------------
    try {
      const result = await perks.ensureMembership(userId);
      console.log(
        'wemad       :',
        result.status,
        result.wmadUserId ? `(wmadUserId ${result.wmadUserId})` : '',
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.log('wemad       : FAILED —', message);
      console.log(
        '\nThe account still works for everything except buying gift cards.',
      );
      console.log(
        'A duplicate phone is the usual cause: WeMAD allow a number on one',
      );
      console.log('account only. Re-run with a different --phone.');
    }

    const finalMembership = await memberships
      .findOne({ userId: new Types.ObjectId(userId) })
      .lean();
    console.log('\n--- sign in with -------------------------------------');
    console.log('  email    :', EMAIL);
    console.log('  password :', PASSWORD);
    console.log('------------------------------------------------------');
    console.log('perks status:', finalMembership?.status);
    console.log('perks plan  :', finalMembership?.plan);
  } finally {
    await app.close();
  }
}

main().catch((error) => {
  console.error('FAILED:', error instanceof Error ? error.message : error);
  process.exit(1);
});
