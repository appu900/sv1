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
  PLAN_PREFIX_RULES,
  PlanDefinition,
  PRODUCT_TO_PLAN,
  SAVEFUL_ENTITLEMENT,
  SubscriptionPlan,
  UNLIMITED,
} from './subscription.constants';
import { parseCustomerInfo } from './utils/parse-customer-info';
import { currentUsagePeriod } from './utils/period';

const toObjectId = (id: string | Types.ObjectId) =>
  typeof id === 'string' ? new Types.ObjectId(id) : id;

export type UsageCounterKey = 'aiMealsUsed' | 'kitchenScansUsed';

const USAGE_COUNTER_LIMITS: Record<UsageCounterKey, LimitKey> = {
  aiMealsUsed: 'aiMealsPerMonth',
  kitchenScansUsed: 'kitchenScansPerMonth',
};

const WEBHOOK_ACCESS_EVENTS = new Set([
  'INITIAL_PURCHASE',
  'RENEWAL',
  'NON_RENEWING_PURCHASE',
  'SUBSCRIPTION_EXTENDED',
  'TEMPORARY_ENTITLEMENT_GRANT',
]);

type RevenueCatVerificationConfig =
  | { version: 'v1'; apiKey: string }
  | { version: 'v2'; apiKey: string; projectId: string };

const REVENUECAT_V2_PRODUCT_FETCH_PERMISSIONS =
  'project_configuration:products:read';

class RevenueCatCustomerNotFoundError extends Error {
  constructor() {
    super('RevenueCat customer not found');
  }
}

@Injectable()
export class SubscriptionService {
  private readonly logger = new Logger(SubscriptionService.name);
  private readonly revenueCatV2ProductIdentifierCache = new Map<
    string,
    string | undefined
  >();

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

  private async findSubscription(
    userId: string,
  ): Promise<SubscriptionDocument | null> {
    const uid = toObjectId(userId);
    return this.subscriptionModel.findOne({ userId: uid });
  }

  private synthesiseBasicSubscription(userId: string): SubscriptionDocument {
    const uid = toObjectId(userId);
    return {
      userId: uid,
      plan: 'basic' as SubscriptionPlan,
      status: 'active',
      willRenew: false,
    } as SubscriptionDocument;
  }


  private async resolveActiveSubscription(
    userId: string,
    options: { readOnly?: boolean } = {},
  ): Promise<{
    sub: SubscriptionDocument;
    plan: SubscriptionPlan;
  }> {
    const sub = options.readOnly
      ? (await this.findSubscription(userId)) ??
        this.synthesiseBasicSubscription(userId)
      : await this.getOrCreateSubscription(userId);
    if (
      sub.plan !== 'basic' &&
      sub.expiresAt &&
      sub.expiresAt.getTime() < Date.now()
    ) {
      // Only persist the lazy-expiry flip when we're not in read-only mode
      // and we have a real saved doc to update.
      if (!options.readOnly && (sub as any)._id) {
        const expired = await this.subscriptionModel.findOneAndUpdate(
          { _id: sub._id, plan: sub.plan },
          {
            $set: {
              plan: 'basic',
              status: 'expired',
              willRenew: false,
            },
          },
          { new: true },
        );
        return { sub: expired ?? sub, plan: 'basic' };
      }
      return { sub, plan: 'basic' };
    }
    return { sub, plan: sub.plan };
  }

  async getPlan(userId: string): Promise<SubscriptionPlan> {
    const { plan } = await this.resolveActiveSubscription(userId);
    return plan;
  }

  getPlanDefinition(plan: SubscriptionPlan): PlanDefinition {
    return PLANS[plan];
  }

  async syncFromCustomerInfo(
    userId: string,
    customerInfo: Record<string, any> | undefined,
    revenueCatUserId?: string,
    options: { throwOnFailure?: boolean } = {},
  ): Promise<SubscriptionDocument> {
    const verifiedInfo = await this.verifyCustomerWithRevenueCat(userId, {
      clientCustomerInfo: customerInfo,
      revenueCatUserId,
      throwOnFailure: options.throwOnFailure ?? true,
    });

    const existing = await this.findSubscription(userId);
    const parsed = parseCustomerInfo(
      verifiedInfo,
      SAVEFUL_ENTITLEMENT,
      existing?.plan,
    );
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
    // Mongoose strips `undefined` from $set, so we must explicitly $unset any
    // optional fields that the new state does not provide. Without this, a
    // user who cancels and then re-subscribes would keep a stale `cancelledAt`
    // marker forever, and a converted-from-trial sub would keep a stale
    // `trialEndsAt`.
    const unset: Record<string, ''> = {};
    if (!parsed.cancelledAt) unset.cancelledAt = '';
    if (!parsed.trialEndsAt) unset.trialEndsAt = '';
    const ops: Record<string, any> = {
      $set: update,
      $setOnInsert: { userId: uid },
    };
    if (Object.keys(unset).length > 0) {
      ops.$unset = unset;
      for (const field of Object.keys(unset)) delete ops.$set[field];
    }
    // Trial consumption: once we observe a trial / intro period for a tier,
    // record it permanently. `$min` keeps the earliest known timestamp so
    // that re-sync events do not push the trial-consumed marker forward.
    // The paywall uses this to suppress "Free trial" copy for tiers the
    // user has already trialed (so cancelling a trial does NOT let them
    // start another one).
    if (
      (parsed.periodType === 'trial' || parsed.periodType === 'intro') &&
      (parsed.plan === 'hero' || parsed.plan === 'legend')
    ) {
      const trialAt = parsed.purchasedAt ?? new Date();
      ops.$min = {
        ...(ops.$min ?? {}),
        [`trialsConsumed.${parsed.plan}`]: trialAt,
      };
    }
    const doc = await this.subscriptionModel.findOneAndUpdate(
      { userId: uid },
      ops,
      { upsert: true, new: true },
    );
    this.logger.log(
      `Sync sub for user=${userId} plan=${doc!.plan} status=${doc!.status} product=${doc!.productId}`,
    );
    return doc!;
  } 

  private async verifyCustomerWithRevenueCat(
    userId: string,
    options: {
      clientCustomerInfo?: Record<string, any>;
      revenueCatUserId?: string;
      throwOnFailure?: boolean;
    } = {},
  ): Promise<Record<string, any> | undefined> {
    const { clientCustomerInfo, revenueCatUserId, throwOnFailure } = options;
    const revenueCatConfigs = this.getRevenueCatVerificationConfigs();
    let verifiedInfo: Record<string, any> | undefined;
    let lastVerificationError: unknown;
    let customerNotFound = false;

    if (revenueCatConfigs.length > 0) {
      for (let index = 0; index < revenueCatConfigs.length; index += 1) {
        const revenueCatConfig = revenueCatConfigs[index];
        try {
          verifiedInfo =
            revenueCatConfig.version === 'v2'
              ? await this.fetchCustomerFromRevenueCatV2(
                  userId,
                  revenueCatConfig.apiKey,
                  revenueCatConfig.projectId,
                )
              : await this.fetchSubscriberFromRevenueCat(
                  userId,
                  revenueCatConfig.apiKey,
                );
          break;
        } catch (err) {
          if (err instanceof RevenueCatCustomerNotFoundError) {
            customerNotFound = true;
            this.logger.log(
              `RevenueCat v${revenueCatConfig.version} customer not found for user=${userId}`,
            );
            continue;
          }

          lastVerificationError = err;
          if (index < revenueCatConfigs.length - 1) {
            this.logger.warn(
              `RevenueCat v${revenueCatConfig.version} verification failed; trying next configured RevenueCat API key.`,
            );
            continue;
          }
        }
      }

      if (!verifiedInfo) {
        if (customerNotFound && !lastVerificationError) {
          verifiedInfo = this.emptyRevenueCatCustomerInfo(userId);
        } else if (this.canTrustClientSyncFallback()) {
          this.logger.warn(
            'RevenueCat server verification failed — falling back to client CustomerInfo because NODE_ENV is not production.',
          );
          verifiedInfo = this.trustedClientCustomerInfo(
            userId,
            clientCustomerInfo,
            revenueCatUserId,
          );
        } else if (throwOnFailure) {
          if (lastVerificationError) throw lastVerificationError;
          throw new ServiceUnavailableException(
            'Unable to verify subscription with RevenueCat',
          );
        }
      }
    } else {
      if (!this.canTrustClientSyncFallback()) {
        if (throwOnFailure) {
          throw new ServiceUnavailableException(
            'RevenueCat server verification is not configured',
          );
        }
        return undefined;
      }
      this.logger.warn(
        'No RevenueCat server API key configured — falling back to client CustomerInfo because NODE_ENV is not production. ' +
          'Set REVENUECAT_V2_API_KEY or REVENUECAT_V1_API_KEY in production, or rely on RevenueCat webhooks as the authoritative source.',
      );
      verifiedInfo = this.trustedClientCustomerInfo(
        userId,
        clientCustomerInfo,
        revenueCatUserId,
      );
    }

    return verifiedInfo;
  }

  private getRevenueCatVerificationConfigs(): RevenueCatVerificationConfig[] {
    const configs: RevenueCatVerificationConfig[] = [];
    const addConfig = (config: RevenueCatVerificationConfig) => {
      const exists = configs.some(
        (candidate) =>
          candidate.version === config.version &&
          candidate.apiKey === config.apiKey &&
          (candidate.version !== 'v2' ||
            config.version !== 'v2' ||
            candidate.projectId === config.projectId),
      );
      if (!exists) configs.push(config);
    };

    const projectId = this.getFirstConfigValue([
      'REVENUECAT_PROJECT_ID',
      'REVENUECAT_V2_PROJECT_ID',
      'REVENUECAT_API_PROJECT_ID',
    ]);
    const explicitV2ApiKey = this.getFirstConfigValue([
      'REVENUECAT_V2_API_KEY',
    ]);
    const genericApiKey = this.getFirstConfigValue([
      'REVENUECAT_SECRET_API_KEY',
      'REVENUECAT_REST_API_KEY',
    ]);
    const v2ApiKey = explicitV2ApiKey ?? genericApiKey;

    if (v2ApiKey) {
      if (projectId) {
        addConfig({ version: 'v2', apiKey: v2ApiKey, projectId });
      } else if (explicitV2ApiKey) {
        this.logger.warn(
          'REVENUECAT_V2_API_KEY is configured, but REVENUECAT_PROJECT_ID is missing. ' +
            'Set REVENUECAT_PROJECT_ID so /subscription/sync can verify customers through RevenueCat API v2.',
        );
      }
    }

    const explicitV1ApiKey = this.getFirstConfigValue([
      'REVENUECAT_V1_API_KEY',
      'REVENUECAT_LEGACY_API_KEY',
      'REVENUECAT_PUBLIC_API_KEY',
    ]);
    const v1ApiKey =
      explicitV1ApiKey ?? (!projectId ? genericApiKey : undefined);
    if (v1ApiKey) addConfig({ version: 'v1', apiKey: v1ApiKey });

    return configs;
  }

  private getFirstConfigValue(
    keys: string[],
    predicate: (value: string) => boolean = () => true,
  ): string | undefined {
    return keys
      .map((key) => this.configService.get<string>(key)?.trim())
      .find((value): value is string => !!value && predicate(value));
  }

  private canTrustClientSyncFallback(): boolean {
    const explicit =
      this.configService.get<string>('REVENUECAT_TRUST_CLIENT_SYNC') ??
      this.configService.get<string>('REVENUECAT_ALLOW_CLIENT_SYNC_FALLBACK');

    if (explicit != null) {
      return ['1', 'true', 'yes'].includes(explicit.trim().toLowerCase());
    }

    const env =
      this.configService.get<string>('NODE_ENV') ?? process.env.NODE_ENV;
    return env !== 'production';
  }

  private trustedClientCustomerInfo(
    userId: string,
    customerInfo: Record<string, any> | undefined,
    revenueCatUserId?: string,
  ): Record<string, any> | undefined {
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

    return customerInfo;
  }

  private emptyRevenueCatCustomerInfo(userId: string): Record<string, any> {
    return {
      originalAppUserId: userId,
      entitlements: { active: {} },
    };
  }

  private async fetchSubscriberFromRevenueCat(
    userId: string,
    revenueCatV1ApiKey: string,
  ): Promise<Record<string, any>> {
    const url = `https://api.revenuecat.com/v1/subscribers/${encodeURIComponent(userId)}`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5_000);
    try {
      const res = await fetch(url, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${revenueCatV1ApiKey}`,
          'X-Platform': 'server',
          'Content-Type': 'application/json',
        },
        signal: controller.signal,
      });
      if (res.status === 404) {
        throw new RevenueCatCustomerNotFoundError();
      }
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

      const sub = data?.subscriber ?? {};
      return {
        originalAppUserId: sub?.original_app_user_id ?? userId,
        entitlements: { active: sub?.entitlements ?? {} },
      };
    } catch (err) {
      if (
        err instanceof ServiceUnavailableException ||
        err instanceof RevenueCatCustomerNotFoundError
      ) {
        throw err;
      }
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

  private async fetchCustomerFromRevenueCatV2(
    userId: string,
    revenueCatV2ApiKey: string,
    projectId: string,
  ): Promise<Record<string, any>> {
    const subscriptions = await this.fetchRevenueCatV2ListItems(
      `/projects/${encodeURIComponent(projectId)}/customers/${encodeURIComponent(
        userId,
      )}/subscriptions?limit=100`,
      revenueCatV2ApiKey,
    );

    const activeSubscription = this.pickActiveRevenueCatV2Subscription(
      subscriptions,
      SAVEFUL_ENTITLEMENT,
    );

    if (activeSubscription) {
      const productIdentifier = await this.resolveRevenueCatV2ProductIdentifier(
        projectId,
        revenueCatV2ApiKey,
        activeSubscription,
      );
      return this.subscriptionToCustomerInfo(
        userId,
        activeSubscription,
        productIdentifier,
      );
    }

    const purchases = await this.fetchRevenueCatV2ListItems(
      `/projects/${encodeURIComponent(projectId)}/customers/${encodeURIComponent(
        userId,
      )}/purchases?limit=100`,
      revenueCatV2ApiKey,
    );
    const activePurchase = this.pickActiveRevenueCatV2Purchase(
      purchases,
      SAVEFUL_ENTITLEMENT,
    );

    if (!activePurchase) {
      return {
        originalAppUserId: userId,
        entitlements: { active: {} },
      };
    }

    const productIdentifier = await this.resolveRevenueCatV2ProductIdentifier(
      projectId,
      revenueCatV2ApiKey,
      activePurchase,
    );
    return this.purchaseToCustomerInfo(
      userId,
      activePurchase,
      productIdentifier,
    );
  }

  private async fetchRevenueCatV2ListItems(
    initialPath: string,
    apiKey: string,
  ): Promise<any[]> {
    const items: any[] = [];
    let path: string | undefined = initialPath;

    for (let page = 0; path && page < 5; page += 1) {
      const data = await this.fetchRevenueCatV2(path, apiKey);
      if (Array.isArray(data?.items)) items.push(...data.items);
      path = typeof data?.next_page === 'string' ? data.next_page : undefined;
    }

    return items;
  }

  private async fetchRevenueCatV2(
    pathOrUrl: string,
    apiKey: string,
  ): Promise<Record<string, any>> {
    const url = this.revenueCatV2Url(pathOrUrl);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5_000);
    try {
      const res = await fetch(url, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        signal: controller.signal,
      });
      if (res.status === 404) {
        throw new RevenueCatCustomerNotFoundError();
      }
      if (!res.ok) {
        const body = await res.text().catch(() => '');
        this.logger.error(
          `RC REST v2 GET ${this.redactRevenueCatUrl(url)} failed: ${res.status} ${body.slice(0, 300)}`,
        );
        throw new ServiceUnavailableException(
          'Unable to verify subscription with RevenueCat',
        );
      }
      return (await res.json()) as Record<string, any>;
    } catch (err) {
      if (
        err instanceof ServiceUnavailableException ||
        err instanceof RevenueCatCustomerNotFoundError
      ) {
        throw err;
      }
      this.logger.error(`RC REST v2 fetch failed: ${(err as Error).message}`);
      throw new ServiceUnavailableException(
        'Unable to verify subscription with RevenueCat',
      );
    } finally {
      clearTimeout(timeout);
    }
  }

  private revenueCatV2Url(pathOrUrl: string): string {
    if (/^https?:\/\//i.test(pathOrUrl)) return pathOrUrl;
    const path = pathOrUrl.startsWith('/v2/')
      ? pathOrUrl.slice('/v2'.length)
      : pathOrUrl;
    return `https://api.revenuecat.com/v2${path.startsWith('/') ? path : `/${path}`}`;
  }

  private redactRevenueCatUrl(url: string): string {
    return url.replace(/\/customers\/([^/?]+)/, '/customers/[customer_id]');
  }

  private pickActiveRevenueCatV2Subscription(
    subscriptions: any[],
    entitlementId: string,
  ): any | undefined {
    // Pick the SUBSCRIPTION the user is actively on right now, not just the
    // one with the latest end date. When a user upgrades Hero → Legend, the
    // previous (Hero) subscription often still has a later
    // `current_period_ends_at` (longer cycle / proration) and would be
    // returned, hiding the just-purchased Legend. Sort by:
    //   1. most-recent `purchased_at` / `starts_at` (newest purchase wins)
    //   2. tier rank (legend > hero) as a tie-break
    //   3. latest end date as a final fallback
    const tierRank = (resource: any): number => {
      const id = String(resource?.product_id ?? '').toLowerCase();
      if (id.includes('legend')) return 2;
      if (id.includes('hero')) return 1;
      return 0;
    };
    return subscriptions
      .filter(
        (subscription) =>
          subscription?.gives_access === true &&
          this.hasRevenueCatV2Entitlement(subscription, entitlementId),
      )
      .sort((left, right) => {
        const leftPurchased = this.revenueCatMs(
          left?.purchased_at ?? left?.starts_at,
        );
        const rightPurchased = this.revenueCatMs(
          right?.purchased_at ?? right?.starts_at,
        );
        if (rightPurchased !== leftPurchased) {
          return rightPurchased - leftPurchased;
        }
        const tierDelta = tierRank(right) - tierRank(left);
        if (tierDelta !== 0) return tierDelta;
        const leftEnd = this.revenueCatMs(
          left?.current_period_ends_at ?? left?.ends_at,
        );
        const rightEnd = this.revenueCatMs(
          right?.current_period_ends_at ?? right?.ends_at,
        );
        return rightEnd - leftEnd;
      })[0];
  }

  private pickActiveRevenueCatV2Purchase(
    purchases: any[],
    entitlementId: string,
  ): any | undefined {
    return purchases
      .filter(
        (purchase) =>
          purchase?.status === 'owned' &&
          this.hasRevenueCatV2Entitlement(purchase, entitlementId),
      )
      .sort((left, right) => {
        const leftAt = this.revenueCatMs(left?.purchased_at);
        const rightAt = this.revenueCatMs(right?.purchased_at);
        return rightAt - leftAt;
      })[0];
  }

  private hasRevenueCatV2Entitlement(
    resource: any,
    entitlementId: string,
  ): boolean {
    const items = resource?.entitlements?.items;
    if (!Array.isArray(items) || items.length === 0) {
      return true;
    }
    return items.some(
      (entitlement) =>
        entitlement?.lookup_key === entitlementId ||
        entitlement?.id === entitlementId,
    );
  }

  private async resolveRevenueCatV2ProductIdentifier(
    projectId: string,
    apiKey: string,
    resource: any,
  ): Promise<string | undefined> {
    const productId =
      typeof resource?.product_id === 'string'
        ? resource.product_id.trim()
        : undefined;
    if (!productId) return undefined;
    if (this.mapsToKnownPlan(productId)) return productId;

    const cacheKey = `${projectId}:${productId}`;
    if (this.revenueCatV2ProductIdentifierCache.has(cacheKey)) {
      return this.revenueCatV2ProductIdentifierCache.get(cacheKey);
    }

    try {
      const product = await this.fetchRevenueCatV2(
        `/projects/${encodeURIComponent(projectId)}/products/${encodeURIComponent(
          productId,
        )}`,
        apiKey,
      );
      const storeIdentifier =
        typeof product?.store_identifier === 'string'
          ? product.store_identifier.trim()
          : undefined;
      const identifier = storeIdentifier || productId;
      this.revenueCatV2ProductIdentifierCache.set(cacheKey, identifier);
      return identifier;
    } catch (err) {
      this.logger.warn(
        `Unable to resolve RevenueCat v2 product ${productId} to a store identifier. ` +
          `Grant ${REVENUECAT_V2_PRODUCT_FETCH_PERMISSIONS} to improve Hero/Legend plan mapping.`,
      );
      this.revenueCatV2ProductIdentifierCache.set(cacheKey, productId);
      return productId;
    }
  }

  private mapsToKnownPlan(productId: string): boolean {
    return (
      !!PRODUCT_TO_PLAN[productId] ||
      PLAN_PREFIX_RULES.some((rule) => rule.match.test(productId))
    );
  }

  private planForProductId(
    productId: string | undefined,
  ): SubscriptionPlan | undefined {
    if (!productId) return undefined;
    if (PRODUCT_TO_PLAN[productId]) return PRODUCT_TO_PLAN[productId];
    return PLAN_PREFIX_RULES.find((rule) => rule.match.test(productId))?.plan;
  }

  private isAccessWebhookEvent(type: string | undefined): boolean {
    return !!type && WEBHOOK_ACCESS_EVENTS.has(type);
  }

  private subscriptionToCustomerInfo(
    userId: string,
    subscription: any,
    productIdentifier: string | undefined,
  ): Record<string, any> {
    const willRenew = [
      'will_renew',
      'will_change_product',
      'has_already_renewed',
    ].includes(subscription?.auto_renewal_status);
    const periodType = subscription?.status === 'trialing' ? 'TRIAL' : 'NORMAL';
    const expiresAt = this.isoFromRevenueCatMs(
      subscription?.current_period_ends_at ?? subscription?.ends_at,
    );

    const unsubscribeDetectedAt =
      this.isoFromRevenueCatMs(subscription?.unsubscribe_detected_at) ??
      (subscription?.auto_renewal_status === 'unsubscribed'
        ? new Date().toISOString()
        : null);

    return {
      originalAppUserId:
        subscription?.original_customer_id ??
        subscription?.customer_id ??
        userId,
      entitlements: {
        active: {
          [SAVEFUL_ENTITLEMENT]: {
            product_identifier: productIdentifier,
            expires_date: expiresAt,
            purchase_date: this.isoFromRevenueCatMs(
              subscription?.current_period_starts_at ?? subscription?.starts_at,
            ),
            period_type: periodType,
            store: subscription?.store,
            will_renew: willRenew,
            unsubscribe_detected_at: unsubscribeDetectedAt,
          },
        },
      },
    };
  }

  private purchaseToCustomerInfo(
    userId: string,
    purchase: any,
    productIdentifier: string | undefined,
  ): Record<string, any> {
    return {
      originalAppUserId:
        purchase?.original_customer_id ?? purchase?.customer_id ?? userId,
      entitlements: {
        active: {
          [SAVEFUL_ENTITLEMENT]: {
            product_identifier: productIdentifier,
            expires_date: null,
            purchase_date: this.isoFromRevenueCatMs(purchase?.purchased_at),
            period_type: 'NORMAL',
            store: purchase?.store,
            will_renew: false,
          },
        },
      },
    };
  }

  private revenueCatMs(value: unknown): number {
    return this.revenueCatDate(value)?.getTime() ?? 0;
  }

  private isoFromRevenueCatMs(value: unknown): string | null {
    return this.revenueCatDate(value)?.toISOString() ?? null;
  }

  private revenueCatDate(value: unknown): Date | null {
    if (value instanceof Date && Number.isFinite(value.getTime())) {
      return value;
    }
    if (typeof value === 'number' && Number.isFinite(value)) {
      const ms = Math.abs(value) < 1_000_000_000_000 ? value * 1000 : value;
      const date = new Date(ms);
      return Number.isFinite(date.getTime()) ? date : null;
    }
    if (typeof value === 'string') {
      const trimmed = value.trim();
      if (!trimmed) return null;
      const numeric = Number(trimmed);
      if (Number.isFinite(numeric)) {
        return this.revenueCatDate(numeric);
      }
      const date = new Date(trimmed);
      return Number.isFinite(date.getTime()) ? date : null;
    }
    return null;
  }

 
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
    const entitlementIds: string[] = Array.isArray(event?.entitlement_ids)
      ? event.entitlement_ids
      : event?.entitlement_id
        ? [event.entitlement_id]
        : [];
    const productId: string | undefined = event?.product_id;

    const commit = async (
      set: Record<string, any>,
      unset?: Record<string, ''>,
    ) => {
      const filter: Record<string, any> = { userId: uid };
      if (eventId) filter.lastEventId = { $ne: eventId };
      filter.$or = [
        { lastEventAt: { $exists: false } },
        { lastEventAt: { $lte: eventAt } },
      ];
    const update: Record<string, any> = {
        $set: {
          ...set,
          lastEventId: eventId,
          lastEventAt: eventAt,
        },
      };
      if (unset && Object.keys(unset).length > 0) {
        update.$unset = unset;
        for (const field of Object.keys(unset)) {
          delete update.$set[field];
        }
      }
      const res = await this.subscriptionModel.updateOne(filter, update);
      if (res.modifiedCount === 0) {
        this.logger.log(
          `RC webhook skipped (dedup/ordering) type=${event?.type} id=${eventId}`,
        );
      }
    };

    try {
      if (type === 'EXPIRATION' || type === 'REFUND' || type === 'TRANSFER') {
        await commit({
          plan: 'basic',
          status:
            type === 'EXPIRATION' &&
            event?.expiration_reason === 'SUBSCRIPTION_PAUSED'
              ? 'paused'
              : 'expired',
          willRenew: false,
          lastCustomerInfo: event,
        });
        return;
      }
      if (type === 'BILLING_ISSUE') {
        const expiresAt = event?.expiration_at_ms
          ? new Date(event.expiration_at_ms)
          : existing?.expiresAt;
        const stillPaid =
          !!existing?.plan &&
          existing.plan !== 'basic' &&
          (!expiresAt || expiresAt.getTime() > Date.now());
        await commit(
          stillPaid
            ? {
                status: 'active',
                willRenew: false,
                expiresAt: expiresAt ?? existing?.expiresAt,
                lastCustomerInfo: event,
              }
            : {
                plan: 'basic',
                status: 'expired',
                willRenew: false,
                lastCustomerInfo: event,
              },
        );
        return;
      }
      if (type === 'UNCANCELLATION') {
        const expiresAt = event?.expiration_at_ms
          ? new Date(event.expiration_at_ms)
          : existing?.expiresAt;
        const paidPlan =
          (existing?.plan && existing.plan !== 'basic'
            ? existing.plan
            : undefined) ?? this.planForProductId(productId);
        if (paidPlan) {
          await commit(
            {
              plan: paidPlan,
              status: 'active',
              productId: productId ?? existing?.productId,
              expiresAt,
              willRenew: true,
              revenueCatUserId: appUserId,
              lastCustomerInfo: event,
            },
            { cancelledAt: '' },
          );
          return;
        }
      }

      if (type === 'SUBSCRIPTION_PAUSED' && entitlementIds.length === 0) {
        await commit({
          status: existing?.status === 'in_trial' ? 'in_trial' : 'active',
          willRenew: false,
          lastCustomerInfo: event,
        });
        return;
      }

      if (type === 'CANCELLATION' && entitlementIds.length === 0) {
        const eventExpiresAt = event?.expiration_at_ms
          ? new Date(event.expiration_at_ms)
          : undefined;
        const expiresAt = eventExpiresAt ?? existing?.expiresAt;
        const existingPaidPlan =
          existing?.plan && existing.plan !== 'basic'
            ? existing.plan
            : undefined;
        const paidPlan =
          existingPaidPlan ??
          this.planForProductId(productId) ??
          this.planForProductId(existing?.productId);
        const hasCurrentAccess =
          !!paidPlan && !!expiresAt && expiresAt.getTime() > Date.now();

        await commit(
          hasCurrentAccess
            ? {
                plan: paidPlan,
                status: 'cancelled',
                productId: productId ?? existing?.productId,
                expiresAt,
                willRenew: false,
                cancelledAt: eventAt,
                revenueCatUserId: appUserId,
                lastCustomerInfo: event,
              }
            : {
                plan: 'basic',
                status: 'expired',
                willRenew: false,
                cancelledAt: eventAt,
                revenueCatUserId: appUserId,
                lastCustomerInfo: event,
              },
        );
        return;
      }

      // PRODUCT_CHANGE = the user switched products inside the store
      // (e.g. Hero → Legend, monthly → yearly, downgrade scheduled for the
      // next renewal). The event payload alone is not always enough to know
      // which product is currently active vs. queued for next period, so we
      // re-verify the customer's full state with RevenueCat. If verification
      // fails we still apply a best-effort update from the event so the user
      // is not left on a stale plan.
      if (type === 'PRODUCT_CHANGE') {
        try {
          const verifiedInfo = await this.verifyCustomerWithRevenueCat(
            appUserId,
            { throwOnFailure: false },
          );
          if (verifiedInfo) {
            const parsed = parseCustomerInfo(
              verifiedInfo,
              SAVEFUL_ENTITLEMENT,
              existing?.plan,
            );
            // If the verified state has no cancellation marker, explicitly
            // clear any prior `cancelledAt` so the user is not stuck in a
            // "cancelled" UI state after re-upgrading.
            const unset: Record<string, ''> = {};
            if (!parsed.cancelledAt) unset.cancelledAt = '';
            if (!parsed.trialEndsAt) unset.trialEndsAt = '';
            await commit(
              {
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
                lastCustomerInfo: verifiedInfo,
              },
              unset,
            );
            return;
          }
        } catch (err) {
          this.logger.warn(
            `RC webhook PRODUCT_CHANGE re-verification failed for user=${appUserId}: ${(err as Error).message}. Falling back to event payload.`,
          );
        }
      }

      const effectiveProductId: string | undefined =
        (type === 'PRODUCT_CHANGE' && event?.new_product_id) ||
        productId ||
        existing?.productId;
      const active: Record<string, any> = {};
      const shouldSetActiveEntitlement =
        entitlementIds.includes(SAVEFUL_ENTITLEMENT) ||
        type === 'PRODUCT_CHANGE' ||
        (entitlementIds.length === 0 &&
          this.isAccessWebhookEvent(type) &&
          (!!effectiveProductId ||
            (!!existing?.plan && existing.plan !== 'basic')));

      if (shouldSetActiveEntitlement) {
        active[SAVEFUL_ENTITLEMENT] = {
          product_identifier: effectiveProductId,
          expires_date: event?.expiration_at_ms
            ? new Date(event.expiration_at_ms).toISOString()
            : undefined,
          purchase_date: event?.purchased_at_ms
            ? new Date(event.purchased_at_ms).toISOString()
            : undefined,
          period_type: event?.period_type,
          store: event?.store,
          will_renew: !['CANCELLATION', 'SUBSCRIPTION_PAUSED'].includes(
            type ?? '',
          ),
          unsubscribe_detected_at:
            type === 'CANCELLATION' ? new Date(eventAt).toISOString() : null,
        };
      }

      const customerInfo = {
        originalAppUserId: appUserId,
        entitlements: { active },
      };
      const parsed = parseCustomerInfo(
        customerInfo,
        SAVEFUL_ENTITLEMENT,
        existing?.plan,
      );
      const unset: Record<string, ''> = {};
      if (!parsed.cancelledAt) unset.cancelledAt = '';
      if (!parsed.trialEndsAt) unset.trialEndsAt = '';
      await commit(
        {
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
        },
        unset,
      );
    } catch (err) {
      this.logger.error(
        `RC webhook processing failed: ${(err as Error).message}`,
      );
      throw err;
    }
  }

  async hasFeature(userId: string, feature: FeatureKey): Promise<boolean> {
    const plan = await this.getPlan(userId);
    return PLANS[plan].features.includes(feature);
  }

  async assertFeature(userId: string, feature: FeatureKey): Promise<void> {
    const ok = await this.hasFeature(userId, feature);
    if (!ok) {
      const currentPlan = await this.getPlan(userId);
      throw new ForbiddenException({
        code: 'UPGRADE_REQUIRED',
        feature,
        // Tell the client which paid tier actually grants the feature so the
        // paywall can highlight the right plan. We pick the lowest-ranked
        // paid plan that includes the feature — e.g. `barcode_scanning` is
        // legend-only, `smart_meal_planning` is hero+. This keeps the
        // backend as the single source of truth instead of the app having
        // to mirror the feature→plan mapping.
        requiredPlan: this.minimumPaidPlanForFeature(feature),
        currentPlan,
        message: 'Upgrade required to use this feature',
      });
    }
  }

  private minimumPaidPlanForFeature(
    feature: FeatureKey,
  ): Exclude<SubscriptionPlan, 'basic'> {
    if (PLANS.hero.features.includes(feature)) return 'hero';
    return 'legend';
  }

  async getLimit(userId: string, key: LimitKey): Promise<number> {
    const plan = await this.getPlan(userId);
    return PLANS[plan].limits[key];
  }

  async getCurrentUsagePeriod(userId: string) {
    const { sub, plan } = await this.resolveActiveSubscription(userId);
    return currentUsagePeriod({
      plan,
      purchasedAt: sub.purchasedAt,
      expiresAt: sub.expiresAt,
      productId: sub.productId,
      periodType: sub.periodType,
    });
  }

  async getUsage(userId: string): Promise<SubscriptionUsageDocument> {
    const uid = toObjectId(userId);
    const { periodKey, periodStart, periodEnd } =
      await this.getCurrentUsagePeriod(userId);
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
    const limitKey = USAGE_COUNTER_LIMITS[key];
    const limit = planDef.limits[limitKey];

    const uid = toObjectId(userId);
    const { periodKey, periodStart, periodEnd } =
      await this.getCurrentUsagePeriod(userId);

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
  async checkLimit(
    userId: string,
    key: UsageCounterKey,
  ): Promise<{ used: number; limit: number; remaining: number }> {
    const plan = await this.getPlan(userId);
    const limitKey = USAGE_COUNTER_LIMITS[key];
    const limit = PLANS[plan].limits[limitKey];
    const usage = await this.getUsage(userId);
    const used = ((usage as any)[key] ?? 0) as number;
    return {
      used,
      limit,
      remaining:
        limit === UNLIMITED
          ? Number.POSITIVE_INFINITY
          : Math.max(0, limit - used),
    };
  }

  async refundUsage(
    userId: string,
    key: UsageCounterKey,
    amount = 1,
  ): Promise<void> {
    if (amount <= 0) return;
    const uid = toObjectId(userId);
    const { periodKey } = await this.getCurrentUsagePeriod(userId);
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

  async getSubscriptionSnapshot(userId: string) {
    // Read-only: never insert a Subscription doc just to render the
    // snapshot — that was making manual DB cleanup pointless because every
    // app launch resurrected the row. Sync (purchase / restore / webhook)
    // remains the only write path.
    const { sub, plan } = await this.resolveActiveSubscription(userId, {
      readOnly: true,
    });

    // `effectivePlan` reflects what features the user should ACTUALLY get
    // right now, independent of the most recent product they were billed
    // for. We drop to 'basic' immediately when the user cancelled while
    // still inside a free-trial — the user expectation is that cancelling
    // a trial means "I never really subscribed" and the paywall should
    // not keep showing them as a Hero customer. Non-trial cancellations
    // keep the grace-period behaviour (paid until `expiresAt`).
    const isTrialPeriod =
      sub.periodType === 'trial' || sub.periodType === 'intro';
    const cancelledTrial =
      sub.status === 'cancelled' && !sub.willRenew && isTrialPeriod;
    const effectivePlan: SubscriptionPlan = cancelledTrial ? 'basic' : plan;
    const def = PLANS[effectivePlan];

    const period = currentUsagePeriod({
      plan: effectivePlan,
      purchasedAt: sub.purchasedAt,
      expiresAt: sub.expiresAt,
      productId: sub.productId,
      periodType: sub.periodType,
    });
    // Read-only usage lookup — only insert if a row already exists, since a
    // genuine increment path will create it. Returning zeros for a
    // brand-new user is the correct snapshot.
    const uid = toObjectId(userId);
    const usageDoc = await this.usageModel.findOne({
      userId: uid,
      periodKey: period.periodKey,
    });
    const aiMealsUsed = (usageDoc as any)?.aiMealsUsed ?? 0;
    const kitchenScansUsed = (usageDoc as any)?.kitchenScansUsed ?? 0;
    const trialsConsumed = (sub as any)?.trialsConsumed ?? {};
    return {
      // `plan` is what the rest of the app reads for gating / UI tier
      // colours; we use the effective plan so a cancelled-trial user is
      // treated as Basic immediately.
      plan: effectivePlan,
      // `billedPlan` is the most recently purchased tier — used by the
      // Manage screen to render "Saveful Hero · Cancelled" copy while
      // gating remains on Basic.
      billedPlan: plan,
      effectivePlan,
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
      cancelledAt: sub.cancelledAt,
      trialCancelled: cancelledTrial,
      trialsConsumed: {
        hero: trialsConsumed.hero ?? null,
        legend: trialsConsumed.legend ?? null,
      },
      features: def.features,
      limits: def.limits,
      usage: {
        aiMealsUsed,
        kitchenScansUsed,
        periodKey: period.periodKey,
        periodEnd: period.periodEnd,
      },
    };
  }

  async recordCancelFeedback(
    userId: string,
    feedback: {
      reason: string;
      details?: string;
      productId?: string;
      plan?: string;
    },
  ): Promise<void> {
    const uid = toObjectId(userId);
    await this.subscriptionModel.updateOne(
      { userId: uid },
      {
        $set: {
          cancelFeedback: {
            reason: feedback.reason,
            details: feedback.details,
            productId: feedback.productId,
            plan: feedback.plan,
            submittedAt: new Date(),
          },
        },
      },
      { upsert: true },
    );
    this.logger.log(
      `Cancel feedback user=${userId} reason=${feedback.reason} plan=${feedback.plan ?? '-'}`,
    );
  }
}
