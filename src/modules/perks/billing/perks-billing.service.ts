import {
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import Stripe = require('stripe');
import {
  Gender,
  HealthProfile,
  HealthProfileDocument,
} from '../../../database/schemas/nutrition/health-profile.schema';
import {
  PerksMembershipEvent,
  PerksMembershipEventDocument,
  PerksMembershipEventType,
} from '../../../database/schemas/perks-membership-event.schema';
import {
  PerksBillingStatus,
  PerksMembership,
  PerksMembershipDocument,
  PerksMembershipPlan,
  PerksMembershipStatus,
} from '../../../database/schemas/perks-membership.schema';
import { User, UserDocument } from '../../../database/schemas/user.auth.schema';
import { PerksCorpSessionService } from '../corp/perks-corp-session.service';
import {
  billingLabel,
  Entitlement,
  isFreeRegion,
  resolveEntitlement,
} from './perks-entitlement';
import { PERKS_PRODUCT_TAG, PerksStripeClient } from './perks-stripe.client';

/** What a webhook changed, so the caller can finish the job outside billing. */
export interface WebhookOutcome {
  handled: boolean;
  /** Set when a user just became entitled and needs WeMAD registration. */
  activatedUserId: string | null;
}

@Injectable()
export class PerksBillingService {
  private readonly logger = new Logger(PerksBillingService.name);

  constructor(
    @InjectModel(PerksMembership.name)
    private readonly membershipModel: Model<PerksMembershipDocument>,
    @InjectModel(PerksMembershipEvent.name)
    private readonly membershipEventModel: Model<PerksMembershipEventDocument>,
    @InjectModel(User.name)
    private readonly userModel: Model<UserDocument>,
    @InjectModel(HealthProfile.name)
    private readonly healthProfileModel: Model<HealthProfileDocument>,
    private readonly stripe: PerksStripeClient,
    private readonly session: PerksCorpSessionService,
    private readonly config: ConfigService,
  ) {}

  get billingEnabled(): boolean {
    return (
      String(this.config.get('PERKS_BILLING_ENABLED', 'false')).toLowerCase() ===
        'true' && this.stripe.configured
    );
  }

  entitlementFor(
    user: { country?: string | null } | null,
    membership: {
      status?: PerksMembershipStatus;
      plan?: PerksMembershipPlan;
      billingStatus?: PerksBillingStatus;
      accessEndsAt?: Date | null;
      registeredAt?: Date | null;
      stripeSubscriptionId?: string | null;
    } | null,
  ): Entitlement {
    return resolveEntitlement(user, membership, {
      billingEnabled: this.billingEnabled,
      grandfatherBefore: this.grandfatherCutoff(),
    });
  }
  describe(
    user: { country?: string | null } | null,
    membership: PerksMembership | null,
  ) {
    const entitlement = this.entitlementFor(user, membership);
    return {
      required: entitlement.paymentRequired,
      reason: entitlement.reason,
      priceLabel: billingLabel(entitlement),
      subscriptionStatus: membership?.billingStatus ?? PerksBillingStatus.NONE,
      cancelAtPeriodEnd: membership?.cancelAtPeriodEnd ?? false,
      accessEndsAt: membership?.accessEndsAt ?? null,
      manageable: Boolean(membership?.stripeCustomerId),
    };
  }

  async startCheckout(userId: string): Promise<{ checkoutUrl: string }> {
    const objectId = new Types.ObjectId(userId);
    const user = await this.userModel.findById(objectId).lean();
    if (!user) throw new NotFoundException('Saveful user not found');

    if (isFreeRegion(user.country)) {
      throw new ConflictException({
        message: 'Perks is free in your region — no payment is needed.',
        code: 'PERKS_BILLING_NOT_REQUIRED',
      });
    }
    if (!this.billingEnabled) {
      throw new ConflictException({
        message: 'Perks membership is currently free — no payment is needed.',
        code: 'PERKS_BILLING_NOT_REQUIRED',
      });
    }

    const existing = await this.membershipModel.findOne({ userId: objectId });
    if (this.entitlementFor(user, existing).entitled) {
      throw new ConflictException({
        message: 'Your Perks membership is already active.',
        code: 'PERKS_BILLING_NOT_REQUIRED',
      });
    }

    // Our record says they have not paid. Before taking money, ask Stripe —
    // a webhook that never landed is the difference between "not a member" and
    // "already paying", and only one of those should reach a payment page.
    if (existing && (await this.reconcileFromStripe(existing))) {
      throw new ConflictException({
        message: 'Your Perks membership is already active.',
        code: 'PERKS_BILLING_NOT_REQUIRED',
      });
    }

    const healthProfile = await this.healthProfileModel
      .findOne({ userId: objectId })
      .select({ gender: 1 })
      .lean();
    const missing = this.session.missingProfileFields(
      user,
      (healthProfile?.gender as Gender | undefined) ?? null,
    );
    if (missing.length > 0) {
      throw new UnprocessableEntityException({
        message: 'Complete your Saveful profile before joining Perks',
        missingFields: missing,
      });
    }

    const membership =
      existing ??
      (await this.membershipModel.create({
        userId: objectId,
        email: user.email.toLowerCase(),
        status: PerksMembershipStatus.PENDING,
      }));

    const { url: checkoutUrl, customerId } =
      await this.stripe.createCheckoutSession({
        userId,
        email: user.email.toLowerCase(),
        customerId: membership.stripeCustomerId ?? null,
      });

    // Recorded before they reach the payment page, not after the webhook: this
    // is the handle that finds their money again if the webhook never arrives.
    if (membership.stripeCustomerId !== customerId) {
      membership.stripeCustomerId = customerId;
      await membership.save();
    }

    await this.recordEvent(
      objectId,
      PerksMembershipEventType.BILLING_CHECKOUT_STARTED,
      null,
    );

    return { checkoutUrl };
  }

  async openPortal(userId: string, returnUrl: string) {
    const membership = await this.membershipModel
      .findOne({ userId: new Types.ObjectId(userId) })
      .lean();
    if (!membership?.stripeCustomerId) {
      throw new NotFoundException({
        message: 'No billing account found for this membership.',
        code: 'PERKS_BILLING_NOT_FOUND',
      });
    }
    const url = await this.stripe.createPortalSession(
      membership.stripeCustomerId,
      returnUrl,
    );
    return { portalUrl: url };
  }

  async scheduleCancellation(userId: string, reason: string | null) {
    const objectId = new Types.ObjectId(userId);
    const membership = await this.membershipModel.findOne({ userId: objectId });
    if (!membership?.stripeSubscriptionId) return null;

    const subscription = await this.stripe.setCancelAtPeriodEnd(
      membership.stripeSubscriptionId,
      true,
    );

    membership.cancelAtPeriodEnd = true;
    membership.cancellationReason = reason;
    membership.accessEndsAt =
      this.periodEnd(subscription) ?? membership.accessEndsAt;
    await membership.save();

    await this.recordEvent(
      objectId,
      PerksMembershipEventType.BILLING_CANCEL_SCHEDULED,
      { accessEndsAt: membership.accessEndsAt, reason },
    );
    return membership;
  }
  async resumeSubscription(userId: string) {
    const objectId = new Types.ObjectId(userId);
    const membership = await this.membershipModel.findOne({ userId: objectId });
    if (!membership?.stripeSubscriptionId || !membership.cancelAtPeriodEnd) {
      return null;
    }

    const subscription = await this.stripe.getSubscription(
      membership.stripeSubscriptionId,
    );

    if (subscription.status === 'canceled') return null;

    await this.stripe.setCancelAtPeriodEnd(membership.stripeSubscriptionId, false);
    membership.cancelAtPeriodEnd = false;
    membership.cancellationReason = null;
    membership.cancelledAt = null;
    await membership.save();
    return membership;
  }

  /**
   * Pull the subscription's real state from Stripe and apply it locally.
   *
   * The webhook is the normal path and stays the source of truth. This is the
   * fallback for when it does not arrive: a member is charged, Stripe is happy,
   * and our database still says they owe money — from here, nothing self-heals
   * and the app can only offer to charge them again.
   *
   * Returns true when the member is entitled afterwards. Never throws: a Stripe
   * outage must not take out the caller, which is usually just reading status.
   */
  async reconcileFromStripe(
    membership: PerksMembershipDocument,
  ): Promise<boolean> {
    let subscription: Stripe.Subscription | null = null;
    try {
      // The stored id can be missing or stale, so ask Stripe for every customer
      // belonging to this user rather than trusting our own record.
      const customerIds = new Set<string>();
      if (membership.stripeCustomerId) {
        customerIds.add(membership.stripeCustomerId);
      }
      if (membership.email) {
        for (const id of await this.stripe.findCustomerIds(
          String(membership.userId),
          membership.email,
        )) {
          customerIds.add(id);
        }
      }
      if (!customerIds.size) return false;

      for (const customerId of customerIds) {
        subscription = await this.stripe.findActiveSubscription(customerId);
        if (subscription) {
          membership.stripeCustomerId = customerId;
          break;
        }
      }
    } catch (error) {
      this.logger.error(
        `Could not reconcile Perks billing for ${String(membership.userId)}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return false;
    }
    if (!subscription) return false;

    membership.stripeSubscriptionId = subscription.id;
    membership.billingStatus = this.mapStatus(subscription.status);
    membership.cancelAtPeriodEnd = Boolean(subscription.cancel_at_period_end);
    membership.accessEndsAt =
      this.periodEnd(subscription) ?? membership.accessEndsAt;
    if (membership.billingStatus === PerksBillingStatus.ACTIVE) {
      this.markPaid(membership);
    }
    await membership.save();

    const entitled = this.entitlementFor(null, membership).entitled;
    if (entitled) {
      this.logger.warn(
        `Perks membership ${String(membership.userId)} was reconciled from Stripe — ` +
          `subscription ${subscription.id} was paid but no webhook had applied it`,
      );
      await this.recordEvent(
        membership.userId,
        PerksMembershipEventType.BILLING_ACTIVATED,
        { source: 'reconcile', subscriptionId: subscription.id },
      );
    }
    return entitled;
  }

  async applyWebhookEvent(event: Stripe.Event): Promise<WebhookOutcome> {
    const unhandled: WebhookOutcome = { handled: false, activatedUserId: null };

    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object as Stripe.Checkout.Session;
        if (!this.isPerksObject(session)) return unhandled;
        return this.onCheckoutCompleted(event, session);
      }
      case 'customer.subscription.created':
      case 'customer.subscription.updated':
      case 'customer.subscription.deleted': {
        const subscription = event.data.object as Stripe.Subscription;
        if (!this.isPerksObject(subscription)) return unhandled;
        return this.onSubscriptionChanged(event, subscription);
      }
      case 'invoice.payment_failed':
        return this.onPaymentFailed(event, event.data.object as Stripe.Invoice);
      default:
        return unhandled;
    }
  }

  private async onCheckoutCompleted(
    event: Stripe.Event,
    session: Stripe.Checkout.Session,
  ): Promise<WebhookOutcome> {
    const userId =
      session.client_reference_id ?? session.metadata?.savefulUserId ?? null;
    const membership = await this.claimEvent(userId, event);
    if (!membership) return { handled: false, activatedUserId: null };

    membership.stripeCustomerId =
      this.idOf(session.customer) ?? membership.stripeCustomerId;
    membership.stripeSubscriptionId =
      this.idOf(session.subscription) ?? membership.stripeSubscriptionId;

    if (session.payment_status === 'paid') {
      this.markPaid(membership);
      await membership.save();
      await this.recordEvent(
        membership.userId,
        PerksMembershipEventType.BILLING_ACTIVATED,
        { source: 'checkout.session.completed' },
      );
      return { handled: true, activatedUserId: String(membership.userId) };
    }

    await membership.save();
    return { handled: true, activatedUserId: null };
  }

  private async onSubscriptionChanged(
    event: Stripe.Event,
    subscription: Stripe.Subscription,
  ): Promise<WebhookOutcome> {
    const userId = subscription.metadata?.savefulUserId ?? null;
    const membership = await this.claimEvent(userId, event, subscription.id);
    if (!membership) return { handled: false, activatedUserId: null };

    const wasEntitled = this.entitlementFor(null, membership).entitled;

    membership.stripeSubscriptionId = subscription.id;
    membership.stripeCustomerId =
      this.idOf(subscription.customer) ?? membership.stripeCustomerId;
    membership.billingStatus = this.mapStatus(subscription.status);
    membership.cancelAtPeriodEnd = Boolean(subscription.cancel_at_period_end);
    membership.accessEndsAt =
      this.periodEnd(subscription) ?? membership.accessEndsAt;

    if (membership.billingStatus === PerksBillingStatus.ACTIVE) {
      this.markPaid(membership);
    }

    if (subscription.status === 'canceled') {
      membership.plan = PerksMembershipPlan.PAID;
      const lapsed = !this.entitlementFor(null, membership).entitled;
      if (lapsed) {
        membership.status = PerksMembershipStatus.CANCELLED;
        membership.cancelledAt = membership.cancelledAt ?? new Date();
      }
      await membership.save();
      await this.recordEvent(
        membership.userId,
        PerksMembershipEventType.BILLING_LAPSED,
        { accessEndsAt: membership.accessEndsAt, lapsed },
      );
      return { handled: true, activatedUserId: null };
    }

    await membership.save();

    const nowEntitled = this.entitlementFor(null, membership).entitled;
    const activated = !wasEntitled && nowEntitled;
    if (activated) {
      await this.recordEvent(
        membership.userId,
        PerksMembershipEventType.BILLING_ACTIVATED,
        { source: event.type },
      );
    }

    return {
      handled: true,
      activatedUserId: activated ? String(membership.userId) : null,
    };
  }

  private async onPaymentFailed(
    event: Stripe.Event,
    invoice: Stripe.Invoice,
  ): Promise<WebhookOutcome> {
    const subscriptionId = this.subscriptionIdOf(invoice);
    const membership = await this.claimEvent(null, event, subscriptionId);
    if (!membership) return { handled: false, activatedUserId: null };

    membership.billingStatus = PerksBillingStatus.PAST_DUE;
    await membership.save();

    await this.recordEvent(
      membership.userId,
      PerksMembershipEventType.BILLING_PAYMENT_FAILED,
      { invoiceId: invoice.id },
    );
    return { handled: true, activatedUserId: null };
  }
  
  private isPerksObject(
    object: Stripe.Checkout.Session | Stripe.Subscription,
  ): boolean {
    if (object.metadata?.savefulProduct === PERKS_PRODUCT_TAG) return true;

    const priceId = this.stripe.perksPriceId;
    const items = (object as Stripe.Subscription).items?.data ?? [];
    if (priceId && items.some((item) => item.price?.id === priceId)) return true;

    this.logger.debug(
      `Ignoring Stripe object ${object.id} — not a Perks product (shared account)`,
    );
    return false;
  }

  private async claimEvent(
    userId: string | null,
    event: Stripe.Event,
    subscriptionId?: string | null,
  ): Promise<PerksMembershipDocument | null> {
    const membership = await this.findMembership(userId, subscriptionId);
    if (!membership) {
      this.logger.warn(
        `Stripe event ${event.id} (${event.type}) matched no Perks membership`,
      );
      return null;
    }

    if (membership.lastStripeEventId === event.id) {
      this.logger.log(`Stripe event ${event.id} already applied, skipping`);
      return null;
    }
    const eventAt = new Date(event.created * 1000);
    if (
      membership.lastStripeEventAt &&
      eventAt.getTime() < membership.lastStripeEventAt.getTime()
    ) {
      this.logger.log(
        `Stripe event ${event.id} is older than the last applied event, skipping`,
      );
      return null;
    }

    membership.lastStripeEventId = event.id;
    membership.lastStripeEventAt = eventAt;
    return membership;
  }

  private async findMembership(
    userId: string | null,
    subscriptionId?: string | null,
  ) {
    if (userId && Types.ObjectId.isValid(userId)) {
      const byUser = await this.membershipModel.findOne({
        userId: new Types.ObjectId(userId),
      });
      if (byUser) return byUser;
    }
    if (subscriptionId) {
      return this.membershipModel.findOne({
        stripeSubscriptionId: subscriptionId,
      });
    }
    return null;
  }

  private markPaid(membership: PerksMembershipDocument) {
    membership.plan = PerksMembershipPlan.PAID;
    membership.billingStatus = PerksBillingStatus.ACTIVE;
    membership.cancelledAt = null;
    membership.cancellationReason = null;
  }

  private mapStatus(status: Stripe.Subscription.Status): PerksBillingStatus {
    switch (status) {
      case 'active':
      case 'trialing':
        return PerksBillingStatus.ACTIVE;
      case 'past_due':
      case 'unpaid':
        return PerksBillingStatus.PAST_DUE;
      case 'canceled':
        return PerksBillingStatus.CANCELED;
      default:
        return PerksBillingStatus.INCOMPLETE;
    }
  }

  private periodEnd(subscription: Stripe.Subscription): Date | null {
    const fromSubscription = (
      subscription as unknown as { current_period_end?: number }
    ).current_period_end;
    const fromItem = subscription.items?.data?.[0]?.current_period_end;
    const seconds = fromSubscription ?? fromItem;
    return typeof seconds === 'number' ? new Date(seconds * 1000) : null;
  }

  private subscriptionIdOf(invoice: Stripe.Invoice): string | null {
    const direct = (invoice as unknown as { subscription?: unknown })
      .subscription;
    const fromDirect = this.idOf(direct);
    if (fromDirect) return fromDirect;

    const parent = (
      invoice as unknown as {
        parent?: { subscription_details?: { subscription?: unknown } };
      }
    ).parent;
    return this.idOf(parent?.subscription_details?.subscription);
  }

  private idOf(value: unknown): string | null {
    if (typeof value === 'string') return value;
    if (value && typeof value === 'object' && 'id' in value) {
      return String((value as { id: unknown }).id);
    }
    return null;
  }

  private grandfatherCutoff(): Date | null {
    const raw = this.config
      .get<string>('PERKS_BILLING_GRANDFATHER_BEFORE', '')
      .trim();
    if (!raw) return null;
    const parsed = new Date(raw);
    if (Number.isNaN(parsed.getTime())) {
      this.logger.warn(
        `PERKS_BILLING_GRANDFATHER_BEFORE is not a valid date: ${raw}`,
      );
      return null;
    }
    return parsed;
  }

  private async recordEvent(
    userId: Types.ObjectId,
    type: PerksMembershipEventType,
    metadata: Record<string, unknown> | null,
  ) {
    try {
      await this.membershipEventModel.create({ userId, type, metadata });
    } catch (error) {
      this.logger.warn(
        `Could not record perks billing event ${type}: ${
          (error as Error).message
        }`,
      );
    }
  }
}
