/**
 * Pure functions that turn billing data into subscription history.
 *
 * Inputs per user: billing transactions (RevenueCat API, else webhook log,
 * else a reconstruction from the subscription row), comped grants, and the
 * user's webhook events. Outputs: continuous access periods and one state
 * per reporting day. Nothing here touches the database, so every rule in
 * the metric dictionary is covered by unit tests.
 */
import {
  PLAN_PREFIX_RULES,
  PRODUCT_TO_PLAN,
} from '../subscription/subscription.constants';
import { dayKeysBetween, endOfDayInTz } from './reporting-tz';

export const HISTORY_BUILDER_VERSION = 'subscription-history v1';

export type PaidPlan = 'hero' | 'legend';
export type PeriodKind = 'trial' | 'paid' | 'comped';
export type BillingPeriod = 'monthly' | 'yearly' | 'other';
export type StoreKey = 'app_store' | 'play_store' | 'stripe' | 'promotional' | 'manual' | 'other';
export type DataSource = 'revenuecat_api' | 'webhook' | 'reconstructed';
export type FxMethod = 'local_aud' | 'usd_fixed_rate' | 'unknown';

export type StartReason =
  | 'new'
  | 'new_trial'
  | 'trial_conversion'
  | 'reactivation'
  | 'upgrade'
  | 'downgrade'
  | 'comped';

export type EndReason =
  | 'voluntary'
  | 'involuntary'
  | 'refund'
  | 'plan_change'
  | 'trial_converted'
  | 'trial_not_converted'
  | 'comped_ended'
  | 'unknown';

export type DailyStateKind = 'paid' | 'paid_cancelling' | 'billing_issue' | 'trial' | 'comped';

/** Gaps up to this long between billing periods are treated as one continuous run. */
export const MERGE_GAP_MS = 3 * 24 * 60 * 60 * 1000;
/** A trial converts when paid access starts within this window after the trial ends. */
export const DEFAULT_CONVERSION_WINDOW_DAYS = 7;
/** Billing-issue state lasts at most this long after paid access ends. */
export const BILLING_ISSUE_MAX_MS = 16 * 24 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

export interface Money {
  gross: number | null;
  tax: number | null;
  commission: number | null;
  proceeds: number | null;
}

export interface NormalizedTransaction {
  key: string;
  userId: string;
  rcSubscriptionId?: string | null;
  originalTransactionId?: string | null;
  productId: string;
  plan: PaidPlan;
  billingPeriod: BillingPeriod;
  store: StoreKey;
  kind: 'trial' | 'paid';
  startAt: Date;
  endAt: Date;
  /** Earlier than endAt when access ended early (refund, immediate upgrade). */
  effectiveEndAt: Date;
  currency?: string | null;
  local: Money;
  usd: Money;
  aud: Money;
  fxMethod: FxMethod;
  refunded: boolean;
  refundedAt?: Date | null;
  source: DataSource;
  country?: string | null;
  offeringId?: string | null;
  /** RevenueCat auto-renewal status of the owning subscription (API source only). */
  autoRenewalStatus?: string | null;
}

export interface CompedGrant {
  userId: string;
  plan: PaidPlan;
  startAt: Date;
  endAt: Date;
  source: DataSource;
}

/** The subset of a RevenueCat webhook event the builder needs. */
export interface BillingEvent {
  eventId: string;
  type: string;
  at: Date;
  productId?: string | null;
  transactionId?: string | null;
  originalTransactionId?: string | null;
  purchasedAt?: Date | null;
  expiresAt?: Date | null;
  cancelReason?: string | null;
  expirationReason?: string | null;
}

export interface CurrentSubscriptionHint {
  plan?: string | null;
  status?: string | null;
  willRenew?: boolean | null;
  cancelledAt?: Date | null;
  expiresAt?: Date | null;
}

export interface SubscriptionPeriodRecord {
  userId: string;
  plan: PaidPlan;
  kind: PeriodKind;
  store: StoreKey;
  productId: string | null;
  billingPeriod: BillingPeriod | null;
  startAt: Date;
  endAt: Date;
  isActive: boolean;
  startReason: StartReason;
  endReason: EndReason | null;
  cancelRequestedAt: Date | null;
  isFirstPaid: boolean;
  transactionKeys: string[];
  source: DataSource;
  country: string | null;
}

export interface DailyStateRecord {
  date: string;
  userId: string;
  state: DailyStateKind;
  plan: PaidPlan;
  billingPeriod: BillingPeriod | null;
  store: StoreKey;
  /** Normalised monthly recurring amounts (AUD). Null when price is unknown. */
  mrrGrossAud: number | null;
  mrrExTaxAud: number | null;
  mrrNetAud: number | null;
  firstPaidDate: string | null;
  source: DataSource;
}

// ---------------------------------------------------------------------------
// Normalisation helpers
// ---------------------------------------------------------------------------

export function planForProductId(productId?: string | null): PaidPlan | null {
  if (!productId) return null;
  const direct = PRODUCT_TO_PLAN[productId];
  if (direct === 'hero' || direct === 'legend') return direct;
  for (const rule of PLAN_PREFIX_RULES) {
    if (rule.match.test(productId) && (rule.plan === 'hero' || rule.plan === 'legend')) {
      return rule.plan;
    }
  }
  return null;
}

export function normalizeStore(store?: string | null): StoreKey {
  const s = String(store ?? '').trim().toLowerCase();
  if (s === 'app_store' || s === 'mac_app_store' || s === 'ios') return 'app_store';
  if (s === 'play_store' || s === 'android') return 'play_store';
  if (s === 'stripe' || s === 'rc_billing' || s === 'paddle') return 'stripe';
  if (s === 'promotional') return 'promotional';
  if (s === 'manual') return 'manual';
  return 'other';
}

export function billingPeriodFor(productId: string | null | undefined, startAt?: Date, endAt?: Date): BillingPeriod {
  const id = String(productId ?? '').toLowerCase();
  if (/year|annual|p1y/.test(id)) return 'yearly';
  if (/month|p1m/.test(id)) return 'monthly';
  if (startAt && endAt) {
    const days = (endAt.getTime() - startAt.getTime()) / DAY_MS;
    if (days >= 300) return 'yearly';
    if (days >= 25 && days <= 35) return 'monthly';
  }
  return 'other';
}

export function monthsInPeriod(period: BillingPeriod | null, startAt?: Date, endAt?: Date): number {
  if (period === 'yearly') return 12;
  if (period === 'monthly') return 1;
  if (startAt && endAt) {
    const months = (endAt.getTime() - startAt.getTime()) / (DAY_MS * 30.4375);
    return months > 0 ? months : 1;
  }
  return 1;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

const num = (v: unknown): number | null => {
  const n = typeof v === 'string' ? Number(v) : (v as number);
  return typeof n === 'number' && Number.isFinite(n) ? n : null;
};

export function emptyMoney(): Money {
  return { gross: null, tax: null, commission: null, proceeds: null };
}

/** AUD amounts: exact when charged in AUD, else USD × fixed rate. */
export function toAud(local: Money, currency: string | null | undefined, usd: Money, usdToAud: number): { aud: Money; fxMethod: FxMethod } {
  if (String(currency ?? '').toUpperCase() === 'AUD' && local.gross !== null) {
    return { aud: { ...local }, fxMethod: 'local_aud' };
  }
  if (usd.gross !== null && usdToAud > 0) {
    const conv = (v: number | null) => (v === null ? null : round2(v * usdToAud));
    return {
      aud: { gross: conv(usd.gross), tax: conv(usd.tax), commission: conv(usd.commission), proceeds: conv(usd.proceeds) },
      fxMethod: 'usd_fixed_rate',
    };
  }
  return { aud: emptyMoney(), fxMethod: 'unknown' };
}

// ---------------------------------------------------------------------------
// Transaction sources
// ---------------------------------------------------------------------------

export interface RcApiSubscription {
  id: string;
  store?: string;
  environment?: string;
  country?: string;
  presented_offering_id?: string | null;
  store_subscription_identifier?: string | null;
  auto_renewal_status?: string | null;
}

export interface RcApiTransaction {
  id: string;
  product_store_identifier?: string;
  purchased_at?: number;
  expiration_date?: number;
  effective_expiration_date?: number;
  revenue_in_local_currency?: { currency?: string; gross?: number; tax?: number; commission?: number; proceeds?: number };
  revenue_in_usd?: { currency?: string; gross?: number; tax?: number; commission?: number; proceeds?: number };
}

const moneyFrom = (m?: { gross?: number; tax?: number; commission?: number; proceeds?: number }): Money => ({
  gross: num(m?.gross),
  tax: num(m?.tax),
  commission: num(m?.commission),
  proceeds: num(m?.proceeds),
});

/** Transactions from RevenueCat API v2 (production subscriptions only). */
export function transactionsFromRcApi(
  userId: string,
  subscriptions: Array<{ subscription: RcApiSubscription; transactions: RcApiTransaction[] }>,
  usdToAud: number,
): { transactions: NormalizedTransaction[]; comped: CompedGrant[]; skipped: number } {
  const transactions: NormalizedTransaction[] = [];
  const comped: CompedGrant[] = [];
  let skipped = 0;

  for (const { subscription, transactions: txs } of subscriptions) {
    if (subscription.environment && subscription.environment.toLowerCase() !== 'production') {
      skipped += txs.length;
      continue;
    }
    const store = normalizeStore(subscription.store);
    const sorted = [...txs].sort((a, b) => (a.purchased_at ?? 0) - (b.purchased_at ?? 0));
    sorted.forEach((tx, index) => {
      const productId = tx.product_store_identifier ?? '';
      const plan = planForProductId(productId);
      if (!plan || !tx.purchased_at || !tx.expiration_date) {
        skipped += 1;
        return;
      }
      const startAt = new Date(tx.purchased_at);
      const endAt = new Date(tx.expiration_date);
      const effectiveEndAt = new Date(Math.min(tx.effective_expiration_date ?? tx.expiration_date, tx.expiration_date));
      if (store === 'promotional') {
        comped.push({ userId, plan, startAt, endAt: effectiveEndAt, source: 'revenuecat_api' });
        return;
      }
      const local = moneyFrom(tx.revenue_in_local_currency);
      const usd = moneyFrom(tx.revenue_in_usd);
      const zeroRevenue = (local.gross ?? 0) === 0 && (usd.gross ?? 0) === 0;
      const durationDays = (endAt.getTime() - startAt.getTime()) / DAY_MS;
      const kind: 'trial' | 'paid' = zeroRevenue && index === 0 && durationDays <= 35 ? 'trial' : 'paid';
      const { aud, fxMethod } = toAud(local, tx.revenue_in_local_currency?.currency, usd, usdToAud);
      transactions.push({
        key: `rc:${tx.id}`,
        userId,
        rcSubscriptionId: subscription.id,
        originalTransactionId: subscription.store_subscription_identifier ?? null,
        productId,
        plan,
        billingPeriod: billingPeriodFor(productId, startAt, endAt),
        store,
        kind,
        startAt,
        endAt,
        effectiveEndAt,
        currency: tx.revenue_in_local_currency?.currency ?? null,
        local,
        usd,
        aud,
        fxMethod,
        refunded: false,
        refundedAt: null,
        source: 'revenuecat_api',
        country: subscription.country ?? null,
        offeringId: subscription.presented_offering_id ?? null,
        autoRenewalStatus: subscription.auto_renewal_status ?? null,
      });
    });
  }
  return { transactions, comped, skipped };
}

const PURCHASE_EVENT_TYPES = new Set(['INITIAL_PURCHASE', 'RENEWAL', 'NON_RENEWING_PURCHASE']);

/** Transactions from the webhook log, used when the RevenueCat API has none. */
export function transactionsFromWebhookPayloads(
  userId: string,
  payloads: any[],
  usdToAud: number,
): NormalizedTransaction[] {
  const out = new Map<string, NormalizedTransaction>();
  for (const e of payloads) {
    if (!e || !PURCHASE_EVENT_TYPES.has(String(e.type))) continue;
    if (e.environment && String(e.environment).toUpperCase() !== 'PRODUCTION') continue;
    const productId = String(e.product_id ?? '');
    const plan = planForProductId(productId);
    if (!plan || !e.purchased_at_ms || !e.expiration_at_ms) continue;
    const startAt = new Date(e.purchased_at_ms);
    const endAt = new Date(e.expiration_at_ms);
    const kind: 'trial' | 'paid' = String(e.period_type ?? '').toUpperCase() === 'TRIAL' ? 'trial' : 'paid';
    const taxPct = num(e.tax_percentage) ?? 0;
    const commissionPct = num(e.commission_percentage);
    const split = (gross: number | null): Money => {
      if (gross === null) return emptyMoney();
      const tax = round2(gross * taxPct);
      const commission = commissionPct === null ? null : round2((gross - tax) * commissionPct);
      return { gross: round2(gross), tax, commission, proceeds: commission === null ? null : round2(gross - tax - commission) };
    };
    const local = kind === 'trial' ? { gross: 0, tax: 0, commission: 0, proceeds: 0 } : split(num(e.price_in_purchased_currency));
    const usd = kind === 'trial' ? { gross: 0, tax: 0, commission: 0, proceeds: 0 } : split(num(e.price));
    const { aud, fxMethod } = toAud(local, e.currency, usd, usdToAud);
    const key = `wh:${e.transaction_id ?? e.id}`;
    out.set(key, {
      key,
      userId,
      rcSubscriptionId: null,
      originalTransactionId: e.original_transaction_id ?? null,
      productId,
      plan,
      billingPeriod: billingPeriodFor(productId, startAt, endAt),
      store: normalizeStore(e.store),
      kind,
      startAt,
      endAt,
      effectiveEndAt: endAt,
      currency: e.currency ?? null,
      local,
      usd,
      aud,
      fxMethod,
      refunded: false,
      refundedAt: null,
      source: 'webhook',
      country: e.country_code ?? null,
      offeringId: e.presented_offering_id ?? null,
    });
  }
  return [...out.values()];
}

export interface SubscriptionRowLike {
  plan?: string | null;
  status?: string | null;
  productId?: string | null;
  store?: string | null;
  periodType?: string | null;
  purchasedAt?: Date | null;
  expiresAt?: Date | null;
  trialEndsAt?: Date | null;
  trialsConsumed?: { hero?: Date | null; legend?: Date | null } | null;
}

/**
 * Last-resort history from the subscription row (no RevenueCat or webhook
 * data). Prices are unknown, so these periods carry no revenue.
 */
export function reconstructFromSubscriptionRow(
  userId: string,
  row: SubscriptionRowLike,
  trialDays: number,
): { transactions: NormalizedTransaction[]; comped: CompedGrant[] } {
  const transactions: NormalizedTransaction[] = [];
  const comped: CompedGrant[] = [];
  const productPlan = planForProductId(row.productId) ?? (row.plan === 'hero' || row.plan === 'legend' ? row.plan : null);
  const store = normalizeStore(row.store);

  if (productPlan && row.purchasedAt && row.expiresAt) {
    if (store === 'manual' || store === 'promotional') {
      comped.push({ userId, plan: productPlan, startAt: row.purchasedAt, endAt: row.expiresAt, source: 'reconstructed' });
    } else {
      const kind: 'trial' | 'paid' = String(row.periodType ?? '').toLowerCase() === 'trial' ? 'trial' : 'paid';
      transactions.push({
        key: `rec:${userId}:${row.purchasedAt.getTime()}`,
        userId,
        productId: row.productId ?? '',
        plan: productPlan,
        billingPeriod: billingPeriodFor(row.productId, row.purchasedAt, row.expiresAt),
        store,
        kind,
        startAt: row.purchasedAt,
        endAt: row.expiresAt,
        effectiveEndAt: row.expiresAt,
        local: emptyMoney(),
        usd: emptyMoney(),
        aud: kind === 'trial' ? { gross: 0, tax: 0, commission: 0, proceeds: 0 } : emptyMoney(),
        fxMethod: 'unknown',
        refunded: false,
        source: 'reconstructed',
      });
    }
  }

  for (const plan of ['hero', 'legend'] as const) {
    const startedAt = row.trialsConsumed?.[plan];
    if (!startedAt) continue;
    const already = transactions.some(
      (t) => t.kind === 'trial' && t.plan === plan && Math.abs(t.startAt.getTime() - startedAt.getTime()) < 2 * DAY_MS,
    );
    if (already) continue;
    const endAt = new Date(startedAt.getTime() + trialDays * DAY_MS);
    transactions.push({
      key: `rec:${userId}:trial:${plan}:${startedAt.getTime()}`,
      userId,
      productId: '',
      plan,
      billingPeriod: 'other',
      store,
      kind: 'trial',
      startAt: startedAt,
      endAt,
      effectiveEndAt: endAt,
      local: emptyMoney(),
      usd: emptyMoney(),
      aud: { gross: 0, tax: 0, commission: 0, proceeds: 0 },
      fxMethod: 'unknown',
      refunded: false,
      source: 'reconstructed',
    });
  }
  return { transactions, comped };
}

// ---------------------------------------------------------------------------
// Refunds from events
// ---------------------------------------------------------------------------

const isRefundEvent = (e: BillingEvent) =>
  e.type === 'REFUND' ||
  (e.type === 'CANCELLATION' && String(e.cancelReason ?? '').toUpperCase() === 'CUSTOMER_SUPPORT');

/** Marks transactions refunded when a refund event points at them. */
export function applyRefunds(transactions: NormalizedTransaction[], events: BillingEvent[]): NormalizedTransaction[] {
  const refunds = events.filter(isRefundEvent);
  if (refunds.length === 0) return transactions;
  return transactions.map((tx) => {
    const hit = refunds.find((r) => {
      if (r.transactionId && (tx.key.endsWith(`:${r.transactionId}`) || tx.originalTransactionId === r.transactionId)) {
        return true;
      }
      if (r.purchasedAt && Math.abs(r.purchasedAt.getTime() - tx.startAt.getTime()) < 60_000) return true;
      return false;
    });
    if (!hit || tx.kind !== 'paid') return tx;
    const refundedAt = hit.at;
    return {
      ...tx,
      refunded: true,
      refundedAt,
      effectiveEndAt: new Date(Math.min(tx.effectiveEndAt.getTime(), Math.max(refundedAt.getTime(), tx.startAt.getTime()))),
    };
  });
}

// ---------------------------------------------------------------------------
// Periods
// ---------------------------------------------------------------------------

interface Segment {
  plan: PaidPlan;
  kind: 'trial' | 'paid';
  startAt: Date;
  endAt: Date;
  tx: NormalizedTransaction;
}

const PLAN_RANK: Record<PaidPlan, number> = { hero: 1, legend: 2 };

export interface BuildHistoryInput {
  userId: string;
  transactions: NormalizedTransaction[];
  comped: CompedGrant[];
  events: BillingEvent[];
  current?: CurrentSubscriptionHint | null;
  now: Date;
  conversionWindowDays?: number;
  country?: string | null;
}

export interface UserHistory {
  userId: string;
  periods: SubscriptionPeriodRecord[];
  transactions: NormalizedTransaction[];
  billingIssueWindows: Array<{ startAt: Date; endAt: Date }>;
  firstPaidAt: Date | null;
}

function cancellationWithin(events: BillingEvent[], startAt: Date, endAt: Date): Date | null {
  let requested: Date | null = null;
  const sorted = [...events].sort((a, b) => a.at.getTime() - b.at.getTime());
  for (const e of sorted) {
    if (e.at < startAt || e.at > endAt) continue;
    if (e.type === 'CANCELLATION' && !isRefundEvent(e)) {
      const reason = String(e.cancelReason ?? '').toUpperCase();
      if (reason === 'BILLING_ERROR') continue;
      requested = e.at;
    } else if (e.type === 'UNCANCELLATION' || e.type === 'RENEWAL' || e.type === 'PRODUCT_CHANGE') {
      requested = null;
    }
  }
  return requested;
}

function involuntaryEnd(events: BillingEvent[], period: { startAt: Date; endAt: Date }): boolean {
  const from = period.startAt.getTime();
  const to = period.endAt.getTime() + BILLING_ISSUE_MAX_MS;
  return events.some((e) => {
    const t = e.at.getTime();
    if (t < from || t > to) return false;
    if (e.type === 'BILLING_ISSUE') return true;
    if (e.type === 'EXPIRATION' && String(e.expirationReason ?? '').toUpperCase() === 'BILLING_ERROR') return true;
    if (e.type === 'CANCELLATION' && String(e.cancelReason ?? '').toUpperCase() === 'BILLING_ERROR') return true;
    return false;
  });
}

export function buildUserHistory(input: BuildHistoryInput): UserHistory {
  const conversionWindowMs = (input.conversionWindowDays ?? DEFAULT_CONVERSION_WINDOW_DAYS) * DAY_MS;
  const now = input.now;
  const transactions = applyRefunds(input.transactions, input.events);

  const segments: Segment[] = transactions
    .filter((tx) => tx.effectiveEndAt > tx.startAt)
    .map((tx) => ({ plan: tx.plan, kind: tx.kind, startAt: tx.startAt, endAt: tx.effectiveEndAt, tx }))
    .sort((a, b) => a.startAt.getTime() - b.startAt.getTime() || PLAN_RANK[a.plan] - PLAN_RANK[b.plan]);

  type Draft = SubscriptionPeriodRecord & { lastTx: NormalizedTransaction };
  const drafts: Draft[] = [];

  for (const seg of segments) {
    const prev = drafts[drafts.length - 1];
    const gap = prev ? seg.startAt.getTime() - prev.endAt.getTime() : Infinity;

    // Same plan & kind, back-to-back (or overlapping): one continuous run.
    if (prev && prev.kind === seg.kind && prev.plan === seg.plan && gap <= MERGE_GAP_MS) {
      if (seg.endAt > prev.endAt) prev.endAt = seg.endAt;
      prev.productId = seg.tx.productId || prev.productId;
      prev.billingPeriod = seg.tx.billingPeriod;
      prev.store = seg.tx.store;
      prev.transactionKeys.push(seg.tx.key);
      prev.lastTx = seg.tx;
      if (seg.tx.source !== prev.source && seg.tx.source === 'revenuecat_api') prev.source = 'revenuecat_api';
      continue;
    }

    // A new run starting before the previous one ends replaces it (plan change).
    if (prev && seg.startAt < prev.endAt) prev.endAt = seg.startAt;

    let startReason: StartReason = seg.kind === 'trial' ? 'new_trial' : 'new';
    const lastPaid = [...drafts].reverse().find((d) => d.kind === 'paid');
    if (prev) {
      if (prev.kind === 'trial' && seg.kind === 'paid' && gap <= conversionWindowMs) {
        startReason = 'trial_conversion';
        prev.endReason = 'trial_converted';
      } else if (prev.kind === 'paid' && seg.kind === 'paid' && gap <= MERGE_GAP_MS && prev.plan !== seg.plan) {
        startReason = PLAN_RANK[seg.plan] > PLAN_RANK[prev.plan] ? 'upgrade' : 'downgrade';
        prev.endReason = 'plan_change';
      } else if (seg.kind === 'paid' && lastPaid) {
        startReason = 'reactivation';
      }
    }

    drafts.push({
      userId: input.userId,
      plan: seg.plan,
      kind: seg.kind,
      store: seg.tx.store,
      productId: seg.tx.productId || null,
      billingPeriod: seg.tx.billingPeriod,
      startAt: seg.startAt,
      endAt: seg.endAt,
      isActive: false,
      startReason,
      endReason: null,
      cancelRequestedAt: null,
      isFirstPaid: false,
      transactionKeys: [seg.tx.key],
      source: seg.tx.source,
      country: seg.tx.country ?? input.country ?? null,
      lastTx: seg.tx,
    });
  }

  // Monthly <-> yearly on the same plan merges above (same plan, no gap), so
  // it is never counted as new, upgrade or churn.

  // End reasons, cancellations and activity.
  let firstPaidAt: Date | null = null;
  for (const d of drafts) {
    d.isActive = d.endAt > now && d.startAt <= now;
    if (d.kind === 'paid' && !firstPaidAt) {
      firstPaidAt = d.startAt;
      d.isFirstPaid = true;
    }
    d.cancelRequestedAt = cancellationWithin(input.events, d.startAt, d.endAt);
    if (d.isActive && input.current) {
      const cur = input.current;
      if (cur.cancelledAt && cur.cancelledAt >= d.startAt && cur.willRenew === false) {
        d.cancelRequestedAt = d.cancelRequestedAt ?? cur.cancelledAt;
      }
      if (cur.willRenew === true && d.cancelRequestedAt && String(cur.status) !== 'cancelled') {
        d.cancelRequestedAt = null;
      }
    }
    if (d.endReason || d.isActive || d.endAt > now) continue;
    if (d.kind === 'trial') d.endReason = 'trial_not_converted';
    else if (d.lastTx.refunded) d.endReason = 'refund';
    else if (involuntaryEnd(input.events, d)) d.endReason = 'involuntary';
    else if (d.cancelRequestedAt) d.endReason = 'voluntary';
    // Auto-renew switched off before the end means the customer cancelled.
    else if (d.lastTx.autoRenewalStatus === 'will_not_renew') d.endReason = 'voluntary';
    else d.endReason = 'unknown';
  }
  // A trial that ended but whose conversion window is still open is pending,
  // not failed.
  for (const d of drafts) {
    if (d.kind === 'trial' && d.endReason === 'trial_not_converted' && now.getTime() - d.endAt.getTime() < conversionWindowMs) {
      d.endReason = null;
    }
  }

  const compedPeriods: SubscriptionPeriodRecord[] = input.comped
    .filter((c) => c.endAt > c.startAt)
    .map((c) => ({
      userId: input.userId,
      plan: c.plan,
      kind: 'comped' as const,
      store: 'manual' as StoreKey,
      productId: null,
      billingPeriod: null,
      startAt: c.startAt,
      endAt: c.endAt,
      isActive: c.startAt <= now && c.endAt > now,
      startReason: 'comped' as const,
      endReason: c.endAt <= now ? ('comped_ended' as const) : null,
      cancelRequestedAt: null,
      isFirstPaid: false,
      transactionKeys: [],
      source: c.source,
      country: input.country ?? null,
    }));

  // Billing-issue windows: from a BILLING_ISSUE event until the user pays
  // again, access lapses for good, or 16 days pass.
  const billingIssueWindows: Array<{ startAt: Date; endAt: Date }> = [];
  const sortedEvents = [...input.events].sort((a, b) => a.at.getTime() - b.at.getTime());
  for (const e of sortedEvents) {
    if (e.type !== 'BILLING_ISSUE') continue;
    const resolved = sortedEvents.find(
      (n) => n.at > e.at && ['RENEWAL', 'INITIAL_PURCHASE', 'PRODUCT_CHANGE', 'UNCANCELLATION', 'EXPIRATION'].includes(n.type),
    );
    const cap = new Date(e.at.getTime() + BILLING_ISSUE_MAX_MS);
    billingIssueWindows.push({ startAt: e.at, endAt: resolved && resolved.at < cap ? resolved.at : cap });
  }

  const periods = [...drafts.map(({ lastTx: _lastTx, ...rest }) => rest), ...compedPeriods].sort(
    (a, b) => a.startAt.getTime() - b.startAt.getTime(),
  );
  return { userId: input.userId, periods, transactions, billingIssueWindows, firstPaidAt };
}

// ---------------------------------------------------------------------------
// Daily states
// ---------------------------------------------------------------------------

function mrrFor(tx: NormalizedTransaction | undefined) {
  if (!tx || tx.kind !== 'paid') return { gross: null, exTax: null, net: null };
  const months = monthsInPeriod(tx.billingPeriod, tx.startAt, tx.endAt);
  const g = tx.aud.gross;
  const t = tx.aud.tax;
  const p = tx.aud.proceeds;
  return {
    gross: g === null ? null : round2(g / months),
    exTax: g === null ? null : round2((g - (t ?? 0)) / months),
    net: p === null ? null : round2(p / months),
  };
}

/**
 * One row per reporting day the user held a non-free state, evaluated at end
 * of day — or at `asOf` for a day that has not finished yet (today), so a
 * subscription that expires later today still counts as paid now.
 */
export function buildDailyStates(
  history: UserHistory,
  fromKey: string,
  toKey: string,
  tz: string,
  asOf?: Date,
): DailyStateRecord[] {
  const rows: DailyStateRecord[] = [];
  const txByKey = new Map(history.transactions.map((t) => [t.key, t]));
  const firstPaidDate = history.firstPaidAt ? history.firstPaidAt : null;

  for (const date of dayKeysBetween(fromKey, toKey)) {
    const endOfDay = endOfDayInTz(date, tz);
    const t = asOf && asOf < endOfDay ? asOf : endOfDay;
    const covering = (kind: PeriodKind) =>
      history.periods.find((p) => p.kind === kind && p.startAt <= t && p.endAt > t);

    const paid = covering('paid');
    if (paid) {
      const tx = paid.transactionKeys
        .map((k) => txByKey.get(k))
        .filter((x): x is NormalizedTransaction => !!x && x.startAt <= t)
        .sort((a, b) => b.startAt.getTime() - a.startAt.getTime())[0];
      const mrr = mrrFor(tx);
      const cancelling = !!paid.cancelRequestedAt && paid.cancelRequestedAt <= t;
      rows.push({
        date,
        userId: history.userId,
        state: cancelling ? 'paid_cancelling' : 'paid',
        plan: paid.plan,
        billingPeriod: tx?.billingPeriod ?? paid.billingPeriod,
        store: paid.store,
        mrrGrossAud: mrr.gross,
        mrrExTaxAud: mrr.exTax,
        mrrNetAud: mrr.net,
        firstPaidDate: firstPaidDate ? firstPaidDate.toISOString() : null,
        source: tx?.source ?? paid.source,
      });
      continue;
    }

    const issue = history.billingIssueWindows.find((w) => w.startAt <= t && w.endAt > t);
    const lastPaid = [...history.periods].reverse().find((p) => p.kind === 'paid' && p.endAt <= t);
    if (issue && lastPaid) {
      rows.push({
        date,
        userId: history.userId,
        state: 'billing_issue',
        plan: lastPaid.plan,
        billingPeriod: lastPaid.billingPeriod,
        store: lastPaid.store,
        mrrGrossAud: null,
        mrrExTaxAud: null,
        mrrNetAud: null,
        firstPaidDate: firstPaidDate ? firstPaidDate.toISOString() : null,
        source: lastPaid.source,
      });
      continue;
    }

    const trial = covering('trial');
    if (trial) {
      rows.push({
        date,
        userId: history.userId,
        state: 'trial',
        plan: trial.plan,
        billingPeriod: trial.billingPeriod,
        store: trial.store,
        mrrGrossAud: 0,
        mrrExTaxAud: 0,
        mrrNetAud: 0,
        firstPaidDate: firstPaidDate ? firstPaidDate.toISOString() : null,
        source: trial.source,
      });
      continue;
    }

    const comped = covering('comped');
    if (comped) {
      rows.push({
        date,
        userId: history.userId,
        state: 'comped',
        plan: comped.plan,
        billingPeriod: null,
        store: 'manual',
        mrrGrossAud: 0,
        mrrExTaxAud: 0,
        mrrNetAud: 0,
        firstPaidDate: firstPaidDate ? firstPaidDate.toISOString() : null,
        source: comped.source,
      });
    }
  }
  return rows;
}

/** Converts a raw webhook payload into the builder's event shape. */
export function billingEventFromPayload(eventId: string, payload: any): BillingEvent | null {
  if (!payload?.type) return null;
  const at = payload.event_timestamp_ms ? new Date(payload.event_timestamp_ms) : null;
  if (!at) return null;
  return {
    eventId,
    type: String(payload.type).toUpperCase(),
    at,
    productId: payload.product_id ?? null,
    transactionId: payload.transaction_id ?? null,
    originalTransactionId: payload.original_transaction_id ?? null,
    purchasedAt: payload.purchased_at_ms ? new Date(payload.purchased_at_ms) : null,
    expiresAt: payload.expiration_at_ms ? new Date(payload.expiration_at_ms) : null,
    cancelReason: payload.cancel_reason ?? null,
    expirationReason: payload.expiration_reason ?? null,
  };
}
