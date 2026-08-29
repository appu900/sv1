import {
  ForbiddenException,
  Injectable,
  Logger,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import {
  SubscriptionUsage,
  SubscriptionUsageDocument,
} from '../../database/schemas/subscription-usage.schema';
import { SubscriptionService } from '../subscription/subscription.service';
import { PLANS, UNLIMITED } from '../subscription/subscription.constants';


@Injectable()
export class KitchenScanUsageService {
  private readonly logger = new Logger(KitchenScanUsageService.name);

  constructor(
    @InjectModel(SubscriptionUsage.name)
    private readonly usageModel: Model<SubscriptionUsageDocument>,
    private readonly subscriptionService: SubscriptionService,
  ) {}

  private planLimit(plan: 'basic' | 'hero' | 'legend'): number {
    return PLANS[plan].limits.kitchenScansPerMonth;
  }

  async getUsage(userId: string): Promise<{
    count: number;
    remaining: number | null;
    limit: number | null;
    unlimited: boolean;
    plan: 'basic' | 'hero' | 'legend';
    lastUsedAt?: Date;
    periodKey: string;
    periodEnd: Date;
  }> {
    const plan = await this.subscriptionService.getPlan(userId);
    const limit = this.planLimit(plan);
    const unlimited = limit === UNLIMITED;

    const { periodKey, periodStart, periodEnd } =
      await this.subscriptionService.getCurrentUsagePeriod(userId);
    const uid = new Types.ObjectId(userId);
    const doc = await this.usageModel
      .findOneAndUpdate(
        { userId: uid, periodKey },
        { $setOnInsert: { userId: uid, periodKey, periodStart, periodEnd } },
        { upsert: true, new: true, setDefaultsOnInsert: true },
      )
      .exec();

    const count = doc?.kitchenScansUsed ?? 0;
    return {
      count,
      remaining: unlimited ? null : Math.max(0, limit - count),
      limit: unlimited ? null : limit,
      unlimited,
      plan,
      lastUsedAt: (doc as any)?.updatedAt,
      periodKey,
      periodEnd,
    };
  }

  async reserve(userId: string): Promise<{
    count: number;
    remaining: number;
    limit: number;
    unlimited: boolean;
    plan: 'basic' | 'hero' | 'legend';
  }> {
    const plan = await this.subscriptionService.getPlan(userId);
    const limit = this.planLimit(plan);
    const unlimited = limit === UNLIMITED;

    const uid = new Types.ObjectId(userId);
    const { periodKey, periodStart, periodEnd } =
      await this.subscriptionService.getCurrentUsagePeriod(userId);

    if (unlimited) {
      const doc = await this.usageModel
        .findOneAndUpdate(
          { userId: uid, periodKey },
          {
            $inc: { kitchenScansUsed: 1 },
            $setOnInsert: { userId: uid, periodKey, periodStart, periodEnd },
          },
          { upsert: true, new: true },
        )
        .exec();
      return {
        count: doc!.kitchenScansUsed,
        remaining: Number.POSITIVE_INFINITY,
        limit: UNLIMITED,
        unlimited: true,
        plan,
      };
    }

    await this.usageModel
      .updateOne(
        { userId: uid, periodKey },
        { $setOnInsert: { userId: uid, periodKey, periodStart, periodEnd } },
        { upsert: true },
      )
      .exec();

    const planLabel = PLANS[plan].label;
    const denyLimit = (): never => {
      throw new ForbiddenException({
        code: 'LIMIT_REACHED',
        limit: 'kitchenScansPerMonth',
        cap: limit,
        plan,
        message: `You have used all ${limit} of your kitchen photo scans this billing cycle on the ${planLabel} plan. Upgrade to keep scanning.`,
      });
    };

    try {
      const doc = await this.usageModel
        .findOneAndUpdate(
          {
            userId: uid,
            periodKey,
            kitchenScansUsed: { $lte: limit - 1 },
          },
          { $inc: { kitchenScansUsed: 1 } },
          { new: true },
        )
        .exec();
      if (!doc || doc.kitchenScansUsed > limit) denyLimit();
      return {
        count: doc!.kitchenScansUsed,
        remaining: Math.max(0, limit - doc!.kitchenScansUsed),
        limit,
        unlimited: false,
        plan,
      };
    } catch (err: any) {
      if (err?.code === 11000) denyLimit();
      throw err;
    }
  }

  async rollback(userId: string): Promise<void> {
    const uid = new Types.ObjectId(userId);
    const { periodKey } =
      await this.subscriptionService.getCurrentUsagePeriod(userId);
    try {
      await this.usageModel
        .updateOne(
          { userId: uid, periodKey, kitchenScansUsed: { $gte: 1 } },
          { $inc: { kitchenScansUsed: -1 } },
        )
        .exec();
    } catch (err: any) {
      this.logger.warn(
        `Failed to rollback kitchen-scan usage for user ${userId}: ${err?.message}`,
      );
    }
  }
}
