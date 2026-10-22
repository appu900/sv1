import {
  REFERRAL_CODE_ALPHABET,
  REFERRAL_CODE_PATTERN,
  REFERRAL_CODE_PREFIX_MAX,
  REFERRAL_CODE_SUFFIX_LENGTH,
  ReferralHoldReason,
} from './referral.constants';

/**
 * Pure helpers for the referral program. Kept free of Nest/Mongoose so the
 * money rules can be unit tested directly.
 */

// ---------------------------------------------------------------------------
// Codes
// ---------------------------------------------------------------------------

/**
 * Normalises user input to a stored code: uppercase, spaces and hyphens
 * removed. Accepts a pasted referral link (`.../r/<code>`). Returns null when
 * the result is not a plausible code.
 */
export function normalizeReferralCode(input: unknown): string | null {
  if (typeof input !== 'string') return null;
  let value = input.trim().toUpperCase();
  const fromLink = value.match(/\/R\/([^/?#\s]+)/);
  if (fromLink) value = fromLink[1];
  value = value.replace(/[\s-]/g, '');
  return REFERRAL_CODE_PATTERN.test(value) ? value : null;
}

/** First letters of the chef's slug, e.g. `anna-smith` → `ANNA`. */
export function codePrefixFromSlug(slug: string | null | undefined): string {
  const letters = (slug ?? '').toUpperCase().replace(/[^A-Z]/g, '');
  const prefix = letters.slice(0, REFERRAL_CODE_PREFIX_MAX);
  return prefix.length >= 2 ? prefix : 'CHEF';
}

export function generateCodeCandidate(
  prefix: string,
  randomIndex: (maxExclusive: number) => number,
  suffixLength = REFERRAL_CODE_SUFFIX_LENGTH,
): string {
  let suffix = '';
  for (let i = 0; i < suffixLength; i++) {
    suffix += REFERRAL_CODE_ALPHABET[randomIndex(REFERRAL_CODE_ALPHABET.length)];
  }
  return `${prefix}${suffix}`;
}

// ---------------------------------------------------------------------------
// Money
// ---------------------------------------------------------------------------

export function currencyExponent(currency: string): number {
  try {
    const digits = new Intl.NumberFormat('en', {
      style: 'currency',
      currency,
    }).resolvedOptions().maximumFractionDigits;
    return typeof digits === 'number' ? digits : 2;
  } catch {
    return 2;
  }
}

/** `1234, 'AUD'` → `AUD 12.34`; the code keeps mixed-currency statements unambiguous. */
export function formatMinor(minor: number, currency: string): string {
  const exponent = currencyExponent(currency);
  try {
    return new Intl.NumberFormat('en-AU', {
      style: 'currency',
      currency,
      currencyDisplay: 'code',
    })
      .format(minor / 10 ** exponent)
      .replace(/\u00a0/g, ' ');
  } catch {
    return `${(minor / 10 ** exponent).toFixed(exponent)} ${currency}`;
  }
}

function finiteNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

export interface CommissionInput {
  priceInPurchasedCurrency: unknown;
  currency: unknown;
  taxPercentage: unknown;
  commissionPercentage: unknown;
  /** RevenueCat's USD conversion of the same transaction; optional. */
  priceUsd?: unknown;
  rateBps: number;
}

export interface CommissionAmounts {
  currency: string;
  grossMinor: number;
  taxRate: number;
  storeFeeRate: number;
  netMinor: number;
  commissionMinor: number;
  commissionUsdCents: number | null;
}

export type CommissionResult =
  | ({ ok: true } & CommissionAmounts)
  | {
      ok: false;
      holdReason: ReferralHoldReason;
      currency: string | null;
      grossMinor: number | null;
      taxRate: number | null;
      storeFeeRate: number | null;
    };

/**
 * Chef commission for one paid transaction, in integer minor units:
 * net = gross × (1 − tax − store fee), commission = net × rate.
 * Missing financial fields never get estimated — the caller holds the earning.
 */
export function computeCommission(input: CommissionInput): CommissionResult {
  const currency =
    typeof input.currency === 'string' && /^[A-Za-z]{3}$/.test(input.currency)
      ? input.currency.toUpperCase()
      : null;
  const price = finiteNumber(input.priceInPurchasedCurrency);
  const taxRate = finiteNumber(input.taxPercentage);
  const storeFeeRate = finiteNumber(input.commissionPercentage);
  const grossMinor =
    currency && price !== null
      ? Math.round(price * 10 ** currencyExponent(currency))
      : null;

  const hold = (holdReason: ReferralHoldReason): CommissionResult => ({
    ok: false,
    holdReason,
    currency,
    grossMinor,
    taxRate,
    storeFeeRate,
  });

  if (price === null || price <= 0) return hold(ReferralHoldReason.MISSING_PRICE);
  if (!currency) return hold(ReferralHoldReason.MISSING_CURRENCY);
  if (taxRate === null) return hold(ReferralHoldReason.MISSING_TAX);
  if (storeFeeRate === null) return hold(ReferralHoldReason.MISSING_STORE_FEE);
  if (
    taxRate < 0 ||
    storeFeeRate < 0 ||
    taxRate + storeFeeRate >= 1
  ) {
    return hold(ReferralHoldReason.INVALID_RATES);
  }

  const keep = 1 - taxRate - storeFeeRate;
  const netMinor = Math.round((grossMinor as number) * keep);
  const commissionMinor = Math.round((netMinor * input.rateBps) / 10_000);

  const priceUsd = finiteNumber(input.priceUsd);
  const commissionUsdCents =
    priceUsd !== null && priceUsd > 0
      ? Math.round((Math.round(priceUsd * 100 * keep) * input.rateBps) / 10_000)
      : null;

  return {
    ok: true,
    currency,
    grossMinor: grossMinor as number,
    taxRate,
    storeFeeRate,
    netMinor,
    commissionMinor,
    commissionUsdCents,
  };
}

// ---------------------------------------------------------------------------
// RevenueCat events
// ---------------------------------------------------------------------------

export type ReferralEventKind =
  | 'trial_start'
  | 'payment'
  | 'refund'
  | 'refund_reversed'
  | 'lapse'
  | 'reactivate'
  | 'ignore';

/**
 * What a RevenueCat webhook event means for referral earnings. Refunds arrive
 * as CANCELLATION with cancel_reason CUSTOMER_SUPPORT — RevenueCat has no
 * REFUND event type.
 */
export function classifyRevenueCatEvent(event: any): ReferralEventKind {
  const type = String(event?.type ?? '').toUpperCase();
  const periodType = String(event?.period_type ?? '').toUpperCase();
  const price = finiteNumber(
    event?.price_in_purchased_currency ?? event?.price,
  );

  switch (type) {
    case 'INITIAL_PURCHASE':
    case 'RENEWAL':
      if (periodType === 'TRIAL') {
        return type === 'INITIAL_PURCHASE' ? 'trial_start' : 'ignore';
      }
      // Unknown price is still a paid period: it becomes a held earning.
      if (price === null || price > 0) return 'payment';
      return 'ignore';
    case 'CANCELLATION':
      return String(event?.cancel_reason ?? '').toUpperCase() === 'CUSTOMER_SUPPORT'
        ? 'refund'
        : 'lapse';
    case 'REFUND_REVERSED':
      return 'refund_reversed';
    case 'EXPIRATION':
    case 'BILLING_ISSUE':
    case 'SUBSCRIPTION_PAUSED':
      return 'lapse';
    case 'UNCANCELLATION':
      return 'reactivate';
    default:
      return 'ignore';
  }
}

/** Mongo ObjectId-shaped RevenueCat app user ids (anonymous ids are skipped). */
export function candidateUserIds(event: any): string[] {
  const ids = [
    event?.app_user_id,
    event?.original_app_user_id,
    ...(Array.isArray(event?.aliases) ? event.aliases : []),
  ];
  const seen = new Set<string>();
  for (const id of ids) {
    if (typeof id === 'string' && /^[a-f0-9]{24}$/i.test(id)) seen.add(id);
  }
  return [...seen];
}

// ---------------------------------------------------------------------------
// Quarters (UTC)
// ---------------------------------------------------------------------------

export function quarterKey(date: Date): string {
  const quarter = Math.floor(date.getUTCMonth() / 3) + 1;
  return `${date.getUTCFullYear()}-Q${quarter}`;
}

/** `[start, end)` of a quarter key such as `2026-Q4`; null when malformed. */
export function quarterBounds(key: string): { start: Date; end: Date } | null {
  const match = /^(\d{4})-Q([1-4])$/.exec(key ?? '');
  if (!match) return null;
  const year = Number(match[1]);
  const quarter = Number(match[2]);
  return {
    start: new Date(Date.UTC(year, (quarter - 1) * 3, 1)),
    end: new Date(Date.UTC(year, quarter * 3, 1)),
  };
}

export function previousQuarterKey(now: Date): string {
  const start = quarterBounds(quarterKey(now))!.start;
  return quarterKey(new Date(start.getTime() - 1));
}
