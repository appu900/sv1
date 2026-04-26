import { Module, Global } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import {
  Subscription,
  SubscriptionSchema,
} from '../../database/schemas/subscription.schema';
import {
  SubscriptionUsage,
  SubscriptionUsageSchema,
} from '../../database/schemas/subscription-usage.schema';
import { SubscriptionService } from './subscription.service';
import { SubscriptionController } from './subscription.controller';
import { RevenueCatWebhookController } from './revenuecat-webhook.controller';
import { SubscriptionGuard } from './subscription.guard';

@Global()
@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Subscription.name, schema: SubscriptionSchema },
      { name: SubscriptionUsage.name, schema: SubscriptionUsageSchema },
    ]),
  ],
  controllers: [SubscriptionController, RevenueCatWebhookController],
  providers: [SubscriptionService, SubscriptionGuard],
  exports: [SubscriptionService, SubscriptionGuard],
})
export class SubscriptionModule {}
