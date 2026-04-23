import {
  ForbiddenException,
  Injectable,
  Logger,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import {
  KitchenScanUsage,
  KitchenScanUsageDocument,
} from '../../database/schemas/kitchen-scan-usage.schema';

export const KITCHEN_SCAN_LIFETIME_LIMIT = 5;

@Injectable()
export class KitchenScanUsageService {
  private readonly logger = new Logger(KitchenScanUsageService.name);

  constructor(
    @InjectModel(KitchenScanUsage.name)
    private readonly model: Model<KitchenScanUsageDocument>,
  ) {}

  async getUsage(
    userId: string,
  ): Promise<{ count: number; remaining: number; limit: number; lastUsedAt?: Date }> {
    const doc = await this.model
      .findOne({ userId: new Types.ObjectId(userId) })
      .lean()
      .exec();
    const count = doc?.count ?? 0;
    return {
      count,
      remaining: Math.max(0, KITCHEN_SCAN_LIFETIME_LIMIT - count),
      limit: KITCHEN_SCAN_LIFETIME_LIMIT,
      lastUsedAt: doc?.lastUsedAt,
    };
  }

 
  async reserve(userId: string): Promise<{ count: number; remaining: number; limit: number }> {
    const uid = new Types.ObjectId(userId);
    const updated = await this.model
      .findOneAndUpdate(
        { userId: uid, count: { $lt: KITCHEN_SCAN_LIFETIME_LIMIT } },
        { $inc: { count: 1 }, $set: { lastUsedAt: new Date() }, $setOnInsert: { userId: uid } },
        { upsert: true, new: true },
      )
      .exec()
      .catch((err: any) => {
        if (err?.code === 11000) return null;
        throw err;
      });

    if (updated && updated.count <= KITCHEN_SCAN_LIFETIME_LIMIT) {
      return {
        count: updated.count,
        remaining: Math.max(0, KITCHEN_SCAN_LIFETIME_LIMIT - updated.count),
        limit: KITCHEN_SCAN_LIFETIME_LIMIT,
      };
    }

    // Retry path after duplicate-key race
    const retry = await this.model
      .findOneAndUpdate(
        { userId: uid, count: { $lt: KITCHEN_SCAN_LIFETIME_LIMIT } },
        { $inc: { count: 1 }, $set: { lastUsedAt: new Date() } },
        { new: true },
      )
      .exec();

    if (!retry) {
      throw new ForbiddenException(
        `You have reached the limit of ${KITCHEN_SCAN_LIFETIME_LIMIT} shopping-list photo scans.`,
      );
    }
    return {
      count: retry.count,
      remaining: Math.max(0, KITCHEN_SCAN_LIFETIME_LIMIT - retry.count),
      limit: KITCHEN_SCAN_LIFETIME_LIMIT,
    };
  }

  async rollback(userId: string): Promise<void> {
    try {
      await this.model
        .updateOne(
          { userId: new Types.ObjectId(userId), count: { $gt: 0 } },
          { $inc: { count: -1 } },
        )
        .exec();
    } catch (err: any) {
      this.logger.warn(
        `Failed to rollback kitchen-scan usage for user ${userId}: ${err?.message}`,
      );
    }
  }
}
