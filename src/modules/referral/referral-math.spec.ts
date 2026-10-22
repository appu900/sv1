import {
  candidateUserIds,
  classifyRevenueCatEvent,
  codePrefixFromSlug,
  computeCommission,
  currencyExponent,
  formatMinor,
  generateCodeCandidate,
  normalizeReferralCode,
  previousQuarterKey,
  quarterBounds,
  quarterKey,
} from './referral-math';
import { REFERRAL_CODE_ALPHABET, ReferralHoldReason } from './referral.constants';

describe('normalizeReferralCode', () => {
  it('uppercases and strips spaces and hyphens', () => {
    expect(normalizeReferralCode(' anna-7k2 ')).toBe('ANNA7K2');
    expect(normalizeReferralCode('anna 7k2')).toBe('ANNA7K2');
  });

  it('accepts a pasted referral link', () => {
    expect(normalizeReferralCode('https://admin.saveful.app/r/anna7k2')).toBe('ANNA7K2');
    expect(normalizeReferralCode('https://admin.saveful.app/r/ANNA7K2/?utm=x')).toBe('ANNA7K2');
  });

  it('rejects implausible input', () => {
    expect(normalizeReferralCode('ab')).toBeNull();
    expect(normalizeReferralCode('ANNA_7K2')).toBeNull();
    expect(normalizeReferralCode('A'.repeat(17))).toBeNull();
    expect(normalizeReferralCode(42)).toBeNull();
    expect(normalizeReferralCode(undefined)).toBeNull();
  });
});

describe('code generation', () => {
  it('uses up to four slug letters as the prefix', () => {
    expect(codePrefixFromSlug('anna-smith')).toBe('ANNA');
    expect(codePrefixFromSlug('jo')).toBe('JO');
    expect(codePrefixFromSlug('matt-moran-2')).toBe('MATT');
  });

  it('falls back to CHEF for short or empty slugs', () => {
    expect(codePrefixFromSlug('x')).toBe('CHEF');
    expect(codePrefixFromSlug(null)).toBe('CHEF');
    expect(codePrefixFromSlug('123')).toBe('CHEF');
  });

  it('appends suffix characters from the unambiguous alphabet', () => {
    let i = 0;
    const code = generateCodeCandidate('ANNA', () => i++);
    expect(code).toBe(`ANNA${REFERRAL_CODE_ALPHABET.slice(0, 3)}`);
    expect(generateCodeCandidate('ANNA', () => 0, 4)).toHaveLength(8);
    expect(REFERRAL_CODE_ALPHABET).not.toMatch(/[01OI]/);
  });
});

describe('computeCommission', () => {
  const base = {
    priceInPurchasedCurrency: 9.99,
    currency: 'AUD',
    taxPercentage: 0.0909,
    commissionPercentage: 0.15,
    priceUsd: 6.5,
    rateBps: 1000,
  };

  it('takes 10% of price × (1 − tax − store fee) in minor units', () => {
    const result = computeCommission(base);
    expect(result).toEqual({
      ok: true,
      currency: 'AUD',
      grossMinor: 999,
      taxRate: 0.0909,
      storeFeeRate: 0.15,
      netMinor: Math.round(999 * (1 - 0.0909 - 0.15)), // 758
      commissionMinor: 76,
      commissionUsdCents: Math.round((Math.round(650 * (1 - 0.0909 - 0.15)) * 1000) / 10000),
    });
  });

  it('handles zero-decimal and three-decimal currencies', () => {
    const jpy = computeCommission({ ...base, priceInPurchasedCurrency: 1500, currency: 'JPY' });
    expect(jpy.ok && jpy.grossMinor).toBe(1500);
    expect(jpy.ok && jpy.commissionMinor).toBe(Math.round(Math.round(1500 * 0.7591) / 10));

    const kwd = computeCommission({ ...base, priceInPurchasedCurrency: 1.25, currency: 'KWD' });
    expect(kwd.ok && kwd.grossMinor).toBe(1250);
  });

  it('accepts numeric strings and lowercase currency', () => {
    const result = computeCommission({ ...base, priceInPurchasedCurrency: '9.99', currency: 'aud' });
    expect(result.ok && result.currency).toBe('AUD');
    expect(result.ok && result.grossMinor).toBe(999);
  });

  it('leaves USD commission null when RevenueCat sent no USD price', () => {
    const result = computeCommission({ ...base, priceUsd: null });
    expect(result.ok && result.commissionUsdCents).toBeNull();
  });

  it.each([
    [{ priceInPurchasedCurrency: null }, ReferralHoldReason.MISSING_PRICE],
    [{ priceInPurchasedCurrency: 0 }, ReferralHoldReason.MISSING_PRICE],
    [{ currency: null }, ReferralHoldReason.MISSING_CURRENCY],
    [{ currency: 'DOLLARS' }, ReferralHoldReason.MISSING_CURRENCY],
    [{ taxPercentage: null }, ReferralHoldReason.MISSING_TAX],
    [{ commissionPercentage: undefined }, ReferralHoldReason.MISSING_STORE_FEE],
    [{ taxPercentage: 0.6, commissionPercentage: 0.5 }, ReferralHoldReason.INVALID_RATES],
    [{ taxPercentage: -0.1 }, ReferralHoldReason.INVALID_RATES],
  ])('holds instead of estimating when %o', (patch, reason) => {
    const result = computeCommission({ ...base, ...patch });
    expect(result.ok).toBe(false);
    expect(!result.ok && result.holdReason).toBe(reason);
  });
});

describe('currency helpers', () => {
  it('knows minor-unit exponents', () => {
    expect(currencyExponent('AUD')).toBe(2);
    expect(currencyExponent('JPY')).toBe(0);
    expect(currencyExponent('KWD')).toBe(3);
    expect(currencyExponent('???')).toBe(2);
  });

  it('formats minor units', () => {
    expect(formatMinor(1234, 'AUD')).toBe('AUD 12.34');
    expect(formatMinor(-1234, 'USD')).toBe('-USD 12.34');
    expect(formatMinor(1500, 'JPY')).toBe('JPY 1,500');
  });
});

describe('classifyRevenueCatEvent', () => {
  it.each([
    [{ type: 'INITIAL_PURCHASE', period_type: 'TRIAL', price: 0 }, 'trial_start'],
    [{ type: 'INITIAL_PURCHASE', period_type: 'NORMAL', price_in_purchased_currency: 9.49 }, 'payment'],
    [{ type: 'INITIAL_PURCHASE', period_type: 'INTRO', price_in_purchased_currency: 9.49 }, 'payment'],
    [{ type: 'RENEWAL', period_type: 'NORMAL', price_in_purchased_currency: 9.99 }, 'payment'],
    [{ type: 'RENEWAL', period_type: 'NORMAL', price: null }, 'payment'],
    [{ type: 'RENEWAL', period_type: 'TRIAL', price: 0 }, 'ignore'],
    [{ type: 'INITIAL_PURCHASE', period_type: 'PROMOTIONAL', price: 0 }, 'ignore'],
    [{ type: 'CANCELLATION', cancel_reason: 'CUSTOMER_SUPPORT', price: -9.99 }, 'refund'],
    [{ type: 'CANCELLATION', cancel_reason: 'UNSUBSCRIBE' }, 'lapse'],
    [{ type: 'CANCELLATION', cancel_reason: 'BILLING_ERROR' }, 'lapse'],
    [{ type: 'EXPIRATION' }, 'lapse'],
    [{ type: 'BILLING_ISSUE' }, 'lapse'],
    [{ type: 'UNCANCELLATION' }, 'reactivate'],
    [{ type: 'REFUND_REVERSED' }, 'refund_reversed'],
    [{ type: 'PRODUCT_CHANGE' }, 'ignore'],
    [{ type: 'TRANSFER' }, 'ignore'],
    [{ type: 'NON_RENEWING_PURCHASE', price: 4.99 }, 'ignore'],
    [{}, 'ignore'],
  ])('%o → %s', (event, kind) => {
    expect(classifyRevenueCatEvent(event)).toBe(kind);
  });
});

describe('candidateUserIds', () => {
  it('collects ObjectId-shaped ids from the event and skips anonymous ids', () => {
    const a = '64b7f0c2a1b2c3d4e5f60718';
    const b = '64b7f0c2a1b2c3d4e5f60719';
    expect(
      candidateUserIds({
        app_user_id: a,
        original_app_user_id: '$RCAnonymousID:abc',
        aliases: [a, b, '$RCAnonymousID:def'],
      }),
    ).toEqual([a, b]);
  });
});

describe('quarters', () => {
  it('keys dates by UTC quarter', () => {
    expect(quarterKey(new Date('2026-01-01T00:00:00Z'))).toBe('2026-Q1');
    expect(quarterKey(new Date('2026-09-30T23:59:59Z'))).toBe('2026-Q3');
    expect(quarterKey(new Date('2026-10-01T00:00:00Z'))).toBe('2026-Q4');
  });

  it('returns half-open bounds, crossing the year for Q4', () => {
    expect(quarterBounds('2026-Q4')).toEqual({
      start: new Date('2026-10-01T00:00:00Z'),
      end: new Date('2027-01-01T00:00:00Z'),
    });
    expect(quarterBounds('2026-Q5')).toBeNull();
    expect(quarterBounds('nope')).toBeNull();
  });

  it('finds the previous quarter', () => {
    expect(previousQuarterKey(new Date('2026-10-22T00:00:00Z'))).toBe('2026-Q3');
    expect(previousQuarterKey(new Date('2027-02-01T00:00:00Z'))).toBe('2026-Q4');
  });
});
