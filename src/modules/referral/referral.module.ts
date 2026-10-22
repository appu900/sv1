import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { ScheduleModule } from '@nestjs/schedule';
import { EmailModule } from '../../common/email';
import { ReferralCode, ReferralCodeSchema } from '../../database/schemas/referral-code.schema';
import {
  ReferralAttribution,
  ReferralAttributionSchema,
} from '../../database/schemas/referral-attribution.schema';
import {
  ReferralLedgerEntry,
  ReferralLedgerEntrySchema,
} from '../../database/schemas/referral-ledger-entry.schema';
import { ReferralPayout, ReferralPayoutSchema } from '../../database/schemas/referral-payout.schema';
import {
  RevenueCatEvent,
  RevenueCatEventSchema,
} from '../../database/schemas/revenuecat-event.schema';
import { ChefProfile, ChefProfileSchema } from '../../database/schemas/chef-profile.schema';
import { Subscription, SubscriptionSchema } from '../../database/schemas/subscription.schema';
import { User, UserSchema } from '../../database/schemas/user.auth.schema';
import { ReferralCodeService } from './referral-code.service';
import { ReferralAttributionService } from './referral-attribution.service';
import { ReferralLedgerService } from './referral-ledger.service';
import { ReferralPayoutService } from './referral-payout.service';
import { ReferralChefService } from './referral-chef.service';
import { ReferralAdminService } from './referral-admin.service';
import { ReferralCronService } from './referral.cron';
import { ReferralsController } from './referrals.controller';
import { ChefReferralsController } from './chef-referrals.controller';
import { AdminReferralsController } from './admin-referrals.controller';

/**
 * Chef referral program: codes and links, subscriber attribution, the
 * commission ledger fed by RevenueCat webhooks, and quarterly payouts.
 * Must not import SubscriptionModule or AuthModule — both import this one.
 * ThrottlerGuard relies on the global ThrottlerModule registered by AuthModule.
 */
@Module({
  imports: [
    ScheduleModule.forRoot(),
    EmailModule,
    MongooseModule.forFeature([
      { name: ReferralCode.name, schema: ReferralCodeSchema },
      { name: ReferralAttribution.name, schema: ReferralAttributionSchema },
      { name: ReferralLedgerEntry.name, schema: ReferralLedgerEntrySchema },
      { name: ReferralPayout.name, schema: ReferralPayoutSchema },
      { name: RevenueCatEvent.name, schema: RevenueCatEventSchema },
      { name: ChefProfile.name, schema: ChefProfileSchema },
      { name: Subscription.name, schema: SubscriptionSchema },
      { name: User.name, schema: UserSchema },
    ]),
  ],
  controllers: [ReferralsController, ChefReferralsController, AdminReferralsController],
  providers: [
    ReferralCodeService,
    ReferralAttributionService,
    ReferralLedgerService,
    ReferralPayoutService,
    ReferralChefService,
    ReferralAdminService,
    ReferralCronService,
  ],
  exports: [ReferralAttributionService, ReferralLedgerService],
})
export class ReferralModule {}
