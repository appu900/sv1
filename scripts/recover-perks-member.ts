/**
 * Rescues a member who paid Stripe but never became a Perks member.
 *
 * The normal path is the Stripe webhook: it marks the membership paid and then
 * registers the person with WeMAD. When that never lands — a stale signing
 * secret, an endpoint outage, a restart at the wrong moment — the money is gone
 * and our database still says they owe it. From the app the only offer is to
 * pay again.
 *
 * This does what the webhook would have: reads the truth from Stripe, applies
 * it, then completes the WeMAD sign-up. It creates nothing in Stripe and never
 * charges anyone; the subscription it finds already exists and is already paid.
 *
 * Usage:
 *   npm run recover:perks-member -- --email mrpchuter@gmail.com
 *   npm run recover:perks-member -- --user 698c1ffc6a7c3806736a1bd4 --apply
 *
 * Dry run by default: it reports what it found and what it would do.
 */
import { NestFactory } from '@nestjs/core';
import { getModelToken } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { AppModule } from '../src/app.module';
import { PerksMembership } from '../src/database/schemas/perks-membership.schema';
import { PerksBillingService } from '../src/modules/perks/billing/perks-billing.service';
import { PerksService } from '../src/modules/perks/perks.service';
import { User } from '../src/database/schemas/user.auth.schema';

function argValue(flag: string): string | undefined {
  const index = process.argv.indexOf(flag);
  return index === -1 ? undefined : process.argv[index + 1];
}

async function main() {
  const apply = process.argv.includes('--apply');
  const email = argValue('--email')?.toLowerCase();
  const userIdArg = argValue('--user');
  if (!email && !userIdArg) {
    throw new Error('Pass --email <address> or --user <id>');
  }

  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn', 'log'],
  });

  try {
    const users: Model<any> = app.get(getModelToken(User.name));
    const memberships: Model<any> = app.get(getModelToken(PerksMembership.name));
    const billing = app.get(PerksBillingService);
    const perks = app.get(PerksService);

    const user = userIdArg
      ? await users.findById(new Types.ObjectId(userIdArg))
      : await users.findOne({ email });
    if (!user) throw new Error('No Saveful user matched');

    const userId = String(user._id);
    const membership = await memberships.findOne({ userId: user._id });
    if (!membership) throw new Error('No Perks membership row for that user');

    console.log(`user        : ${userId}  ${user.email}`);
    console.log(`before      : status=${membership.status} plan=${membership.plan} ` +
      `billing=${membership.billingStatus} sub=${membership.stripeSubscriptionId ?? 'none'}`);

    if (membership.status === 'active') {
      console.log('\nAlready active — nothing to recover.');
      return;
    }

    if (!apply) {
      console.log(
        '\nDry run. Re-run with --apply to pull the subscription from Stripe ' +
          'and finish the WeMAD sign-up.',
      );
      return;
    }

    const entitled = await billing.reconcileFromStripe(membership);
    console.log(`reconciled  : ${entitled ? 'Stripe confirms they pay' : 'no paid subscription found'}`);
    if (!entitled) {
      console.log(
        '\nStripe has no active subscription for this person. They have not been ' +
          'charged for a live membership — nothing to recover.',
      );
      return;
    }

    // Registers with WeMAD and flips the membership to active. Throws with
    // WeMAD's own reason if they reject the sign-up, which is the thing worth
    // seeing here rather than swallowing.
    const result = await perks.completeRegistrationAfterPayment(userId);
    console.log(`after       : status=${result.status} wmadUserId=${result.wmadUserId ?? 'none'}`);
    console.log('\nDone.');
  } finally {
    await app.close();
  }
}

main().catch((error) => {
  console.error('FAILED:', error instanceof Error ? error.message : error);
  process.exit(1);
});
