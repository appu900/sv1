import 'reflect-metadata';
import { Types } from 'mongoose';
import { SubscriptionService } from '../src/modules/subscription/subscription.service';
import { parseCustomerInfo } from '../src/modules/subscription/utils/parse-customer-info';
import { currentPeriod, currentUsagePeriod } from '../src/modules/subscription/utils/period';

const BILLING_START = '2026-04-25T09:30:00.000Z';
const BILLING_END = '2026-05-25T09:30:00.000Z';
const BILLING_START_MS = Date.parse(BILLING_START);
const BILLING_END_MS = Date.parse(BILLING_END);
const MID_PERIOD = new Date('2026-05-01T00:00:00.000Z');
const EXPECTED_PERIOD_KEY = `billing:${BILLING_START_MS}-${BILLING_END_MS}`;
const YEARLY_START = '2026-04-25T09:30:00.000Z';
const YEARLY_END = '2027-04-25T09:30:00.000Z';
const YEARLY_CHECK_DATE = new Date('2026-09-15T00:00:00.000Z');
const EXPECTED_YEARLY_MONTH_START = '2026-08-25T09:30:00.000Z';
const EXPECTED_YEARLY_MONTH_END = '2026-09-25T09:30:00.000Z';
const EXPECTED_YEARLY_MONTH_KEY = `billing:${Date.parse(EXPECTED_YEARLY_MONTH_START)}-${Date.parse(EXPECTED_YEARLY_MONTH_END)}`;

function assert(condition: unknown, message: string): void {
  if (!condition) throw new Error(message);
}

function assertIsoDate(value: Date | undefined, expected: string, label: string): void {
  assert(value instanceof Date, `${label} was not parsed as a Date`);
  assert(value?.toISOString() === expected, `${label} expected ${expected}, got ${value?.toISOString()}`);
}

function assertPaidBillingPeriod(name: string, customerInfo: Record<string, any>): void {
  const parsed = parseCustomerInfo(customerInfo);
  assert(parsed.plan !== 'basic', `${name}: expected a paid plan, got ${parsed.plan}`);
  assertIsoDate(parsed.purchasedAt, BILLING_START, `${name}: purchasedAt`);
  assertIsoDate(parsed.expiresAt, BILLING_END, `${name}: expiresAt`);

  const period = currentUsagePeriod(parsed, MID_PERIOD);
  assert(period.periodKey === EXPECTED_PERIOD_KEY, `${name}: expected ${EXPECTED_PERIOD_KEY}, got ${period.periodKey}`);
  assert(period.periodStart.toISOString() === BILLING_START, `${name}: wrong periodStart ${period.periodStart.toISOString()}`);
  assert(period.periodEnd.toISOString() === BILLING_END, `${name}: wrong periodEnd ${period.periodEnd.toISOString()}`);

  console.log(`ok - ${name}: ${period.periodKey}`);
}

function assertYearlyMonthlyReset(name: string, customerInfo: Record<string, any>): void {
  const parsed = parseCustomerInfo(customerInfo);
  assert(parsed.plan !== 'basic', `${name}: expected a paid plan, got ${parsed.plan}`);
  assertIsoDate(parsed.purchasedAt, YEARLY_START, `${name}: purchasedAt`);
  assertIsoDate(parsed.expiresAt, YEARLY_END, `${name}: expiresAt`);

  const period = currentUsagePeriod(parsed, YEARLY_CHECK_DATE);
  assert(
    period.periodKey === EXPECTED_YEARLY_MONTH_KEY,
    `${name}: yearly package must reset monthly; expected ${EXPECTED_YEARLY_MONTH_KEY}, got ${period.periodKey}`,
  );
  assert(
    period.periodStart.toISOString() === EXPECTED_YEARLY_MONTH_START,
    `${name}: wrong monthly periodStart ${period.periodStart.toISOString()}`,
  );
  assert(
    period.periodEnd.toISOString() === EXPECTED_YEARLY_MONTH_END,
    `${name}: wrong monthly periodEnd ${period.periodEnd.toISOString()}`,
  );

  console.log(`ok - ${name}: yearly resets monthly as ${period.periodKey}`);
}

function isYearlyLike(parsed: ReturnType<typeof parseCustomerInfo>): boolean {
  if (/year|yearly|annual/i.test(parsed.productId ?? '')) return true;
  if (!parsed.purchasedAt || !parsed.expiresAt) return false;
  return parsed.expiresAt.getTime() - parsed.purchasedAt.getTime() > 45 * 24 * 60 * 60 * 1000;
}

const service = new SubscriptionService(
  {} as any,
  {} as any,
  { get: (key: string) => process.env[key] } as any,
);

assertPaidBillingPeriod('RevenueCat SDK CustomerInfo camelCase', {
  originalAppUserId: new Types.ObjectId().toHexString(),
  entitlements: {
    active: {
      saveful_pro: {
        productIdentifier: 'saveful.hero.monthly',
        latestPurchaseDate: BILLING_START,
        expirationDate: BILLING_END,
        periodType: 'NORMAL',
        willRenew: true,
      },
    },
  },
});

assertPaidBillingPeriod('RevenueCat v1 / webhook snake_case CustomerInfo', {
  originalAppUserId: new Types.ObjectId().toHexString(),
  entitlements: {
    active: {
      saveful_pro: {
        product_identifier: 'saveful.hero.monthly',
        purchase_date: BILLING_START,
        expires_date: BILLING_END,
        period_type: 'NORMAL',
        will_renew: true,
      },
    },
  },
});

const v2IsoCustomerInfo = (service as any).subscriptionToCustomerInfo(
  new Types.ObjectId().toHexString(),
  {
    product_id: 'revenuecat_product_id',
    current_period_starts_at: BILLING_START,
    current_period_ends_at: BILLING_END,
    auto_renewal_status: 'will_renew',
    status: 'active',
    store: 'app_store',
  },
  'saveful.hero.monthly',
);
assertPaidBillingPeriod('RevenueCat v2 subscription ISO timestamps', v2IsoCustomerInfo);

const v2MsCustomerInfo = (service as any).subscriptionToCustomerInfo(
  new Types.ObjectId().toHexString(),
  {
    product_id: 'revenuecat_product_id',
    current_period_starts_at: BILLING_START_MS,
    current_period_ends_at: BILLING_END_MS,
    auto_renewal_status: 'will_renew',
    status: 'active',
    store: 'play_store',
  },
  'saveful.legend.monthly',
);
assertPaidBillingPeriod('RevenueCat v2 subscription millisecond timestamps', v2MsCustomerInfo);

const v2SecondCustomerInfo = (service as any).subscriptionToCustomerInfo(
  new Types.ObjectId().toHexString(),
  {
    product_id: 'revenuecat_product_id',
    current_period_starts_at: BILLING_START_MS / 1000,
    current_period_ends_at: BILLING_END_MS / 1000,
    auto_renewal_status: 'will_renew',
    status: 'active',
    store: 'stripe',
  },
  'saveful.hero.monthly',
);
assertPaidBillingPeriod('RevenueCat v2 subscription second timestamps', v2SecondCustomerInfo);

assertYearlyMonthlyReset('RevenueCat SDK yearly package', {
  originalAppUserId: new Types.ObjectId().toHexString(),
  entitlements: {
    active: {
      saveful_pro: {
        productIdentifier: 'saveful.hero.yearly',
        latestPurchaseDate: YEARLY_START,
        expirationDate: YEARLY_END,
        periodType: 'NORMAL',
        willRenew: true,
      },
    },
  },
});

const v2YearlyCustomerInfo = (service as any).subscriptionToCustomerInfo(
  new Types.ObjectId().toHexString(),
  {
    product_id: 'revenuecat_yearly_product_id',
    current_period_starts_at: YEARLY_START,
    current_period_ends_at: YEARLY_END,
    auto_renewal_status: 'will_renew',
    status: 'active',
    store: 'app_store',
  },
  'saveful.legend.yearly',
);
assertYearlyMonthlyReset('RevenueCat v2 yearly package', v2YearlyCustomerInfo);

const endOfMonthPeriod = currentUsagePeriod(
  {
    plan: 'hero',
    productId: 'saveful.hero.yearly',
    purchasedAt: new Date('2026-01-31T09:30:00.000Z'),
    expiresAt: new Date('2027-01-31T09:30:00.000Z'),
  },
  new Date('2026-03-15T00:00:00.000Z'),
);
assert(
  endOfMonthPeriod.periodStart.toISOString() === '2026-02-28T09:30:00.000Z' &&
    endOfMonthPeriod.periodEnd.toISOString() === '2026-03-31T09:30:00.000Z',
  `End-of-month yearly package reset produced ${endOfMonthPeriod.periodStart.toISOString()} to ${endOfMonthPeriod.periodEnd.toISOString()}`,
);
console.log(`ok - yearly end-of-month package resets monthly as ${endOfMonthPeriod.periodKey}`);

const selected = (service as any).pickActiveRevenueCatV2Subscription(
  [
    {
      product_id: 'saveful.hero.monthly',
      gives_access: true,
      current_period_ends_at: '2026-05-25T09:30:00.000Z',
      entitlements: { items: [{ lookup_key: 'saveful_pro' }] },
    },
    {
      product_id: 'saveful.legend.monthly',
      gives_access: true,
      current_period_ends_at: '2026-06-25T09:30:00.000Z',
      entitlements: { items: [{ lookup_key: 'saveful_pro' }] },
    },
  ],
  'saveful_pro',
);
assert(selected?.product_id === 'saveful.legend.monthly', 'RevenueCat v2 active subscription sorting did not choose the latest ISO period end');
console.log('ok - RevenueCat v2 active subscription sorting uses real ISO period end dates');

const basic = currentUsagePeriod({ plan: 'basic' }, MID_PERIOD);
const expectedBasic = currentPeriod(MID_PERIOD);
assert(basic.periodKey === expectedBasic.periodKey, `Basic plan should stay on calendar month, got ${basic.periodKey}`);
console.log(`ok - Basic fallback remains calendar month: ${basic.periodKey}`);

async function runLiveRevenueCatCheck(): Promise<void> {
  const liveUserId = process.env.SUBSCRIPTION_PERIOD_CHECK_USER_ID;
  if (!liveUserId) {
    console.log('skip - live RevenueCat fetch (set SUBSCRIPTION_PERIOD_CHECK_USER_ID to enable)');
    return;
  }

  const configs = (service as any).getRevenueCatVerificationConfigs();
  assert(
    Array.isArray(configs) && configs.length > 0,
    'Live RevenueCat check requires REVENUECAT_V2_API_KEY + REVENUECAT_PROJECT_ID or REVENUECAT_V1_API_KEY',
  );

  const customerInfo = await (service as any).verifyCustomerWithRevenueCat(
    liveUserId,
    { throwOnFailure: true },
  );
  const parsed = parseCustomerInfo(customerInfo);
  assert(parsed.plan !== 'basic', `Live RevenueCat check expected paid plan, got ${parsed.plan}`);
  assert(parsed.purchasedAt instanceof Date, 'Live RevenueCat check did not return purchasedAt');
  assert(parsed.expiresAt instanceof Date, 'Live RevenueCat check did not return expiresAt');

  const period = currentUsagePeriod(parsed, new Date());
  assert(
    period.periodKey.startsWith('billing:'),
    `Live RevenueCat check expected billing period, got ${period.periodKey}`,
  );
  if (isYearlyLike(parsed)) {
    const periodDurationDays =
      (period.periodEnd.getTime() - period.periodStart.getTime()) /
      (24 * 60 * 60 * 1000);
    assert(
      periodDurationDays <= 32,
      `Live RevenueCat yearly package must reset monthly; got ${periodDurationDays.toFixed(1)} day period ${period.periodKey}`,
    );
  }
  console.log(
    `ok - live RevenueCat fetch for ${liveUserId}: ${parsed.plan} ${period.periodKey}`,
  );
}

runLiveRevenueCatCheck()
  .then(() => {
    console.log('Subscription period validation completed successfully.');
  })
  .catch((err: Error) => {
    console.error(`Subscription period validation failed: ${err.message}`);
    process.exitCode = 1;
  });
