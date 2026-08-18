import { normalizeCountry } from '../../../utils/countries.util';
import {
  PerksBillingStatus,
  PerksMembershipPlan,
  PerksMembershipStatus,
} from '../../../database/schemas/perks-membership.schema';

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
  billingEnabled: boolean;
  grandfatherBefore: Date | null;
  now?: Date;
}

export interface Entitlement {
  entitled: boolean;
  reason: EntitlementReason;
  paymentRequired: boolean;
}

export function isFreeRegion(country?: string | null): boolean {
  const normalised = normalizeCountry(country ?? undefined);
  return normalised ? FREE_REGIONS.has(normalised) : false;
}

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
  if (membership.plan === PerksMembershipPlan.PAID) return false;
  return membership.registeredAt.getTime() < cutoff.getTime();
}

function hasPaidAccess(membership: EntitlementInput, now: Date): boolean {
  if (membership.plan !== PerksMembershipPlan.PAID) return false;

  if (
    membership.billingStatus === PerksBillingStatus.ACTIVE ||
    membership.billingStatus === PerksBillingStatus.PAST_DUE
  ) {
    return true;
  }

  return Boolean(
    membership.accessEndsAt && membership.accessEndsAt.getTime() > now.getTime(),
  );
}

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
