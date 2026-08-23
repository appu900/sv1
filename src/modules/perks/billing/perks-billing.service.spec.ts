import Stripe = require('stripe');
import {
  PerksBillingStatus,
  PerksMembershipPlan,
  PerksMembershipStatus,
} from '../../../database/schemas/perks-membership.schema';
import { PerksBillingService } from './perks-billing.service';

const USER_ID = '507f1f77bcf86cd799439011';

function membershipDoc(overrides: Record<string, unknown> = {}) {
  const doc: Record<string, unknown> = {
    userId: USER_ID,
    email: 'tester@saveful.com',
    status: PerksMembershipStatus.PENDING,
    plan: PerksMembershipPlan.FREE,
    billingStatus: PerksBillingStatus.NONE,
    cancelAtPeriodEnd: false,
    accessEndsAt: null,
    registeredAt: null,
    stripeCustomerId: null,
    stripeSubscriptionId: null,
    lastStripeEventId: null,
    lastStripeEventAt: null,
    credentialVersion: 1,
    save: jest.fn(async () => doc),
    toObject: () => ({ ...doc }),
    ...overrides,
  };
  return doc;
}

function createService(overrides: Record<string, unknown> = {}) {
  const membership = (overrides.membership as Record<string, unknown>) ?? membershipDoc();

  const membershipModel = {
    findOne: jest.fn().mockResolvedValue(membership),
    create: jest.fn().mockResolvedValue(membership),
    ...(overrides.membershipModel as object),
  };
  const membershipEventModel = {
    create: jest.fn().mockResolvedValue({}),
  };
  const userModel = {
    findById: jest.fn().mockReturnValue({
      lean: jest.fn().mockResolvedValue({
        _id: USER_ID,
        email: 'Tester@Saveful.com',
        name: 'Saveful Tester',
        country: 'AU',
        pincode: '5000',
        phoneNumber: '0400000000',
        gender: 'male',
      }),
    }),
  };
  const healthProfileModel = {
    findOne: jest.fn().mockReturnValue({
      select: jest.fn().mockReturnValue({ lean: jest.fn().mockResolvedValue(null) }),
    }),
  };
  const stripe = {
    configured: true,
    createCheckoutSession: jest.fn().mockResolvedValue({
      url: 'https://checkout.stripe.com/c/pay/cs_test_1',
      customerId: 'cus_123',
    }),
    findCustomerIds: jest.fn().mockResolvedValue([]),
    findActiveSubscription: jest.fn().mockResolvedValue(null),
    createPortalSession: jest.fn().mockResolvedValue('https://billing.stripe.com/p/1'),
    getSubscription: jest.fn().mockResolvedValue({ status: 'active' }),
    setCancelAtPeriodEnd: jest.fn().mockResolvedValue({
      items: { data: [{ current_period_end: 1790000000 }] },
    }),
    ...(overrides.stripe as object),
  };
  const session = {
    missingProfileFields: jest.fn().mockReturnValue([]),
  };
  const config = {
    get: jest.fn((key: string, fallback: unknown) => {
      const values: Record<string, unknown> = {
        PERKS_BILLING_ENABLED: 'true',
        PERKS_BILLING_GRANDFATHER_BEFORE: '2026-08-18T00:00:00Z',
        ...(overrides.config as object),
      };
      return key in values ? values[key] : fallback;
    }),
  };

  return {
    service: new PerksBillingService(
      membershipModel as never,
      membershipEventModel as never,
      userModel as never,
      healthProfileModel as never,
      stripe as never,
      session as never,
      config as never,
    ),
    membership,
    membershipModel,
    membershipEventModel,
    stripe,
    session,
  };
}

function event(
  type: string,
  object: Record<string, unknown>,
  overrides: Record<string, unknown> = {},
): Stripe.Event {
  return {
    id: 'evt_1',
    type,
    created: Math.floor(new Date('2026-09-01T00:00:00Z').getTime() / 1000),
    data: { object },
    ...overrides,
  } as unknown as Stripe.Event;
}

const subscription = (overrides: Record<string, unknown> = {}) => ({
  id: 'sub_123',
  customer: 'cus_123',
  status: 'active',
  cancel_at_period_end: false,
  metadata: { savefulUserId: USER_ID, savefulProduct: 'perks_membership' },
  items: { data: [{ current_period_end: 1790000000 }] },
  ...overrides,
});

describe('PerksBillingService', () => {
  describe('startCheckout', () => {
    it('returns a Stripe URL and records that checkout began', async () => {
      const { service, membershipEventModel, stripe } = createService();

      await expect(service.startCheckout(USER_ID)).resolves.toEqual({
        checkoutUrl: 'https://checkout.stripe.com/c/pay/cs_test_1',
      });
      expect(stripe.createCheckoutSession).toHaveBeenCalledWith(
        expect.objectContaining({ userId: USER_ID, email: 'tester@saveful.com' }),
      );
      expect(membershipEventModel.create).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'billing_checkout_started' }),
      );
    });

    // Only the webhook recorded the customer id before this, so every abandoned
    // checkout minted another Stripe customer for the same person — one live
    // account accumulated three, and none of them was on the membership.
    it('records the Stripe customer before sending the member to pay', async () => {
      const pending = membershipDoc({ stripeCustomerId: null });
      const { service } = createService({
        membershipModel: { findOne: jest.fn().mockResolvedValue(pending) },
      });

      await service.startCheckout(USER_ID);

      expect(pending.stripeCustomerId).toBe('cus_123');
      expect(pending.save).toHaveBeenCalled();
    });

    // The member has paid and the webhook never landed. A 402 here sends the
    // app straight back to Stripe, so without this the cure is a second charge.
    it('refuses to charge again when Stripe says the member already pays', async () => {
      const pending = membershipDoc({ stripeCustomerId: 'cus_123' });
      const { service, stripe } = createService({
        membershipModel: { findOne: jest.fn().mockResolvedValue(pending) },
        stripe: {
          findActiveSubscription: jest.fn().mockResolvedValue(subscription()),
        },
      });

      await expect(service.startCheckout(USER_ID)).rejects.toMatchObject({
        response: { code: 'PERKS_BILLING_NOT_REQUIRED' },
      });
      expect(stripe.createCheckoutSession).not.toHaveBeenCalled();
      expect(pending.plan).toBe('paid');
    });
  });

  describe('reconcileFromStripe', () => {
    it('finds the subscription even when our record has no customer id', async () => {
      const pending = membershipDoc({ stripeCustomerId: null });
      const { service } = createService({
        stripe: {
          findCustomerIds: jest.fn().mockResolvedValue(['cus_abandoned', 'cus_123']),
          findActiveSubscription: jest
            .fn()
            .mockImplementation(async (id: string) =>
              id === 'cus_123' ? subscription() : null,
            ),
        },
      });

      await expect(service.reconcileFromStripe(pending as never)).resolves.toBe(
        true,
      );
      expect(pending.stripeCustomerId).toBe('cus_123');
      expect(pending.stripeSubscriptionId).toBe('sub_123');
      expect(pending.plan).toBe('paid');
    });

    it('stays false, and never throws, when Stripe is unreachable', async () => {
      const pending = membershipDoc({ stripeCustomerId: 'cus_123' });
      const { service } = createService({
        stripe: {
          findActiveSubscription: jest
            .fn()
            .mockRejectedValue(new Error('Stripe is down')),
        },
      });

      await expect(service.reconcileFromStripe(pending as never)).resolves.toBe(
        false,
      );
    });

    it('leaves an unpaid member unpaid', async () => {
      const pending = membershipDoc({ stripeCustomerId: 'cus_123' });
      const { service } = createService();

      await expect(service.reconcileFromStripe(pending as never)).resolves.toBe(
        false,
      );
      expect(pending.plan).not.toBe('paid');
    });

    it('refuses to charge before the profile is complete', async () => {
      const { service, stripe } = createService();
      (service as never as { session: { missingProfileFields: jest.Mock } }).session.missingProfileFields.mockReturnValue(
        ['phone'],
      );

      await expect(service.startCheckout(USER_ID)).rejects.toMatchObject({
        status: 422,
      });
      expect(stripe.createCheckoutSession).not.toHaveBeenCalled();
    });

    it('will not charge a member who is already entitled', async () => {
      const { service, stripe } = createService({
        membership: membershipDoc({
          status: PerksMembershipStatus.ACTIVE,
          plan: PerksMembershipPlan.PAID,
          billingStatus: PerksBillingStatus.ACTIVE,
        }),
      });

      await expect(service.startCheckout(USER_ID)).rejects.toMatchObject({
        status: 409,
      });
      expect(stripe.createCheckoutSession).not.toHaveBeenCalled();
    });
  });

  describe('applyWebhookEvent', () => {
    it('activates a membership when checkout is paid', async () => {
      const { service, membership } = createService();

      const outcome = await service.applyWebhookEvent(
        event('checkout.session.completed', {
          client_reference_id: USER_ID,
          customer: 'cus_123',
          subscription: 'sub_123',
          payment_status: 'paid',
          metadata: { savefulProduct: 'perks_membership' },
        }),
      );

      expect(outcome).toEqual({ handled: true, activatedUserId: USER_ID });
      expect(membership.plan).toBe(PerksMembershipPlan.PAID);
      expect(membership.billingStatus).toBe(PerksBillingStatus.ACTIVE);
      expect(membership.stripeSubscriptionId).toBe('sub_123');
    });

    it('does not activate when the session completed unpaid', async () => {
      const { service, membership } = createService();

      const outcome = await service.applyWebhookEvent(
        event('checkout.session.completed', {
          client_reference_id: USER_ID,
          customer: 'cus_123',
          subscription: 'sub_123',
          payment_status: 'unpaid',
          metadata: { savefulProduct: 'perks_membership' },
        }),
      );

      expect(outcome.activatedUserId).toBeNull();
      expect(membership.plan).toBe(PerksMembershipPlan.FREE);
    });

    it('is idempotent — a replayed event changes nothing', async () => {
      const { service, membership } = createService({
        membership: membershipDoc({ lastStripeEventId: 'evt_1' }),
      });

      const outcome = await service.applyWebhookEvent(
        event('checkout.session.completed', {
          client_reference_id: USER_ID,
          payment_status: 'paid',
          metadata: { savefulProduct: 'perks_membership' },
        }),
      );

      expect(outcome).toEqual({ handled: false, activatedUserId: null });
      expect(membership.save).not.toHaveBeenCalled();
    });

    it('ignores an event older than the last one applied', async () => {
      const { service, membership } = createService({
        membership: membershipDoc({
          lastStripeEventId: 'evt_9',
          lastStripeEventAt: new Date('2026-09-02T00:00:00Z'),
          plan: PerksMembershipPlan.PAID,
          billingStatus: PerksBillingStatus.ACTIVE,
        }),
      });

      // A late-delivered cancellation from before the current state.
      const outcome = await service.applyWebhookEvent(
        event('customer.subscription.updated', subscription({ status: 'canceled' })),
      );

      expect(outcome.handled).toBe(false);
      expect(membership.billingStatus).toBe(PerksBillingStatus.ACTIVE);
    });

    it('drops an event for a user we do not know without throwing', async () => {
      const { service } = createService({
        membershipModel: { findOne: jest.fn().mockResolvedValue(null) },
      });

      await expect(
        service.applyWebhookEvent(
          event('customer.subscription.updated', subscription()),
        ),
      ).resolves.toEqual({ handled: false, activatedUserId: null });
    });

    it('marks a failed payment past_due without revoking access', async () => {
      const { service, membership, membershipEventModel } = createService({
        membership: membershipDoc({
          plan: PerksMembershipPlan.PAID,
          billingStatus: PerksBillingStatus.ACTIVE,
          stripeSubscriptionId: 'sub_123',
        }),
      });

      await service.applyWebhookEvent(
        event('invoice.payment_failed', {
          id: 'in_1',
          subscription: 'sub_123',
        }),
      );

      expect(membership.billingStatus).toBe(PerksBillingStatus.PAST_DUE);
      expect(membershipEventModel.create).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'billing_payment_failed' }),
      );
    });

    it('keeps a cancelled subscription usable until the period ends', async () => {
      const futureEnd = Math.floor(
        new Date('2099-01-01T00:00:00Z').getTime() / 1000,
      );
      const { service, membership } = createService({
        membership: membershipDoc({
          status: PerksMembershipStatus.ACTIVE,
          plan: PerksMembershipPlan.PAID,
          billingStatus: PerksBillingStatus.ACTIVE,
          stripeSubscriptionId: 'sub_123',
        }),
      });

      await service.applyWebhookEvent(
        event(
          'customer.subscription.deleted',
          subscription({
            status: 'canceled',
            items: { data: [{ current_period_end: futureEnd }] },
          }),
        ),
      );

      expect(membership.status).toBe(PerksMembershipStatus.ACTIVE);
      expect(membership.billingStatus).toBe(PerksBillingStatus.CANCELED);
    });

    it('locks the membership once the cancelled period has passed', async () => {
      const pastEnd = Math.floor(
        new Date('2026-08-01T00:00:00Z').getTime() / 1000,
      );
      const { service, membership, membershipEventModel } = createService({
        membership: membershipDoc({
          status: PerksMembershipStatus.ACTIVE,
          plan: PerksMembershipPlan.PAID,
          billingStatus: PerksBillingStatus.ACTIVE,
          stripeSubscriptionId: 'sub_123',
        }),
      });

      await service.applyWebhookEvent(
        event(
          'customer.subscription.deleted',
          subscription({
            status: 'canceled',
            items: { data: [{ current_period_end: pastEnd }] },
          }),
        ),
      );

      expect(membership.status).toBe(PerksMembershipStatus.CANCELLED);
      expect(membershipEventModel.create).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'billing_lapsed' }),
      );
    });

    it('ignores another product on the shared Stripe account', async () => {
      const { service, membership } = createService();

      const outcome = await service.applyWebhookEvent(
        event('checkout.session.completed', {
          client_reference_id: USER_ID,
          customer: 'cus_other',
          subscription: 'sub_other',
          payment_status: 'paid',
          metadata: { savefulProduct: 'saveful_hero' },
        }),
      );

      expect(outcome).toEqual({ handled: false, activatedUserId: null });
      expect(membership.plan).toBe(PerksMembershipPlan.FREE);
      expect(membership.save).not.toHaveBeenCalled();
    });

    it('ignores an untagged subscription for a different price', async () => {
      const { service, membership } = createService();

      const outcome = await service.applyWebhookEvent(
        event(
          'customer.subscription.updated',
          subscription({
            id: 'sub_other',
            metadata: { savefulUserId: USER_ID },
            items: { data: [{ price: { id: 'price_other_product' } }] },
          }),
        ),
      );

      expect(outcome.handled).toBe(false);
      expect(membership.save).not.toHaveBeenCalled();
    });

    it('accepts an untagged subscription that carries our price', async () => {
      const { service } = createService({
        stripe: { perksPriceId: 'price_perks_1' },
      });

      const outcome = await service.applyWebhookEvent(
        event(
          'customer.subscription.updated',
          subscription({
            metadata: { savefulUserId: USER_ID },
            items: {
              data: [
                { price: { id: 'price_perks_1' }, current_period_end: 1790000000 },
              ],
            },
          }),
        ),
      );

      expect(outcome.handled).toBe(true);
    });

    it('ignores event types it does not handle', async () => {
      const { service } = createService();
      await expect(
        service.applyWebhookEvent(event('customer.created', { id: 'cus_1' })),
      ).resolves.toEqual({ handled: false, activatedUserId: null });
    });
  });

  describe('scheduleCancellation', () => {
    it('stops the renewal and keeps access to the period end', async () => {
      const { service, membership, stripe } = createService({
        membership: membershipDoc({
          plan: PerksMembershipPlan.PAID,
          stripeSubscriptionId: 'sub_123',
        }),
      });

      const result = await service.scheduleCancellation(USER_ID, 'too pricey');

      expect(stripe.setCancelAtPeriodEnd).toHaveBeenCalledWith('sub_123', true);
      expect(result).not.toBeNull();
      expect(membership.cancelAtPeriodEnd).toBe(true);
      expect(membership.accessEndsAt).toBeInstanceOf(Date);
    });

    it('returns null for a member with no subscription, so the caller cancels locally', async () => {
      const { service, stripe } = createService();
      await expect(service.scheduleCancellation(USER_ID, null)).resolves.toBeNull();
      expect(stripe.setCancelAtPeriodEnd).not.toHaveBeenCalled();
    });
  });

  describe('resumeSubscription', () => {
    it('calls off a pending cancellation', async () => {
      const { service, membership, stripe } = createService({
        membership: membershipDoc({
          plan: PerksMembershipPlan.PAID,
          stripeSubscriptionId: 'sub_123',
          cancelAtPeriodEnd: true,
        }),
      });

      await expect(service.resumeSubscription(USER_ID)).resolves.not.toBeNull();
      expect(stripe.setCancelAtPeriodEnd).toHaveBeenCalledWith('sub_123', false);
      expect(membership.cancelAtPeriodEnd).toBe(false);
    });

    it('cannot resume a subscription Stripe has already cancelled', async () => {
      const { service } = createService({
        membership: membershipDoc({
          plan: PerksMembershipPlan.PAID,
          stripeSubscriptionId: 'sub_123',
          cancelAtPeriodEnd: true,
        }),
        stripe: {
          getSubscription: jest.fn().mockResolvedValue({ status: 'canceled' }),
        },
      });

      await expect(service.resumeSubscription(USER_ID)).resolves.toBeNull();
    });
  });

  describe('billing kill switch', () => {
    it('treats billing as off when Stripe is not configured', () => {
      const { service } = createService({ stripe: { configured: false } });
      expect(service.billingEnabled).toBe(false);
      expect(
        service.entitlementFor({ country: 'AU' }, null).entitled,
      ).toBe(true);
    });
  });
});
