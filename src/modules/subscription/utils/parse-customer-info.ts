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
  expires_date?: string | null;
  expirationDate?: string | null;
  purchase_date?: string;
  latest_purchase_date?: string;
  period_type?: string;
  periodType?: string;
  store?: string;
  will_renew?: boolean;
  willRenew?: boolean;
  unsubscribe_detected_at?: string | null;
  billing_issues_detected_at?: string | null;
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
}

function toDate(value?: string | null): Date | undefined {
  if (!value) return undefined;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? undefined : d;
}


export function parseCustomerInfo(
  customerInfo: Record<string, any> | undefined | null,
  entitlementId: string = SAVEFUL_ENTITLEMENT,
): ParsedSubscription {
  if (!customerInfo) {
    return { plan: 'basic', status: 'expired', willRenew: false };
  }

  const entitlements =
    customerInfo.entitlements?.active ??
    customerInfo.entitlements ??
    {};

  const ent: ActiveEntitlement | undefined =
    entitlements?.[entitlementId] ??
    entitlements?.all?.[entitlementId] ??
    undefined;

  if (!ent) {
    return { plan: 'basic', status: 'expired', willRenew: false };
  }

  const productId: string | undefined =
    ent.product_identifier || ent.productIdentifier;

  let plan: SubscriptionPlan = 'basic';
  if (productId) {
    if (PRODUCT_TO_PLAN[productId]) {
      plan = PRODUCT_TO_PLAN[productId];
    } else {
      const rule = PLAN_PREFIX_RULES.find((r) => r.match.test(productId));
      if (rule) plan = rule.plan;
    }
  }

  const expiresAt = toDate(ent.expires_date ?? ent.expirationDate ?? null);
  const purchasedAt = toDate(ent.latest_purchase_date ?? ent.purchase_date);
  const periodType = ent.periodType ?? ent.period_type;
  const willRenew = ent.willRenew ?? ent.will_renew ?? false;
  const cancelledAt = toDate(ent.unsubscribe_detected_at ?? null);

  const now = Date.now();
  let status: SubscriptionStatus = 'active';
  if (expiresAt && expiresAt.getTime() < now) {
    status = 'expired';
  } else if (periodType === 'trial' || periodType === 'intro') {
    status = 'in_trial';
  } else if (cancelledAt) {
    status = 'cancelled';
  }

  const trialEndsAt =
    periodType === 'trial' || periodType === 'intro' ? expiresAt : undefined;

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
  };
}
