import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import {
  ReferralAttribution,
  ReferralAttributionDocument,
  ReferralAttributionStatus,
  ReferralSource,
  REFERRAL_SOURCES,
} from '../../database/schemas/referral-attribution.schema';
import {
  ChefProfile,
  ChefProfileDocument,
} from '../../database/schemas/chef-profile.schema';
import {
  Subscription,
  SubscriptionDocument,
} from '../../database/schemas/subscription.schema';
import {
  User,
  UserDocument,
  UserRole,
} from '../../database/schemas/user.auth.schema';
import { TRIAL_DAYS } from '../subscription/subscription.constants';
import { ReferralCodeService } from './referral-code.service';
import {
  REFERRAL_ANDROID_OFFER_TAG,
  REFERRAL_COMMISSION_RATE_BPS,
  REFERRAL_CUSTOMER_DISCOUNT_PERCENT,
  ReferralBindRejection,
} from './referral.constants';
import { candidateUserIds } from './referral-math';

export type BindResult =
  | { status: 'bound' | 'already_bound'; referral: PublicReferral }
  | { status: 'rejected'; reason: ReferralBindRejection };

export interface PublicReferral {
  code: string;
  boundAt: Date;
  status: ReferralAttributionStatus;
  chef: {
    displayName: string;
    slug: string | null;
    avatarImageUrl: string | null;
  };
}

function isDuplicateKey(error: any): boolean {
  return error?.code === 11000;
}

function toSource(source: unknown): ReferralSource {
  return (REFERRAL_SOURCES as readonly string[]).includes(source as string)
    ? (source as ReferralSource)
    : 'manual';
}

@Injectable()
export class ReferralAttributionService {
  private readonly logger = new Logger(ReferralAttributionService.name);
  private iosOfferCodes: Record<string, string> | null = null;

  constructor(
    @InjectModel(ReferralAttribution.name)
    private readonly attributionModel: Model<ReferralAttributionDocument>,
    @InjectModel(ChefProfile.name)
    private readonly chefProfileModel: Model<ChefProfileDocument>,
    @InjectModel(Subscription.name)
    private readonly subscriptionModel: Model<SubscriptionDocument>,
    @InjectModel(User.name)
    private readonly userModel: Model<UserDocument>,
    private readonly codeService: ReferralCodeService,
    private readonly config: ConfigService,
  ) {}

  // ---------------------------------------------------------------------------
  // Binding
  // ---------------------------------------------------------------------------

  /**
   * Locks a never-subscribed customer to the chef behind `rawCode`. The first
   * valid code wins; later codes return `already_bound` with the original chef.
   */
  async bind(userId: string, rawCode: unknown, source: unknown): Promise<BindResult> {
    if (!Types.ObjectId.isValid(userId)) {
      return { status: 'rejected', reason: ReferralBindRejection.USER_NOT_FOUND };
    }
    const subscriberId = new Types.ObjectId(userId);

    const existing = await this.attributionModel.findOne({ subscriberUserId: subscriberId });
    if (existing) {
      return { status: 'already_bound', referral: await this.toPublic(existing) };
    }

    const resolved = await this.codeService.resolveActive(rawCode);
    if (!resolved) {
      return { status: 'rejected', reason: ReferralBindRejection.INVALID_CODE };
    }

    const user = await this.userModel.findById(subscriberId).select({ role: 1 }).lean();
    if (!user) {
      return { status: 'rejected', reason: ReferralBindRejection.USER_NOT_FOUND };
    }
    if (resolved.chefUser._id.toString() === userId) {
      return { status: 'rejected', reason: ReferralBindRejection.SELF_REFERRAL };
    }
    if (user.role && user.role !== UserRole.USER) {
      return { status: 'rejected', reason: ReferralBindRejection.NOT_ELIGIBLE_ROLE };
    }
    if (await this.hasSubscriptionHistory(subscriberId)) {
      return { status: 'rejected', reason: ReferralBindRejection.ALREADY_SUBSCRIBED };
    }

    const { code, chefUser, chefProfile } = resolved;
    try {
      const created = await this.attributionModel.create({
        subscriberUserId: subscriberId,
        chefUserId: chefUser._id,
        chefProfileId: chefProfile?._id ?? null,
        chefDisplayName: chefProfile?.displayName || chefUser.name,
        codeId: code._id,
        code: code.code,
        source: toSource(source),
        boundAt: new Date(),
        status: ReferralAttributionStatus.BOUND,
        commissionRateBps: REFERRAL_COMMISSION_RATE_BPS,
        audit: [
          {
            at: new Date(),
            by: subscriberId,
            action: 'bound',
            fromChefUserId: null,
            toChefUserId: chefUser._id,
            note: `source=${toSource(source)}`,
          },
        ],
      });
      return { status: 'bound', referral: await this.toPublic(created) };
    } catch (error) {
      if (!isDuplicateKey(error)) throw error;
      const winner = await this.attributionModel.findOne({ subscriberUserId: subscriberId });
      return { status: 'already_bound', referral: await this.toPublic(winner!) };
    }
  }

  /** For signup: a referral problem must never fail account creation. */
  async bindSafely(userId: string, rawCode: unknown, source: unknown): Promise<BindResult | null> {
    try {
      const result = await this.bind(userId, rawCode, source);
      if (result.status === 'rejected') {
        this.logger.log(`Referral not bound for ${userId}: ${result.reason}`);
      }
      return result;
    } catch (error: any) {
      this.logger.error(`Referral bind failed for ${userId}: ${error.message}`);
      return null;
    }
  }

  private async hasSubscriptionHistory(userId: Types.ObjectId): Promise<boolean> {
    const sub = await this.subscriptionModel.findOne({ userId }).lean();
    if (!sub) return false;
    return Boolean(
      sub.purchasedAt ||
        sub.trialsConsumed?.hero ||
        sub.trialsConsumed?.legend ||
        (sub.plan && sub.plan !== 'basic'),
    );
  }

  // ---------------------------------------------------------------------------
  // Customer view
  // ---------------------------------------------------------------------------

  async getMine(userId: string) {
    const subscriberId = new Types.ObjectId(userId);
    const attribution = await this.attributionModel.findOne({ subscriberUserId: subscriberId });
    const eligible =
      !!attribution &&
      attribution.status === ReferralAttributionStatus.BOUND &&
      !(await this.hasSubscriptionHistory(subscriberId));

    return {
      referral: attribution ? await this.toPublic(attribution) : null,
      discount: {
        eligible,
        percent: REFERRAL_CUSTOMER_DISCOUNT_PERCENT,
        trialDays: TRIAL_DAYS,
        ios: {
          appStoreId: this.config.get<string>('REFERRAL_APPLE_APP_ID') || null,
          offerCodes: this.getIosOfferCodes(),
        },
        android: { offerTag: REFERRAL_ANDROID_OFFER_TAG },
      },
    };
  }

  /** `REFERRAL_IOS_OFFER_CODES` = JSON map of App Store product id → custom offer code. */
  private getIosOfferCodes(): Record<string, string> {
    if (this.iosOfferCodes) return this.iosOfferCodes;
    const raw = this.config.get<string>('REFERRAL_IOS_OFFER_CODES');
    let parsed: Record<string, string> = {};
    if (raw) {
      try {
        const value = JSON.parse(raw);
        if (value && typeof value === 'object') {
          parsed = Object.fromEntries(
            Object.entries(value).filter(
              ([key, code]) => typeof key === 'string' && typeof code === 'string' && code,
            ),
          ) as Record<string, string>;
        }
      } catch {
        this.logger.error('REFERRAL_IOS_OFFER_CODES is not valid JSON');
      }
    }
    this.iosOfferCodes = parsed;
    return parsed;
  }

  private async toPublic(attribution: ReferralAttributionDocument): Promise<PublicReferral> {
    const profile = attribution.chefProfileId
      ? await this.chefProfileModel
          .findById(attribution.chefProfileId)
          .select({ displayName: 1, slug: 1, avatarImageUrl: 1 })
          .lean()
      : null;
    return {
      code: attribution.code,
      boundAt: attribution.boundAt,
      status: attribution.status,
      chef: {
        displayName: profile?.displayName || attribution.chefDisplayName,
        slug: profile?.slug ?? null,
        avatarImageUrl: profile?.avatarImageUrl ?? null,
      },
    };
  }

  // ---------------------------------------------------------------------------
  // Ledger hooks
  // ---------------------------------------------------------------------------

  /**
   * The live attribution a RevenueCat event belongs to: by store subscription
   * first (survives transfers between app users), then by app user ids.
   */
  async findForEvent(event: any): Promise<ReferralAttributionDocument | null> {
    const originalTransactionId: string | undefined = event?.original_transaction_id;
    if (originalTransactionId) {
      const byTransaction = await this.attributionModel.findOne({
        originalTransactionId,
        status: { $ne: ReferralAttributionStatus.VOID },
      });
      if (byTransaction) return byTransaction;
    }

    const userIds = candidateUserIds(event).map((id) => new Types.ObjectId(id));
    if (userIds.length === 0) return null;
    return this.attributionModel.findOne({
      subscriberUserId: { $in: userIds },
      status: { $ne: ReferralAttributionStatus.VOID },
    });
  }

  async recordTrialStart(attribution: ReferralAttributionDocument, event: any, at: Date) {
    const set: Record<string, unknown> = {
      store: event?.store ?? attribution.store,
      productId: event?.product_id ?? attribution.productId,
    };
    if (!attribution.originalTransactionId && event?.original_transaction_id) {
      set.originalTransactionId = event.original_transaction_id;
    }
    if (!attribution.trialStartedAt) set.trialStartedAt = at;
    if (attribution.status === ReferralAttributionStatus.BOUND) {
      set.status = ReferralAttributionStatus.TRIALING;
    }
    await this.attributionModel.updateOne({ _id: attribution._id }, { $set: set });
  }

  async recordPayment(attribution: ReferralAttributionDocument, event: any, at: Date) {
    const set: Record<string, unknown> = {
      status: ReferralAttributionStatus.PAYING,
      store: event?.store ?? attribution.store,
      productId: event?.product_id ?? attribution.productId,
    };
    if (!attribution.originalTransactionId && event?.original_transaction_id) {
      set.originalTransactionId = event.original_transaction_id;
    }
    // Not $min: Mongo orders null before dates, so $min would keep a null.
    if (!attribution.firstPaidAt || at < attribution.firstPaidAt) {
      set.firstPaidAt = at;
    }
    await this.attributionModel.updateOne(
      { _id: attribution._id, status: { $ne: ReferralAttributionStatus.VOID } },
      { $set: set, $max: { lastPaidAt: at } },
    );
  }

  async recordLapse(attribution: ReferralAttributionDocument) {
    await this.attributionModel.updateOne(
      {
        _id: attribution._id,
        status: { $in: [ReferralAttributionStatus.TRIALING, ReferralAttributionStatus.PAYING] },
      },
      { $set: { status: ReferralAttributionStatus.LAPSED } },
    );
  }

  async recordReactivation(attribution: ReferralAttributionDocument) {
    await this.attributionModel.updateOne(
      { _id: attribution._id, status: ReferralAttributionStatus.LAPSED },
      {
        $set: {
          status: attribution.firstPaidAt
            ? ReferralAttributionStatus.PAYING
            : ReferralAttributionStatus.TRIALING,
        },
      },
    );
  }

  // ---------------------------------------------------------------------------
  // Chef + admin views
  // ---------------------------------------------------------------------------

  async countsForChef(chefUserId: string) {
    const rows = await this.attributionModel.aggregate<{ _id: string; count: number }>([
      { $match: { chefUserId: new Types.ObjectId(chefUserId) } },
      { $group: { _id: '$status', count: { $sum: 1 } } },
    ]);
    const byStatus = Object.fromEntries(rows.map((row) => [row._id, row.count]));
    const count = (status: ReferralAttributionStatus) => byStatus[status] ?? 0;
    return {
      signups:
        count(ReferralAttributionStatus.BOUND) +
        count(ReferralAttributionStatus.TRIALING) +
        count(ReferralAttributionStatus.PAYING) +
        count(ReferralAttributionStatus.LAPSED),
      trialing: count(ReferralAttributionStatus.TRIALING),
      paying: count(ReferralAttributionStatus.PAYING),
      lapsed: count(ReferralAttributionStatus.LAPSED),
    };
  }

  async listForAdmin(filter: {
    chefUserId?: string;
    status?: string;
    page?: number;
    limit?: number;
  }) {
    const query: Record<string, unknown> = {};
    if (filter.chefUserId && Types.ObjectId.isValid(filter.chefUserId)) {
      query.chefUserId = new Types.ObjectId(filter.chefUserId);
    }
    if (filter.status) query.status = filter.status;
    const limit = Math.min(Math.max(filter.limit ?? 50, 1), 200);
    const page = Math.max(filter.page ?? 1, 1);

    const [items, total] = await Promise.all([
      this.attributionModel
        .find(query)
        .sort({ boundAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .populate('subscriberUserId', 'email name')
        .lean(),
      this.attributionModel.countDocuments(query),
    ]);
    return {
      items: items.map(({ subscriberUserId, ...rest }: any) => ({
        ...rest,
        subscriberUserId: subscriberUserId?._id ?? subscriberUserId ?? null,
        subscriber: subscriberUserId?.email
          ? { email: subscriberUserId.email, name: subscriberUserId.name }
          : null,
      })),
      total,
      page,
      limit,
    };
  }

  async voidByAdmin(id: string, adminUserId: string, note: string) {
    const attribution = await this.loadEditable(id);
    attribution.status = ReferralAttributionStatus.VOID;
    attribution.audit.push({
      at: new Date(),
      by: new Types.ObjectId(adminUserId),
      action: 'voided',
      fromChefUserId: attribution.chefUserId,
      toChefUserId: null,
      note: note ?? '',
    });
    await attribution.save();
    return attribution.toObject();
  }

  async reassignByAdmin(id: string, rawCode: string, adminUserId: string, note: string) {
    const attribution = await this.loadEditable(id);
    const resolved = await this.codeService.resolveActive(rawCode);
    if (!resolved) throw new BadRequestException('Referral code not found or disabled');
    if (resolved.chefUser._id.toString() === attribution.subscriberUserId.toString()) {
      throw new BadRequestException('A chef cannot be credited for their own account');
    }

    const fromChef = attribution.chefUserId;
    attribution.chefUserId = resolved.chefUser._id as Types.ObjectId;
    attribution.chefProfileId = (resolved.chefProfile?._id as Types.ObjectId) ?? null;
    attribution.chefDisplayName = resolved.chefProfile?.displayName || resolved.chefUser.name;
    attribution.codeId = resolved.code._id as Types.ObjectId;
    attribution.code = resolved.code.code;
    if (attribution.status === ReferralAttributionStatus.VOID) {
      attribution.status = attribution.trialStartedAt
        ? ReferralAttributionStatus.TRIALING
        : ReferralAttributionStatus.BOUND;
    }
    attribution.audit.push({
      at: new Date(),
      by: new Types.ObjectId(adminUserId),
      action: 'reassigned',
      fromChefUserId: fromChef,
      toChefUserId: attribution.chefUserId,
      note: note ?? '',
    });
    await attribution.save();
    return attribution.toObject();
  }

  /** Credit can only move before the first paid transaction. */
  private async loadEditable(id: string) {
    if (!Types.ObjectId.isValid(id)) throw new BadRequestException('Invalid id');
    const attribution = await this.attributionModel.findById(id);
    if (!attribution) throw new NotFoundException('Referral not found');
    if (attribution.firstPaidAt) {
      throw new BadRequestException(
        'This referral already has paid transactions; use a ledger adjustment instead',
      );
    }
    return attribution;
  }
}
