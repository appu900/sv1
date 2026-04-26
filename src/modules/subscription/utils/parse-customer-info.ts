import {
  SAVEFUL_ENTITLEMENT,
  PRODUCT_TO_PLAN,
  PLAN_PREFIX_RULES,
  SubscriptionPlan,
  SubscriptionStatus,
} from '../subscription.constants';

interface ActiveEntitlement {
  identifier?: string;
  product_identifier?: string;
  productIdentifier?: string;
  auto_renewal_status?: string | null;
  autoRenewalStatus?: string | null;
  expires_date?: string | null;
  expirationDate?: string | null;
  purchase_date?: string;
  purchaseDate?: string;
  latest_purchase_date?: string;
  latestPurchaseDate?: string;
  period_type?: string;
  periodType?: string;
  store?: string;
  will_renew?: boolean;
  willRenew?: boolean;
  unsubscribe_detected_at?: string | null;
  unsubscribeDetectedAt?: string | null;
  billing_issues_detected_at?: string | null;
  billingIssueDetectedAt?: string | null;
}

export interface ParsedSubscription {
  plan: SubscriptionPlan;
  status: SubscriptionStatus;
  entitlement?: string;
  productId?: string;
  store?: string;
  periodType?: string;
  purchasedAt?: Date;
  expiresAt?: Date;
  trialEndsAt?: Date;
  willRenew: boolean;
  cancelledAt?: Date;
  /** True when the user cancelled while still inside a free trial / intro. */
  trialCancelled?: boolean;
}

const RENEWING_AUTO_RENEWAL_STATUSES = new Set([
  'will_renew',
  'will_change_product',
  'has_already_renewed',
]);

function toDate(value?: string | null): Date | undefined {
  if (!value) return undefined;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? undefined : d;
}

export function parseCustomerInfo(
  customerInfo: Record<string, any> | undefined | null,
  entitlementId: string = SAVEFUL_ENTITLEMENT,
  existingPlan?: SubscriptionPlan,
): ParsedSubscription {
  if (!customerInfo) {
    return { plan: 'basic', status: 'expired', willRenew: false };
  }

  const entitlements =
    customerInfo.entitlements?.active ?? customerInfo.entitlements ?? {};

  const ent: ActiveEntitlement | undefined =
    entitlements?.[entitlementId] ??
    entitlements?.all?.[entitlementId] ??
    undefined;

  if (!ent) {
    return { plan: 'basic', status: 'expired', willRenew: false };
  }

  const productId: string | undefined =
    ent.product_identifier || ent.productIdentifier;

  let plan: SubscriptionPlan | undefined;
  if (productId) {
    if (PRODUCT_TO_PLAN[productId]) {
      plan = PRODUCT_TO_PLAN[productId];
    } else {
      const rule = PLAN_PREFIX_RULES.find((r) => r.match.test(productId));
      if (rule) plan = rule.plan;
    }
  }
  if (!plan) {
    plan =
      existingPlan && existingPlan !== 'basic' ? existingPlan : 'hero';
  }

  const expiresAt = toDate(ent.expires_date ?? ent.expirationDate ?? null);
  const purchasedAt = toDate(
    ent.latest_purchase_date ??
      ent.latestPurchaseDate ??
      ent.purchase_date ??
      ent.purchaseDate,
  );
  const rawPeriodType = ent.periodType ?? ent.period_type;
  const periodType =
    typeof rawPeriodType === 'string'
      ? rawPeriodType.toLowerCase()
      : rawPeriodType;
  const isTrialPeriod = periodType === 'trial' || periodType === 'intro';
  const rawAutoRenewalStatus = ent.autoRenewalStatus ?? ent.auto_renewal_status;
  const autoRenewalStatus =
    typeof rawAutoRenewalStatus === 'string'
      ? rawAutoRenewalStatus.toLowerCase()
      : undefined;
  const explicitNonRenewingStatus = autoRenewalStatus
    ? !RENEWING_AUTO_RENEWAL_STATUSES.has(autoRenewalStatus)
    : false;
  const rawWillRenew = ent.willRenew ?? ent.will_renew;
  let willRenew =
    rawWillRenew ??
    (autoRenewalStatus ? !explicitNonRenewingStatus : undefined) ??
    true;
  let cancelledAt = toDate(
    ent.unsubscribe_detected_at ?? ent.unsubscribeDetectedAt ?? null,
  );

  const now = Date.now();
  const isExpired = !!expiresAt && expiresAt.getTime() < now;
  const hasBareWillRenewCancelSignal = rawWillRenew === false && !isTrialPeriod;
  if (
    !cancelledAt &&
    !isExpired &&
    (explicitNonRenewingStatus || hasBareWillRenewCancelSignal)
  ) {
    cancelledAt = new Date(now);
  }
  if (isTrialPeriod && rawWillRenew === false && !cancelledAt) {
    // Google closed-testing trials can report will_renew=false before the
    // trial actually ends. Do not let that ambiguous flag alone downgrade an
    // active trial to Basic; real trial cancellation must carry either an
    // unsubscribe timestamp or explicit non-renewing auto_renewal_status.
    willRenew = true;
  }

  let status: SubscriptionStatus = 'active';
  if (isExpired) {
    status = 'expired';
  } else if (cancelledAt) {
    status = 'cancelled';
  } else if (periodType === 'trial' || periodType === 'intro') {
    status = 'in_trial';
  }

  const trialEndsAt = isTrialPeriod ? expiresAt : undefined;

  const trialCancelled =
    !!cancelledAt && !willRenew && isTrialPeriod;

  return {
    plan: status === 'expired' ? 'basic' : plan,
    status,
    entitlement: entitlementId,
    productId,
    store: ent.store,
    periodType,
    purchasedAt,
    expiresAt,
    trialEndsAt,
    willRenew,
    cancelledAt,
    trialCancelled,
  };
}
