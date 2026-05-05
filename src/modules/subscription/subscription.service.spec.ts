import { ConfigService } from '@nestjs/config';
import { ForbiddenException } from '@nestjs/common';
import { Types } from 'mongoose';
import { SubscriptionService } from './subscription.service';
import { parseCustomerInfo } from './utils/parse-customer-info';
import { currentUsagePeriod } from './utils/period';

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

describe('SubscriptionService customer info sync safety', () => {
  it('does not downgrade an unexpired paid subscription when CustomerInfo resolves empty', async () => {
    const { service, subscriptionModel } = createService();
    const userId = new Types.ObjectId().toHexString();
    const existing = {
      _id: new Types.ObjectId(),
      plan: 'legend',
      status: 'in_trial',
      productId: 'saveful.legend.monthly',
      expiresAt: new Date('2099-05-25T00:00:00.000Z'),
      willRenew: true,
    };

    jest.spyOn(service as any, 'verifyCustomerWithRevenueCat').mockResolvedValue({
      originalAppUserId: userId,
      entitlements: { active: {} },
    });
    subscriptionModel.findOne.mockResolvedValue(existing);

    const result = await service.syncFromCustomerInfo(
      userId,
      { entitlements: { active: {} } },
      userId,
    );

    expect(result).toBe(existing);
    expect(subscriptionModel.findOneAndUpdate).not.toHaveBeenCalled();
  });

  it('still downgrades a paid subscription when its known expiry has passed', async () => {
    const { service, subscriptionModel } = createService();
    const userId = new Types.ObjectId().toHexString();
    const saved = {
      _id: new Types.ObjectId(),
      plan: 'basic',
      status: 'expired',
      willRenew: false,
    };

    jest.spyOn(service as any, 'verifyCustomerWithRevenueCat').mockResolvedValue({
      originalAppUserId: userId,
      entitlements: { active: {} },
    });
    subscriptionModel.findOne.mockResolvedValue({
      _id: new Types.ObjectId(),
      plan: 'hero',
      status: 'active',
      productId: 'saveful.hero.monthly',
      expiresAt: new Date('2000-05-25T00:00:00.000Z'),
      willRenew: true,
    });
    subscriptionModel.findOneAndUpdate.mockResolvedValue(saved);

    const result = await service.syncFromCustomerInfo(
      userId,
      { entitlements: { active: {} } },
      userId,
    );

    expect(result).toBe(saved);
    const update = subscriptionModel.findOneAndUpdate.mock.calls[0][1];
    expect(update.$set).toMatchObject({
      plan: 'basic',
      status: 'expired',
      willRenew: false,
    });
  });

  it('rejects an anonymous RevenueCat identity in the trusted client fallback', () => {
    const { service } = createService();
    const userId = new Types.ObjectId().toHexString();
    expect(() =>
      (service as any).trustedClientCustomerInfo(
        userId,
        {
          originalAppUserId: '$RCAnonymousID:abc123',
          entitlements: { active: {} },
        },
        '$RCAnonymousID:abc123',
      ),
    ).toThrow(ForbiddenException);
  });

  it('rejects a client CustomerInfo whose app_user_id does not match the auth user', () => {
    const { service } = createService();
    const userId = new Types.ObjectId().toHexString();
    expect(() =>
      (service as any).trustedClientCustomerInfo(
        userId,
        {
          originalAppUserId: new Types.ObjectId().toHexString(),
          entitlements: { active: {} },
        },
      ),
    ).toThrow(ForbiddenException);
  });
});

describe('SubscriptionService RevenueCat v2 periods', () => {
  it('parses ISO timestamp fields into a calendar-month usage period', () => {
    const { service } = createService();

    const customerInfo = (service as any).subscriptionToCustomerInfo(
      new Types.ObjectId().toHexString(),
      {
        product_id: 'rc_product_id',
        current_period_starts_at: '2026-04-25T09:30:00.000Z',
        current_period_ends_at: '2026-05-25T09:30:00.000Z',
        auto_renewal_status: 'will_renew',
        status: 'active',
        store: 'app_store',
      },
      'saveful.hero.monthly',
    );

    const parsed = parseCustomerInfo(customerInfo);
    expect(parsed.purchasedAt?.toISOString()).toBe(
      '2026-04-25T09:30:00.000Z',
    );
    expect(parsed.expiresAt?.toISOString()).toBe(
      '2026-05-25T09:30:00.000Z',
    );

    // Usage is always keyed by calendar month — see period.ts.
    const period = currentUsagePeriod(parsed, new Date('2026-05-01T00:00:00.000Z'));
    expect(period.periodKey).toBe('2026-05');
  });

  it('does not treat an active v2 trial as cancelled when auto_renewal_status is missing', () => {
    const { service } = createService();

    const customerInfo = (service as any).subscriptionToCustomerInfo(
      new Types.ObjectId().toHexString(),
      {
        product_id: 'saveful.hero:monthly',
        current_period_starts_at: '2026-04-25T09:30:00.000Z',
        current_period_ends_at: '2099-05-25T09:30:00.000Z',
        status: 'trialing',
        store: 'play_store',
      },
      'saveful.hero:monthly',
    );

    const parsed = parseCustomerInfo(customerInfo);
    expect(parsed.plan).toBe('hero');
    expect(parsed.status).toBe('in_trial');
    expect(parsed.cancelledAt).toBeUndefined();
    expect(parsed.willRenew).toBe(true);
  });

  it('does treat an active v2 trial as cancelled when auto_renewal_status explicitly says will_not_renew', () => {
    const { service } = createService();

    const customerInfo = (service as any).subscriptionToCustomerInfo(
      new Types.ObjectId().toHexString(),
      {
        product_id: 'saveful.hero:monthly',
        current_period_starts_at: '2026-04-25T09:30:00.000Z',
        current_period_ends_at: '2099-05-25T09:30:00.000Z',
        auto_renewal_status: 'will_not_renew',
        status: 'trialing',
        store: 'play_store',
      },
      'saveful.hero:monthly',
    );

    const parsed = parseCustomerInfo(customerInfo);
    expect(parsed.plan).toBe('hero');
    expect(parsed.status).toBe('cancelled');
    expect(parsed.cancelledAt).toBeInstanceOf(Date);
    expect(parsed.willRenew).toBe(false);
  });

  it('picks the most recently purchased active v2 subscription, breaking ties by tier rank', () => {
    // Regression: the picker used to sort by `current_period_ends_at` DESC,
    // which caused a still-running Hero subscription with a later expiry to
    // hide a freshly-purchased Legend. The fix sorts by `purchased_at` DESC
    // (newest purchase wins) and tier-ranks legend > hero as a tie-break.
    const { service } = createService();

    const selected = (service as any).pickActiveRevenueCatV2Subscription(
      [
        {
          // Hero — bought first, but has the LATER end date.
          product_id: 'saveful.hero.monthly',
          gives_access: true,
          purchased_at: '2026-04-01T09:30:00.000Z',
          current_period_ends_at: '2026-07-25T09:30:00.000Z',
          entitlements: { items: [{ lookup_key: 'saveful_pro' }] },
        },
        {
          // Legend — bought just now, ends sooner.
          product_id: 'saveful.legend.monthly',
          gives_access: true,
          purchased_at: '2026-04-26T13:06:18.822Z',
          current_period_ends_at: '2026-05-26T13:06:18.822Z',
          entitlements: { items: [{ lookup_key: 'saveful_pro' }] },
        },
      ],
      new Set(['saveful_pro']),
    );

    expect(selected.product_id).toBe('saveful.legend.monthly');
  });

  it('matches v2 entitlement items by the internal id resolved from the entitlement registry', async () => {
    const { service } = createService();
    const userId = new Types.ObjectId().toHexString();

    jest
      .spyOn(service as any, 'fetchRevenueCatV2ListItems')
      .mockImplementation(async (pathArg: unknown) => {
        const path = String(pathArg);
        if (path.includes('/entitlements')) {
          return [
            {
              id: 'entl_saveful_internal',
              lookup_key: 'saveful_pro',
            },
          ];
        }
        if (path.includes('/subscriptions')) {
          return [
            {
              product_id: 'saveful.legend.monthly',
              gives_access: true,
              purchased_at: '2026-05-05T10:00:00.000Z',
              current_period_starts_at: '2026-05-05T10:00:00.000Z',
              current_period_ends_at: '2026-05-12T10:00:00.000Z',
              status: 'trialing',
              store: 'app_store',
              entitlements: {
                items: [{ entitlement_id: 'entl_saveful_internal' }],
              },
            },
          ];
        }
        return [];
      });

    const customerInfo = await (service as any).fetchCustomerFromRevenueCatV2(
      userId,
      'sk_test',
      'proj_test',
    );

    expect(
      customerInfo.entitlements.active.saveful_pro.product_identifier,
    ).toBe('saveful.legend.monthly');
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

  it('clears stale cancelledAt via $unset on the default webhook path (e.g. RENEWAL after a prior cancel)', async () => {
    // Regression: Mongoose silently strips `undefined` from $set, so a
    // RENEWAL arriving after a prior CANCELLATION used to leave the old
    // `cancelledAt` lingering forever, making a fresh paid sub still look
    // cancelled in the snapshot.
    const { service, subscriptionModel } = createService();
    const userId = new Types.ObjectId().toHexString();
    const eventAt = Date.UTC(2026, 4, 25);
    const expiresAt = Date.UTC(2026, 5, 25);

    subscriptionModel.findOne.mockResolvedValue({
      plan: 'hero',
      status: 'cancelled',
      productId: 'saveful.hero.monthly',
      cancelledAt: new Date(Date.UTC(2026, 3, 1)),
    });
    subscriptionModel.updateOne.mockResolvedValue({ modifiedCount: 1 });

    await service.syncFromWebhook({
      event: {
        id: 'event_renewal_after_cancel',
        type: 'RENEWAL',
        app_user_id: userId,
        event_timestamp_ms: eventAt,
        product_id: 'saveful.hero.monthly',
        entitlement_ids: ['saveful_pro'],
        expiration_at_ms: expiresAt,
        purchased_at_ms: eventAt,
      },
    });

    const renewalCall = subscriptionModel.updateOne.mock.calls[1];
    const update = renewalCall[1];
    expect(update.$unset).toEqual(
      expect.objectContaining({ cancelledAt: '' }),
    );
    // $set must NOT also contain cancelledAt — would conflict with $unset.
    expect(update.$set.cancelledAt).toBeUndefined();
  });

  it('keeps a renewal active when RevenueCat omits entitlement ids', async () => {
    const { service, subscriptionModel } = createService();
    const userId = new Types.ObjectId().toHexString();
    const eventAt = Date.UTC(2026, 4, 25);
    const expiresAt = Date.UTC(2026, 5, 25);

    subscriptionModel.findOne.mockResolvedValue({
      plan: 'hero',
      status: 'cancelled',
      productId: 'saveful.hero.monthly',
      cancelledAt: new Date(Date.UTC(2026, 3, 1)),
    });
    subscriptionModel.updateOne.mockResolvedValue({ modifiedCount: 1 });

    await service.syncFromWebhook({
      event: {
        id: 'event_renewal_missing_entitlements',
        type: 'RENEWAL',
        app_user_id: userId,
        event_timestamp_ms: eventAt,
        product_id: 'saveful.hero.monthly',
        expiration_at_ms: expiresAt,
        purchased_at_ms: eventAt,
      },
    });

    const renewalCall = subscriptionModel.updateOne.mock.calls[1];
    const update = renewalCall[1];
    expect(update.$set).toMatchObject({
      plan: 'hero',
      status: 'active',
      productId: 'saveful.hero.monthly',
      willRenew: true,
      revenueCatUserId: userId,
    });
    expect(update.$unset).toEqual(
      expect.objectContaining({ cancelledAt: '' }),
    );
  });
});

describe('SubscriptionService feature gating', () => {
  it('includes requiredPlan and currentPlan in 403 so the app can target the right tier', async () => {
    const { service, subscriptionModel } = createService();
    const userId = new Types.ObjectId().toHexString();

    subscriptionModel.findOneAndUpdate.mockResolvedValue({
      _id: new Types.ObjectId(),
      plan: 'basic',
      status: 'active',
    });

    await expect(
      service.assertFeature(userId, 'barcode_scanning'),
    ).rejects.toThrow(ForbiddenException);

    try {
      await service.assertFeature(userId, 'barcode_scanning');
    } catch (err: any) {
      expect(err.getResponse()).toMatchObject({
        code: 'UPGRADE_REQUIRED',
        feature: 'barcode_scanning',
        requiredPlan: 'legend', // barcode_scanning is legend-only
        currentPlan: 'basic',
      });
    }

    try {
      await service.assertFeature(userId, 'smart_meal_planning');
    } catch (err: any) {
      expect(err.getResponse()).toMatchObject({
        code: 'UPGRADE_REQUIRED',
        feature: 'smart_meal_planning',
        requiredPlan: 'hero', 
      });
    }
  });
});
