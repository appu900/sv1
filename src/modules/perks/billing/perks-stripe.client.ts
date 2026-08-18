import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Stripe = require('stripe');

export const PERKS_PRODUCT_TAG = 'perks_membership';

export class PerksBillingError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number,
    public readonly code: string,
  ) {
    super(message);
    this.name = 'PerksBillingError';
  }
}

export interface CheckoutSessionRequest {
  userId: string;
  email: string;
  customerId: string | null;
}

@Injectable()
export class PerksStripeClient {
  private readonly logger = new Logger(PerksStripeClient.name);
  private readonly client: Stripe | null;
  private readonly priceId: string;
  private readonly successUrl: string;
  private readonly cancelUrl: string;
  private readonly webhookSecret: string;

  constructor(private readonly config: ConfigService) {
    const secretKey = this.config.get<string>('STRIPE_SECRET_KEY', '').trim();
    this.priceId = this.config.get<string>('STRIPE_PERKS_PRICE_ID', '').trim();
    this.webhookSecret = this.config
      .get<string>('STRIPE_WEBHOOK_SECRET', '')
      .trim();
    this.successUrl = this.config
      .get<string>(
        'PERKS_CHECKOUT_SUCCESS_URL',
        'https://admin.saveful.app/perks/success',
      )
      .trim();
    this.cancelUrl = this.config
      .get<string>(
        'PERKS_CHECKOUT_CANCEL_URL',
        'https://admin.saveful.app/perks/cancelled',
      )
      .trim();

    this.client = secretKey ? new Stripe(secretKey) : null;
    if (!secretKey) {
      this.logger.warn('STRIPE_SECRET_KEY is not set — Perks billing is inert');
    }
  }

  get configured(): boolean {
    return Boolean(this.client && this.priceId);
  }

  get perksPriceId(): string {
    return this.priceId;
  }

  async ensureCustomer(userId: string, email: string, existingId: string | null) {
    const stripe = this.require();
    if (existingId) {
      try {
        const found = await stripe.customers.retrieve(existingId);
        if (!found.deleted) return found.id;
      } catch (error) {
        this.logger.warn(
          `Stripe customer ${existingId} could not be read, creating a new one: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    }

    const created = await stripe.customers.create({
      email,
      metadata: { savefulUserId: userId },
    });
    return created.id;
  }

  async createCheckoutSession(request: CheckoutSessionRequest): Promise<string> {
    const stripe = this.require();
    if (!this.priceId) {
      throw new PerksBillingError(
        'Perks billing is not configured',
        503,
        'PERKS_BILLING_NOT_CONFIGURED',
      );
    }

    const customerId = await this.ensureCustomer(
      request.userId,
      request.email,
      request.customerId,
    );

    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      customer: customerId,
      line_items: [{ price: this.priceId, quantity: 1 }],
      client_reference_id: request.userId,
      metadata: {
        savefulUserId: request.userId,
        savefulProduct: PERKS_PRODUCT_TAG,
      },
      subscription_data: {
        metadata: {
          savefulUserId: request.userId,
          savefulProduct: PERKS_PRODUCT_TAG,
        },
      },
      automatic_tax: { enabled: true },
      customer_update: { address: 'auto' },
      success_url: this.successUrl,
      cancel_url: this.cancelUrl,
    });

    if (!session.url) {
      throw new PerksBillingError(
        'Stripe did not return a checkout URL',
        502,
        'PERKS_CHECKOUT_URL_MISSING',
      );
    }

    return session.url;
  }

  async createPortalSession(customerId: string, returnUrl: string) {
    const stripe = this.require();
    const session = await stripe.billingPortal.sessions.create({
      customer: customerId,
      return_url: returnUrl,
    });
    return session.url;
  }

  async getSubscription(subscriptionId: string) {
    return this.require().subscriptions.retrieve(subscriptionId);
  }

  async setCancelAtPeriodEnd(subscriptionId: string, cancel: boolean) {
    return this.require().subscriptions.update(subscriptionId, {
      cancel_at_period_end: cancel,
    });
  }

  constructWebhookEvent(payload: Buffer | string, signature: string) {
    const stripe = this.require();
    if (!this.webhookSecret) {
      throw new PerksBillingError(
        'Stripe webhook secret is not configured',
        503,
        'PERKS_WEBHOOK_NOT_CONFIGURED',
      );
    }

    try {
      return stripe.webhooks.constructEvent(
        payload,
        signature,
        this.webhookSecret,
      );
    } catch (error) {
      throw new PerksBillingError(
        `Invalid Stripe signature: ${
          error instanceof Error ? error.message : String(error)
        }`,
        400,
        'PERKS_WEBHOOK_SIGNATURE_INVALID',
      );
    }
  }

  private require(): Stripe {
    if (!this.client) {
      throw new PerksBillingError(
        'Perks billing is not configured',
        503,
        'PERKS_BILLING_NOT_CONFIGURED',
      );
    }
    return this.client;
  }
}
