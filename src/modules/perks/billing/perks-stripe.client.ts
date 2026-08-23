import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Stripe = require('stripe');

export const PERKS_PRODUCT_TAG = 'perks_membership';

/** Stripe statuses that mean the member has paid for access right now. */
const ACTIVE_SUBSCRIPTION_STATUSES = new Set<Stripe.Subscription.Status>([
  'active',
  'trialing',
  'past_due',
]);

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
    // Stripe redirects straight back into the app rather than to a web page.
    // The auth session watches for this scheme at the navigation layer, so the
    // browser closes itself the moment payment finishes — a web page in between
    // had to ask the OS to open the app from JavaScript, which is unreliable on
    // both platforms and left people staring at a "return to app" screen.
    this.successUrl = this.config
      .get<string>(
        'PERKS_CHECKOUT_SUCCESS_URL',
        'saveful://perks/register?checkout=success',
      )
      .trim();
    this.cancelUrl = this.config
      .get<string>(
        'PERKS_CHECKOUT_CANCEL_URL',
        'saveful://perks/register?checkout=cancelled',
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

  async createCheckoutSession(
    request: CheckoutSessionRequest,
  ): Promise<{ url: string; customerId: string }> {
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

    // The caller stores this before redirecting. Only the webhook used to
    // record it, so every abandoned checkout minted another Stripe customer
    // for the same person — one live account had three.
    return { url: session.url, customerId };
  }

  /**
   * Every Stripe customer we have ever created for this Saveful user.
   *
   * The stored id can be missing (the member never completed a checkout that
   * produced a webhook) or stale (the duplicates above), and a member who has
   * paid must be findable either way.
   */
  async findCustomerIds(userId: string, email: string): Promise<string[]> {
    const stripe = this.require();
    const ids = new Set<string>();

    try {
      const byMetadata = await stripe.customers.search({
        query: `metadata['savefulUserId']:'${userId.replace(/'/g, '')}'`,
        limit: 20,
      });
      for (const customer of byMetadata.data) ids.add(customer.id);
    } catch (error) {
      this.logger.warn(
        `Stripe customer search failed for ${userId}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }

    // Search indexes lag by up to a minute, so a checkout that just finished
    // may only be findable by email.
    try {
      const byEmail = await stripe.customers.list({ email, limit: 20 });
      for (const customer of byEmail.data) {
        if (customer.metadata?.savefulUserId === userId) ids.add(customer.id);
      }
    } catch (error) {
      this.logger.warn(
        `Stripe customer lookup by email failed for ${userId}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }

    return [...ids];
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

  /**
   * The customer's live Perks subscription, if Stripe has one.
   *
   * Asked before starting a checkout, and whenever our own record says a member
   * has not paid. A webhook that never lands — dropped, mis-signed, delivered
   * while the backend was down — otherwise leaves someone charged but locked
   * out, with a second checkout the only thing the app knows how to offer.
   */
  async findActiveSubscription(
    customerId: string,
  ): Promise<Stripe.Subscription | null> {
    const stripe = this.require();
    const { data } = await stripe.subscriptions.list({
      customer: customerId,
      status: 'all',
      limit: 20,
    });

    const live = data.filter((subscription) =>
      ACTIVE_SUBSCRIPTION_STATUSES.has(subscription.status),
    );
    const priceId = this.priceId;
    const perks = live.filter(
      (subscription) =>
        subscription.metadata?.savefulProduct === PERKS_PRODUCT_TAG ||
        (priceId &&
          subscription.items.data.some((item) => item.price?.id === priceId)),
    );

    // Newest first: if a duplicate ever exists, the current one governs.
    return (
      perks.sort((left, right) => right.created - left.created)[0] ?? null
    );
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
