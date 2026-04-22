import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import {
  FeatureKey,
  FeatureUsageEvent,
  FeatureUsageEventDocument,
} from '../../database/schemas/feature-usage-event.schema';

export interface FeatureUsageSummaryRow {
  feature: FeatureKey;
  action: string;
  count: number;
  uniqueUsers: number;
}

@Injectable()
export class FeatureUsageService {
  private readonly logger = new Logger(FeatureUsageService.name);

  constructor(
    @InjectModel(FeatureUsageEvent.name)
    private readonly model: Model<FeatureUsageEventDocument>,
  ) {}

  async log(
    userId: string | Types.ObjectId,
    feature: FeatureKey,
    action: string,
    metadata: Record<string, any> = {},
  ): Promise<boolean> {
    if (!userId || !action) return false;
    let uid: Types.ObjectId;
    try {
      uid =
        typeof userId === 'string' ? new Types.ObjectId(userId) : userId;
    } catch {
      return false;
    }

    try {
      await this.model.create({
        userId: uid,
        feature,
        action: String(action).trim().slice(0, 64),
        metadata,
        createdAt: new Date(),
      });
      return true;
    } catch (error) {
      this.logger.warn(
        `FeatureUsage log failed (user=${String(userId)}, ${feature}:${action}): ${
          (error as Error).message
        }`,
      );
      return false;
    }
  }

  async summary(
    from?: Date,
    to?: Date,
  ): Promise<FeatureUsageSummaryRow[]> {
    const match: Record<string, any> = {};
    if (from || to) {
      match.createdAt = {};
      if (from) match.createdAt.$gte = from;
      if (to) match.createdAt.$lte = to;
    }

    const pipeline: any[] = [];
    if (Object.keys(match).length) pipeline.push({ $match: match });
    pipeline.push(
      {
        $group: {
          _id: { feature: '$feature', action: '$action' },
          count: { $sum: 1 },
          users: { $addToSet: '$userId' },
        },
      },
      {
        $project: {
          _id: 0,
          feature: '$_id.feature',
          action: '$_id.action',
          count: 1,
          uniqueUsers: { $size: '$users' },
        },
      },
      { $sort: { count: -1 } },
    );

    return this.model.aggregate<FeatureUsageSummaryRow>(pipeline).exec();
  }
}
