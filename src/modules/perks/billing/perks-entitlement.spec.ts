import {
  PerksBillingStatus,
  PerksMembershipPlan,
  PerksMembershipStatus,
} from '../../../database/schemas/perks-membership.schema';
import {
  EntitlementInput,
  isFreeRegion,
  resolveEntitlement,
} from './perks-entitlement';

const NOW = new Date('2026-09-01T00:00:00Z');
const CUTOFF = new Date('2026-08-18T00:00:00Z');

const OPTIONS = {
  billingEnabled: true,
  grandfatherBefore: CUTOFF,
  now: NOW,
};

const paid = (overrides: Partial<EntitlementInput> = {}): EntitlementInput => ({
  status: PerksMembershipStatus.ACTIVE,
  plan: PerksMembershipPlan.PAID,
  billingStatus: PerksBillingStatus.ACTIVE,
  stripeSubscriptionId: 'sub_123',
  registeredAt: new Date('2026-08-25T00:00:00Z'),
  accessEndsAt: new Date('2026-09-25T00:00:00Z'),
  ...overrides,
});

describe('isFreeRegion', () => {
  // `country` is stored unnormalised: some rows hold 'IN', others 'India'.
  it.each(['IN', 'in', 'India', 'india', ' India '])(
    'treats %p as India',
    (value) => {
      expect(isFreeRegion(value)).toBe(true);
    },
  );

  it.each(['AU', 'Australia', 'US', '', null, undefined])(
    'treats %p as a paying region',
    (value) => {
      expect(isFreeRegion(value)).toBe(false);
    },
  );
});

describe('resolveEntitlement', () => {
  it('lets India members in without any membership record', () => {
    expect(resolveEntitlement({ country: 'IN' }, null, OPTIONS)).toMatchObject({
      entitled: true,
      reason: 'free_region',
      paymentRequired: false,
    });
  });

  it('requires payment from a new Australian user', () => {
    expect(resolveEntitlement({ country: 'AU' }, null, OPTIONS)).toMatchObject({
      entitled: false,
      reason: 'none',
      paymentRequired: true,
    });
  });

  it('grandfathers members who joined before the cutoff', () => {
    const membership = {
      status: PerksMembershipStatus.ACTIVE,
      plan: PerksMembershipPlan.FREE,
      registeredAt: new Date('2026-08-01T00:00:00Z'),
    };
    expect(
      resolveEntitlement({ country: 'AU' }, membership, OPTIONS).reason,
    ).toBe('grandfathered');
  });

  it('does not grandfather someone who joined after the cutoff', () => {
    const membership = {
      status: PerksMembershipStatus.ACTIVE,
      plan: PerksMembershipPlan.FREE,
      registeredAt: new Date('2026-08-20T00:00:00Z'),
    };
    expect(
      resolveEntitlement({ country: 'AU' }, membership, OPTIONS),
    ).toMatchObject({ entitled: false, paymentRequired: true });
  });

  it('never grandfathers a paid member back into free access after they lapse', () => {
    // Joined long ago, later started paying, now cancelled and out of period.
    const membership = paid({
      registeredAt: new Date('2026-01-01T00:00:00Z'),
      billingStatus: PerksBillingStatus.CANCELED,
      accessEndsAt: new Date('2026-08-30T00:00:00Z'),
    });
    expect(
      resolveEntitlement({ country: 'AU' }, membership, OPTIONS),
    ).toMatchObject({ entitled: false, reason: 'none' });
  });

  it('admits an active paid subscription', () => {
    expect(resolveEntitlement({ country: 'AU' }, paid(), OPTIONS).reason).toBe(
      'paid',
    );
  });

  it('keeps access after cancelling until the paid period ends', () => {
    const cancelling = paid({
      billingStatus: PerksBillingStatus.CANCELED,
      accessEndsAt: new Date('2026-09-25T00:00:00Z'),
    });
    expect(resolveEntitlement({ country: 'AU' }, cancelling, OPTIONS)).toMatchObject(
      { entitled: true, reason: 'paid' },
    );
  });

  it('locks out a paid member once the period has passed', () => {
    const lapsed = paid({
      billingStatus: PerksBillingStatus.CANCELED,
      accessEndsAt: new Date('2026-08-30T00:00:00Z'),
    });
    expect(
      resolveEntitlement({ country: 'AU' }, lapsed, OPTIONS).paymentRequired,
    ).toBe(true);
  });

  it('keeps a past_due member in while Stripe retries their card', () => {
    const pastDue = paid({ billingStatus: PerksBillingStatus.PAST_DUE });
    expect(resolveEntitlement({ country: 'AU' }, pastDue, OPTIONS).entitled).toBe(
      true,
    );
  });

  it('does not admit an incomplete subscription — payment never landed', () => {
    const incomplete = paid({
      billingStatus: PerksBillingStatus.INCOMPLETE,
      accessEndsAt: null,
    });
    expect(
      resolveEntitlement({ country: 'AU' }, incomplete, OPTIONS).entitled,
    ).toBe(false);
  });

  it('lets everyone in while the kill switch is off', () => {
    expect(
      resolveEntitlement({ country: 'AU' }, null, {
        ...OPTIONS,
        billingEnabled: false,
      }),
    ).toMatchObject({ entitled: true, reason: 'billing_disabled' });
  });

  it('does not grandfather anyone when no cutoff is configured', () => {
    const membership = {
      status: PerksMembershipStatus.ACTIVE,
      plan: PerksMembershipPlan.FREE,
      registeredAt: new Date('2020-01-01T00:00:00Z'),
    };
    expect(
      resolveEntitlement({ country: 'AU' }, membership, {
        ...OPTIONS,
        grandfatherBefore: null,
      }).entitled,
    ).toBe(false);
  });
});
