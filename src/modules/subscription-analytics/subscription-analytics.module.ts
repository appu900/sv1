import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Subscription, SubscriptionSchema } from '../../database/schemas/subscription.schema';
import {
  RevenueCatEvent,
  RevenueCatEventSchema,
} from '../../database/schemas/revenuecat-event.schema';
import {
  SubscriptionAnalyticsRun,
  SubscriptionAnalyticsRunSchema,
  SubscriptionDailyState,
  SubscriptionDailyStateSchema,
  SubscriptionPeriod,
  SubscriptionPeriodSchema,
  SubscriptionTransaction,
  SubscriptionTransactionSchema,
} from '../../database/schemas/subscription-analytics.schema';
import { User, UserSchema } from '../../database/schemas/user.auth.schema';
import { SubscriptionAnalyticsService } from './subscription-analytics.service';
import { SubscriptionAnalyticsCron } from './subscription-analytics.cron';

/**
 * Builds the derived subscription history that the admin Subscriptions
 * dashboard (saveful-india-web) reads. Read-only towards billing data:
 * it never changes subscriptions, entitlements or the webhook log.
 */
@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Subscription.name, schema: SubscriptionSchema },
      { name: RevenueCatEvent.name, schema: RevenueCatEventSchema },
      { name: User.name, schema: UserSchema },
      { name: SubscriptionPeriod.name, schema: SubscriptionPeriodSchema },
      { name: SubscriptionTransaction.name, schema: SubscriptionTransactionSchema },
      { name: SubscriptionDailyState.name, schema: SubscriptionDailyStateSchema },
      { name: SubscriptionAnalyticsRun.name, schema: SubscriptionAnalyticsRunSchema },
    ]),
  ],
  providers: [SubscriptionAnalyticsService, SubscriptionAnalyticsCron],
  exports: [SubscriptionAnalyticsService],
})
export class SubscriptionAnalyticsModule {}
