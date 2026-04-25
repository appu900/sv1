import { parseCustomerInfo } from './parse-customer-info';

describe('parseCustomerInfo', () => {
  it('handles RevenueCat SDK camelCase dates and uppercase trial period types', () => {
    const parsed = parseCustomerInfo({
      entitlements: {
        active: {
          saveful_pro: {
            productIdentifier: 'saveful_hero_monthly',
            expirationDate: '2099-05-25T00:00:00Z',
            latestPurchaseDate: '2099-04-25T00:00:00Z',
            periodType: 'TRIAL',
            willRenew: true,
          },
        },
      },
    });

    expect(parsed.plan).toBe('hero');
    expect(parsed.status).toBe('in_trial');
    expect(parsed.purchasedAt?.toISOString()).toBe('2099-04-25T00:00:00.000Z');
    expect(parsed.trialEndsAt?.toISOString()).toBe('2099-05-25T00:00:00.000Z');
  });

  it('defaults an active premium entitlement with an unknown product to Hero', () => {
    const parsed = parseCustomerInfo({
      entitlements: {
        active: {
          saveful_pro: {
            product_identifier: 'prod_unknown_from_revenuecat_v2',
            expires_date: '2099-05-25T00:00:00Z',
            period_type: 'NORMAL',
          },
        },
      },
    });

    expect(parsed.plan).toBe('hero');
    expect(parsed.status).toBe('active');
  });

  it('downgrades expired premium entitlements to Basic', () => {
    const parsed = parseCustomerInfo({
      entitlements: {
        active: {
          saveful_pro: {
            product_identifier: 'saveful_legend_monthly',
            expires_date: '2000-05-25T00:00:00Z',
            period_type: 'NORMAL',
          },
        },
      },
    });

    expect(parsed.plan).toBe('basic');
    expect(parsed.status).toBe('expired');
  });
});
