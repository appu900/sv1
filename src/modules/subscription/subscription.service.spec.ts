import { ConfigService } from '@nestjs/config';
import { Types } from 'mongoose';
import { SubscriptionService } from './subscription.service';

function createService(config: Record<string, string | undefined> = {}) {
  const subscriptionModel = {
    findOneAndUpdate: jest.fn(),
    updateOne: jest.fn(),
    findOne: jest.fn(),
  };
  const usageModel = {
    findOneAndUpdate: jest.fn(),
    updateOne: jest.fn(),
  };
  const configService = {
    get: jest.fn((key: string) => config[key]),
  } as unknown as ConfigService;

  const service = new SubscriptionService(
    subscriptionModel as any,
    usageModel as any,
    configService,
  );

  return { service, subscriptionModel, usageModel, configService };
}

describe('SubscriptionService RevenueCat configuration', () => {
  it('uses explicit v2 and v1 env names even when both keys use sk prefixes', () => {
    const { service } = createService({
      REVENUECAT_PROJECT_ID: 'proj_test',
      REVENUECAT_V2_API_KEY: 'sk_v2_test',
      REVENUECAT_V1_API_KEY: 'sk_v1_test',
    });

    const configs = (service as any).getRevenueCatVerificationConfigs();

    expect(configs).toEqual([
      { version: 'v2', apiKey: 'sk_v2_test', projectId: 'proj_test' },
      { version: 'v1', apiKey: 'sk_v1_test' },
    ]);
  });
});

describe('SubscriptionService RevenueCat webhooks', () => {
  it('keeps cancelled paid users active until their paid period expires when entitlement ids are missing', async () => {
    const { service, subscriptionModel } = createService();
    const userId = new Types.ObjectId().toHexString();
    const eventAt = Date.UTC(2026, 3, 25);
    const expiresAt = Date.UTC(2026, 4, 25);

    subscriptionModel.findOne.mockResolvedValue({
      plan: 'hero',
      status: 'active',
      productId: 'saveful.hero.monthly',
      expiresAt: new Date(expiresAt),
    });
    subscriptionModel.updateOne.mockResolvedValue({ modifiedCount: 1 });

    await service.syncFromWebhook({
      event: {
        id: 'event_cancel_missing_entitlements',
        type: 'CANCELLATION',
        app_user_id: userId,
        event_timestamp_ms: eventAt,
        product_id: 'saveful.hero.monthly',
        expiration_at_ms: expiresAt,
      },
    });

    const appliedUpdate = subscriptionModel.updateOne.mock.calls[1][1].$set;
    expect(appliedUpdate).toMatchObject({
      plan: 'hero',
      status: 'cancelled',
      productId: 'saveful.hero.monthly',
      willRenew: false,
      revenueCatUserId: userId,
    });
    expect(appliedUpdate.cancelledAt.toISOString()).toBe(
      new Date(eventAt).toISOString(),
    );
    expect(appliedUpdate.expiresAt.toISOString()).toBe(
      new Date(expiresAt).toISOString(),
    );
  });
});
