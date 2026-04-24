import {
  ForbiddenException,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import {
  Subscription,
  SubscriptionDocument,
} from '../../database/schemas/subscription.schema';
import {
  SubscriptionUsage,
  SubscriptionUsageDocument,
} from '../../database/schemas/subscription-usage.schema';
import {
  FeatureKey,
  LimitKey,
  PLANS,
  PlanDefinition,
  SAVEFUL_ENTITLEMENT,
  SubscriptionPlan,
  UNLIMITED,
} from './subscription.constants';
import { parseCustomerInfo } from './utils/parse-customer-info';
import { currentPeriod } from './utils/period';

const toObjectId = (id: string | Types.ObjectId) =>
  typeof id === 'string' ? new Types.ObjectId(id) : id;

export type UsageCounterKey = 'aiMealsUsed';

@Injectable()
export class SubscriptionService {
  private readonly logger = new Logger(SubscriptionService.name);

  constructor(
    @InjectModel(Subscription.name)
    private readonly subscriptionModel: Model<SubscriptionDocument>,
    @InjectModel(SubscriptionUsage.name)
    private readonly usageModel: Model<SubscriptionUsageDocument>,
    private readonly configService: ConfigService,
  ) {}


  async getOrCreateSubscription(userId: string): Promise<SubscriptionDocument> {
    const uid = toObjectId(userId);
    const sub = await this.subscriptionModel.findOneAndUpdate(
      { userId: uid },
      {
        $setOnInsert: {
          userId: uid,
          plan: 'basic',
          status: 'active',
          willRenew: false,
        },
      },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    );
    return sub!;
  }

  async getPlan(userId: string): Promise<SubscriptionPlan> {
    const sub = await this.getOrCreateSubscription(userId);
    if (
      sub.plan !== 'basic' &&
      sub.expiresAt &&
      sub.expiresAt.getTime() < Date.now()
    ) {
      await this.subscriptionModel.updateOne(
        { _id: sub._id, plan: sub.plan },
        { $set: { plan: 'basic', status: 'expired', willRenew: false } },
      );
      return 'basic';
    }
    return sub.plan;
  }

  getPlanDefinition(plan: SubscriptionPlan): PlanDefinition {
    return PLANS[plan];
  }

  async syncFromCustomerInfo(
    userId: string,
    customerInfo: Record<string, any> | undefined,
    revenueCatUserId?: string,
  ): Promise<SubscriptionDocument> {
    const rcSecret = this.configService.get<string>('REVENUECAT_SECRET_API_KEY');
    let verifiedInfo: Record<string, any> | undefined;

    if (rcSecret) {
      verifiedInfo = await this.fetchSubscriberFromRevenueCat(userId, rcSecret);
    } else {
      this.logger.warn(
        'REVENUECAT_SECRET_API_KEY missing — /subscription/sync is trusting client payload. ' +
          'Configure the secret in prod to close a subscription-spoofing bypass.',
      );
      const clientAppUserId =
        customerInfo?.originalAppUserId ??
        customerInfo?.original_app_user_id ??
        revenueCatUserId;
      if (clientAppUserId && String(clientAppUserId) !== String(userId)) {
        this.logger.warn(
          `Rejecting /sync: client app_user_id=${clientAppUserId} does not match auth user=${userId}`,
        );
        throw new ForbiddenException({
          code: 'SUBSCRIPTION_MISMATCH',
          message: 'Subscription does not belong to the authenticated user.',
        });
      }
      verifiedInfo = customerInfo;
    }

    const parsed = parseCustomerInfo(verifiedInfo, SAVEFUL_ENTITLEMENT);
    const uid = toObjectId(userId);
    const update: Record<string, any> = {
      plan: parsed.plan,
      status: parsed.status,
      entitlement: parsed.entitlement,
      productId: parsed.productId,
      store: parsed.store,
      periodType: parsed.periodType,
      purchasedAt: parsed.purchasedAt,
      expiresAt: parsed.expiresAt,
      trialEndsAt: parsed.trialEndsAt,
      willRenew: parsed.willRenew,
      cancelledAt: parsed.cancelledAt,
      revenueCatUserId:
        revenueCatUserId || verifiedInfo?.originalAppUserId || userId,
      lastCustomerInfo: verifiedInfo,
    };
    const doc = await this.subscriptionModel.findOneAndUpdate(
      { userId: uid },
      { $set: update, $setOnInsert: { userId: uid } },
      { upsert: true, new: true },
    );
    this.logger.log(
      `Sync sub for user=${userId} plan=${doc!.plan} status=${doc!.status} product=${doc!.productId}`,
    );
    return doc!;
  }

  private async fetchSubscriberFromRevenueCat(
    userId: string,
    rcSecret: string,
  ): Promise<Record<string, any>> {
    const url = `https://api.revenuecat.com/v1/subscribers/${encodeURIComponent(userId)}`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5_000);
    try {
      const res = await fetch(url, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${rcSecret}`,
          'X-Platform': 'server',
          'Content-Type': 'application/json',
        },
        signal: controller.signal,
      });
      if (!res.ok) {
        const body = await res.text().catch(() => '');
        this.logger.error(
          `RC REST GET /subscribers/${userId} failed: ${res.status} ${body.slice(0, 300)}`,
        );
        throw new ServiceUnavailableException(
          'Unable to verify subscription with RevenueCat',
        );
      }
      const data = (await res.json()) as any;
      // RC REST returns { subscriber: { ... } } — map to CustomerInfo shape
      // that parseCustomerInfo understands.
      const sub = data?.subscriber ?? {};
      return {
        originalAppUserId: sub?.original_app_user_id ?? userId,
        entitlements: { active: sub?.entitlements ?? {} },
      };
    } catch (err) {
      if (err instanceof ServiceUnavailableException) throw err;
      this.logger.error(
        `RC REST fetch failed for user=${userId}: ${(err as Error).message}`,
      );
      throw new ServiceUnavailableException(
        'Unable to verify subscription with RevenueCat',
      );
    } finally {
      clearTimeout(timeout);
    }
  }

  /**
   * Webhook path — find subscription by RC app_user_id (which we set to the
   * user's Mongo id at configure time). Applies dedup/ordering protection
   * using the event id and timestamp so replayed or out-of-order webhooks
   * cannot downgrade an active user.
   */
  async syncFromWebhook(payload: any): Promise<void> {
    const event = payload?.event ?? payload;
    const appUserId: string | undefined = event?.app_user_id;
    if (!appUserId) {
      this.logger.warn('RC webhook missing app_user_id');
      return;
    }
    if (!Types.ObjectId.isValid(appUserId)) {
      this.logger.warn(`RC webhook: non-ObjectId app_user_id=${appUserId}`);
      return;
    }

    const uid = toObjectId(appUserId);
    const eventId: string | undefined = event?.id;
    const eventAtMs: number | undefined =
      event?.event_timestamp_ms ?? event?.purchased_at_ms ?? undefined;
    const eventAt = eventAtMs ? new Date(eventAtMs) : new Date();

    // Ensure the subscription doc exists so the atomic dedup update below
    // has a row to match.
    await this.subscriptionModel.updateOne(
      { userId: uid },
      {
        $setOnInsert: {
          userId: uid,
          plan: 'basic',
          status: 'active',
          willRenew: false,
        },
      },
      { upsert: true },
    );

    const existing = await this.subscriptionModel.findOne({ userId: uid });
    if (existing) {
      if (eventId && (existing as any).lastEventId === eventId) {
        this.logger.log(`RC webhook duplicate event ${eventId} — ignored`);
        return;
      }
      const lastAt = (existing as any).lastEventAt as Date | undefined;
      if (lastAt && lastAt > eventAt) {
        this.logger.log(
          `RC webhook stale event type=${event?.type} at=${eventAt.toISOString()} older than last=${lastAt.toISOString()} — ignored`,
        );
        return;
      }
    }

    const type: string | undefined = event?.type;
    const entitlementIds: string[] = event?.entitlement_ids || [];
    const productId: string | undefined = event?.product_id;

    /**
     * Build the authoritative `$set` for this event. Then apply it atomically
     * with a filter that blocks:
     *   a) duplicate event id (idempotency) — via `lastEventId: { $ne: eventId }`
     *   b) out-of-order events       — via `lastEventAt: { $not: { $gt: eventAt } }`
     * `modifiedCount === 0` means one of those guards tripped; we log & skip.
     */
    const commit = async (set: Record<string, any>) => {
      const filter: Record<string, any> = { userId: uid };
      if (eventId) filter.lastEventId = { $ne: eventId };
      filter.$or = [
        { lastEventAt: { $exists: false } },
        { lastEventAt: { $lte: eventAt } },
      ];
      const res = await this.subscriptionModel.updateOne(filter, {
        $set: {
          ...set,
          lastEventId: eventId,
          lastEventAt: eventAt,
        },
      });
      if (res.modifiedCount === 0) {
        this.logger.log(
          `RC webhook skipped (dedup/ordering) type=${event?.type} id=${eventId}`,
        );
      }
    };

    try {
      // Terminal states: explicitly downgrade regardless of entitlement snapshot.
      if (
        type === 'EXPIRATION' ||
        type === 'SUBSCRIPTION_PAUSED' ||
        type === 'REFUND' ||
        type === 'TRANSFER'
      ) {
        await commit({
          plan: 'basic',
          status: type === 'SUBSCRIPTION_PAUSED' ? 'paused' : 'expired',
          willRenew: false,
          lastCustomerInfo: event,
        });
        return;
      }

      // Build a minimal customer_info-like blob for parseCustomerInfo.
      const active: Record<string, any> = {};
      if (entitlementIds.includes(SAVEFUL_ENTITLEMENT)) {
        active[SAVEFUL_ENTITLEMENT] = {
          product_identifier: productId,
          expires_date: event?.expiration_at_ms
            ? new Date(event.expiration_at_ms).toISOString()
            : undefined,
          purchase_date: event?.purchased_at_ms
            ? new Date(event.purchased_at_ms).toISOString()
            : undefined,
          period_type: event?.period_type,
          store: event?.store,
          will_renew: type !== 'CANCELLATION',
          unsubscribe_detected_at:
            type === 'CANCELLATION' ? new Date(eventAt).toISOString() : null,
        };
      }

      const customerInfo = {
        originalAppUserId: appUserId,
        entitlements: { active },
      };
      const parsed = parseCustomerInfo(customerInfo, SAVEFUL_ENTITLEMENT);
      await commit({
        plan: parsed.plan,
        status: parsed.status,
        entitlement: parsed.entitlement,
        productId: parsed.productId,
        store: parsed.store,
        periodType: parsed.periodType,
        purchasedAt: parsed.purchasedAt,
        expiresAt: parsed.expiresAt,
        trialEndsAt: parsed.trialEndsAt,
        willRenew: parsed.willRenew,
        cancelledAt: parsed.cancelledAt,
        revenueCatUserId: appUserId,
        lastCustomerInfo: event,
      });
    } catch (err) {
      this.logger.error(
        `RC webhook processing failed: ${(err as Error).message}`,
      );
    }
  }

  async hasFeature(userId: string, feature: FeatureKey): Promise<boolean> {
    const plan = await this.getPlan(userId);
    return PLANS[plan].features.includes(feature);
  }

  async assertFeature(userId: string, feature: FeatureKey): Promise<void> {
    const ok = await this.hasFeature(userId, feature);
    if (!ok) {
      throw new ForbiddenException({
        code: 'UPGRADE_REQUIRED',
        feature,
        message: 'Upgrade required to use this feature',
      });
    }
  }

  async getLimit(userId: string, key: LimitKey): Promise<number> {
    const plan = await this.getPlan(userId);
    return PLANS[plan].limits[key];
  }


  async getUsage(userId: string): Promise<SubscriptionUsageDocument> {
    const uid = toObjectId(userId);
    const { periodKey, periodStart, periodEnd } = currentPeriod();
    const usage = await this.usageModel.findOneAndUpdate(
      { userId: uid, periodKey },
      { $setOnInsert: { userId: uid, periodKey, periodStart, periodEnd } },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    );
    return usage!;
  }

  
  async incrementUsage(
    userId: string,
    key: UsageCounterKey,
    amount = 1,
  ): Promise<number> {
    const plan = await this.getPlan(userId);
    const planDef = PLANS[plan];
    const limitKey: LimitKey = 'aiMealsPerMonth';
    const limit = planDef.limits[limitKey];

    const uid = toObjectId(userId);
    const { periodKey, periodStart, periodEnd } = currentPeriod();

    if (limit === UNLIMITED) {
      const doc = await this.usageModel.findOneAndUpdate(
        { userId: uid, periodKey },
        {
          $inc: { [key]: amount },
          $setOnInsert: { userId: uid, periodKey, periodStart, periodEnd },
        },
        { upsert: true, new: true },
      );
      return (doc as any)[key] as number;
    }

    const limitReached = (): never => {
      throw new ForbiddenException({
        code: 'LIMIT_REACHED',
        limit: limitKey,
        cap: limit,
        plan,
        message: `You have reached the ${limitKey} limit for the ${planDef.label} plan.`,
      });
    };

    // Conditional atomic increment. Ensure the doc exists first so the
    // conditional upsert cannot collide with the unique index on a race.
    await this.usageModel.updateOne(
      { userId: uid, periodKey },
      { $setOnInsert: { userId: uid, periodKey, periodStart, periodEnd } },
      { upsert: true },
    );

    try {
      const doc = await this.usageModel.findOneAndUpdate(
        { userId: uid, periodKey, [key]: { $lte: limit - amount } },
        { $inc: { [key]: amount } },
        { new: true },
      );
      const val = (doc as any)?.[key] as number | undefined;
      if (!doc || val == null || val > limit) {
        limitReached();
      }
      return val!;
    } catch (err: any) {
      if (err?.code === 11000) {
        limitReached();
      }
      throw err;
    }
  }

  /** Check a limit without mutating usage. Useful before showing UI. */
  async checkLimit(
    userId: string,
    key: UsageCounterKey,
  ): Promise<{ used: number; limit: number; remaining: number }> {
    const plan = await this.getPlan(userId);
    const limit = PLANS[plan].limits.aiMealsPerMonth;
    const usage = await this.getUsage(userId);
    const used = (usage as any)[key] as number;
    return {
      used,
      limit,
      remaining:
        limit === UNLIMITED
          ? Number.POSITIVE_INFINITY
          : Math.max(0, limit - used),
    };
  }

  /**
   * Refund a metered counter (e.g. when an AI generation job fails or is
   * cancelled so the user's monthly quota isn't burnt). Floored at 0 so we
   * can never produce negative usage.
   */
  async refundUsage(
    userId: string,
    key: UsageCounterKey,
    amount = 1,
  ): Promise<void> {
    if (amount <= 0) return;
    const uid = toObjectId(userId);
    const { periodKey } = currentPeriod();
    await this.usageModel.updateOne(
      { userId: uid, periodKey, [key]: { $gte: amount } },
      { $inc: { [key]: -amount } },
    );
  }

  async enforceLiveLimit(
    userId: string,
    limitKey: LimitKey,
    currentCount: number,
    delta = 1,
  ): Promise<{
    plan: SubscriptionPlan;
    limit: number;
    used: number;
    remaining: number;
    unlimited: boolean;
    warn: boolean;
    exhausted: boolean;
  }> {
    const plan = await this.getPlan(userId);
    const limit = PLANS[plan].limits[limitKey];
    const unlimited = limit === UNLIMITED;
    const planLabel = PLANS[plan].label;

    if (!unlimited && currentCount + delta > limit) {
      throw new ForbiddenException({
        code: 'LIMIT_REACHED',
        limit: limitKey,
        cap: limit,
        plan,
        message: `You have reached the ${limitKey} limit (${limit}) for the ${planLabel} plan. Upgrade to add more.`,
      });
    }

    const used = currentCount + delta;
    const remaining = unlimited
      ? Number.POSITIVE_INFINITY
      : Math.max(0, limit - used);
    const warn = !unlimited && remaining <= 2;
    const exhausted = !unlimited && remaining <= 0;
    return {
      plan,
      limit: unlimited ? -1 : limit,
      used,
      remaining: unlimited ? -1 : remaining,
      unlimited,
      warn,
      exhausted,
    };
  }

  // --------------------------------------------------------------------------
  // Aggregate DTO for GET /api/subscription
  // --------------------------------------------------------------------------

  async getSubscriptionSnapshot(userId: string) {
    const sub = await this.getOrCreateSubscription(userId);
    const plan = await this.getPlan(userId);
    const def = PLANS[plan];
    const usage = await this.getUsage(userId);
    return {
      plan,
      status: sub.status,
      isPaid: def.isPaid,
      label: def.label,
      entitlement: sub.entitlement,
      productId: sub.productId,
      store: sub.store,
      periodType: sub.periodType,
      purchasedAt: sub.purchasedAt,
      expiresAt: sub.expiresAt,
      trialEndsAt: sub.trialEndsAt,
      willRenew: sub.willRenew,
      features: def.features,
      limits: def.limits,
      usage: {
        aiMealsUsed: usage.aiMealsUsed,
        kitchenScansUsed: usage.kitchenScansUsed ?? 0,
        periodKey: usage.periodKey,
        periodEnd: usage.periodEnd,
      },
    };
  }
}
