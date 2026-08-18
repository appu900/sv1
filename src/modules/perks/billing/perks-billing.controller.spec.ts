import Stripe = require('stripe');
import { PerksBillingController } from './perks-billing.controller';
import { PerksBillingError, PerksStripeClient } from './perks-stripe.client';

const WEBHOOK_SECRET = 'whsec_test_secret';

function createController(overrides: Record<string, unknown> = {}) {
  const config = {
    get: jest.fn((key: string, fallback: unknown) => {
      if (key === 'STRIPE_SECRET_KEY') return 'sk_test_123';
      if (key === 'STRIPE_WEBHOOK_SECRET') return WEBHOOK_SECRET;
      return fallback;
    }),
  };
  // The real client, so signature verification is genuinely exercised.
  const stripeClient = new PerksStripeClient(config as never);

  const billing = {
    applyWebhookEvent: jest
      .fn()
      .mockResolvedValue({ handled: true, activatedUserId: null }),
    startCheckout: jest
      .fn()
      .mockResolvedValue({ checkoutUrl: 'https://checkout.stripe.com/c/1' }),
    openPortal: jest.fn().mockResolvedValue({ portalUrl: 'https://billing/1' }),
    ...(overrides.billing as object),
  };
  const perksService = {
    completeRegistrationAfterPayment: jest.fn().mockResolvedValue({}),
    ...(overrides.perksService as object),
  };

  return {
    controller: new PerksBillingController(
      billing as never,
      stripeClient,
      perksService as never,
      config as never,
    ),
    billing,
    perksService,
  };
}

function signedPayload(event: Record<string, unknown>) {
  const payload = JSON.stringify(event);
  const signature = Stripe.webhooks.generateTestHeaderString({
    payload,
    secret: WEBHOOK_SECRET,
  });
  return { body: Buffer.from(payload), signature };
}

const CHECKOUT_EVENT = {
  id: 'evt_1',
  type: 'checkout.session.completed',
  created: 1790000000,
  data: {
    object: {
      client_reference_id: 'user_1',
      payment_status: 'paid',
      metadata: { savefulProduct: 'perks_membership' },
    },
  },
};

describe('PerksBillingController webhook', () => {
  it('accepts a correctly signed event', async () => {
    const { controller, billing } = createController();
    const { body, signature } = signedPayload(CHECKOUT_EVENT);

    await expect(
      controller.handleWebhook({} as never, signature, body),
    ).resolves.toEqual({ received: true });

    expect(billing.applyWebhookEvent).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'evt_1' }),
    );
  });

  it('registers with WeMAD once a payment activates the membership', async () => {
    const { controller, perksService } = createController({
      billing: {
        applyWebhookEvent: jest
          .fn()
          .mockResolvedValue({ handled: true, activatedUserId: 'user_1' }),
      },
    });
    const { body, signature } = signedPayload(CHECKOUT_EVENT);

    await controller.handleWebhook({} as never, signature, body);

    expect(perksService.completeRegistrationAfterPayment).toHaveBeenCalledWith(
      'user_1',
    );
  });

  it('still returns 200 when WeMAD registration fails after payment', async () => {
    // Stripe retries non-2xx responses; retrying here would re-deliver an event
    // for money that already moved.
    const { controller } = createController({
      billing: {
        applyWebhookEvent: jest
          .fn()
          .mockResolvedValue({ handled: true, activatedUserId: 'user_1' }),
      },
      perksService: {
        completeRegistrationAfterPayment: jest
          .fn()
          .mockRejectedValue(new Error('WeMAD is down')),
      },
    });
    const { body, signature } = signedPayload(CHECKOUT_EVENT);

    await expect(
      controller.handleWebhook({} as never, signature, body),
    ).resolves.toEqual({ received: true });
  });

  it('rejects a forged signature', async () => {
    const { controller, billing } = createController();
    const { body } = signedPayload(CHECKOUT_EVENT);

    await expect(
      controller.handleWebhook({} as never, 't=1,v1=deadbeef', body),
    ).rejects.toBeInstanceOf(PerksBillingError);
    expect(billing.applyWebhookEvent).not.toHaveBeenCalled();
  });

  it('rejects a payload that was tampered with after signing', async () => {
    const { controller } = createController();
    const { signature } = signedPayload(CHECKOUT_EVENT);
    const tampered = Buffer.from(
      JSON.stringify({ ...CHECKOUT_EVENT, id: 'evt_forged' }),
    );

    await expect(
      controller.handleWebhook({} as never, signature, tampered),
    ).rejects.toBeInstanceOf(PerksBillingError);
  });

  it('refuses an unsigned request', async () => {
    const { controller } = createController();
    const { body } = signedPayload(CHECKOUT_EVENT);

    await expect(
      controller.handleWebhook({} as never, '' as never, body),
    ).rejects.toMatchObject({ status: 400 });
  });

  /**
   * Guards the `main.ts` mount order: if the global JSON parser runs first, the
   * body arrives here already parsed and no signature can ever be verified.
   */
  it('fails loudly when the raw body parser is not mounted', async () => {
    const { controller, billing } = createController();
    const { signature } = signedPayload(CHECKOUT_EVENT);

    await expect(
      controller.handleWebhook(
        {} as never,
        signature,
        CHECKOUT_EVENT as never, // parsed object, not a Buffer
      ),
    ).rejects.toMatchObject({ status: 400 });
    expect(billing.applyWebhookEvent).not.toHaveBeenCalled();
  });
});
