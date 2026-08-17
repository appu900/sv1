import { normalizeCountry } from '../../../utils/countries.util';
import {
  PerksBillingStatus,
  PerksMembershipPlan,
  PerksMembershipStatus,
} from '../../../database/schemas/perks-membership.schema';

/** Regions where Perks membership costs nothing. Canonical names, not codes. */
const FREE_REGIONS = new Set(['India']);

export type EntitlementReason =
  | 'paid'
  | 'free_region'
  | 'grandfathered'
  | 'billing_disabled'
  | 'none';

export interface EntitlementInput {
  status?: PerksMembershipStatus;
  plan?: PerksMembershipPlan;
  billingStatus?: PerksBillingStatus;
  accessEndsAt?: Date | null;
  registeredAt?: Date | null;
  stripeSubscriptionId?: string | null;
}

export interface EntitlementOptions {
  /** Kill switch: false means nobody is charged and everybody is entitled. */
  billingEnabled: boolean;
  /**
   * Members who registered before this instant keep free access forever.
   * Compared against `registeredAt` rather than "has no Stripe id", which
   * would also hand permanent free access to anyone who later cancels.
   */
  grandfatherBefore: Date | null;
  now?: Date;
}

export interface Entitlement {
  entitled: boolean;
  reason: EntitlementReason;
  /** True when the user must pay before Perks will do anything for them. */
  paymentRequired: boolean;
}

export function isFreeRegion(country?: string | null): boolean {
  const normalised = normalizeCountry(country ?? undefined);
  return normalised ? FREE_REGIONS.has(normalised) : false;
}

/**
 * The single answer to "may this user use Perks?".
 *
 * Deliberately pure: every caller (join, cart, quote, checkout) reads the same
 * verdict, and the whole matrix is testable without Stripe or Mongo.
 */
export function resolveEntitlement(
  user: { country?: string | null } | null,
  membership: EntitlementInput | null,
  options: EntitlementOptions,
): Entitlement {
  const entitled = (reason: EntitlementReason): Entitlement => ({
    entitled: true,
    reason,
    paymentRequired: false,
  });

  if (!options.billingEnabled) return entitled('billing_disabled');
  if (isFreeRegion(user?.country)) return entitled('free_region');

  if (membership) {
    if (isGrandfathered(membership, options.grandfatherBefore)) {
      return entitled('grandfathered');
    }
    if (hasPaidAccess(membership, options.now ?? new Date())) {
      return entitled('paid');
    }
  }

  return { entitled: false, reason: 'none', paymentRequired: true };
}

function isGrandfathered(
  membership: EntitlementInput,
  cutoff: Date | null,
): boolean {
  if (!cutoff || !membership.registeredAt) return false;
  // Only ever applies to someone who was actually a member before the cutoff;
  // a lapsed paid member is not grandfathered by their original join date.
  if (membership.plan === PerksMembershipPlan.PAID) return false;
  return membership.registeredAt.getTime() < cutoff.getTime();
}

/**
 * Paid access survives cancellation until the period ends — the member already
 * paid for it. `past_due` also keeps access while Stripe retries the card;
 * Stripe cancels the subscription once its retry schedule is exhausted.
 */
function hasPaidAccess(membership: EntitlementInput, now: Date): boolean {
  if (membership.plan !== PerksMembershipPlan.PAID) return false;

  if (
    membership.billingStatus === PerksBillingStatus.ACTIVE ||
    membership.billingStatus === PerksBillingStatus.PAST_DUE
  ) {
    return true;
  }

  // Cancelled upstream but still inside the paid window.
  return Boolean(
    membership.accessEndsAt && membership.accessEndsAt.getTime() > now.getTime(),
  );
}

/** Human-readable price shown by the app on the join wall. */
export function billingLabel(entitlement: Entitlement): string | null {
  switch (entitlement.reason) {
    case 'free_region':
      return 'Free in your region';
    case 'grandfathered':
      return 'Included on your account';
    case 'paid':
      return 'A$10/month + GST';
    case 'billing_disabled':
      return null;
    default:
      return 'A$10/month + GST';
  }
}
