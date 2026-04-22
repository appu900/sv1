import { ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import {
  AIFeatureKey,
  AIInteractionEvent,
  AIInteractionEventDocument,
  AIResultType,
  AIUserAction,
} from '../../database/schemas/ai-interaction-event.schema';
import { computeCostUsd, resolvePricing, AggregatedCall, aggregateUsage } from './ai-pricing.util';

export interface LogAiInteractionInput {
  userId: string | Types.ObjectId | null | undefined;
  feature: AIFeatureKey;
  model?: string | null;
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
  resultType: AIResultType;
  latencyMs?: number;
  subjectId?: string | Types.ObjectId | null;
  metadata?: Record<string, any>;
}

function toObjectId(value: string | Types.ObjectId | null | undefined): Types.ObjectId | null {
  if (!value) return null;
  if (value instanceof Types.ObjectId) return value;
  try {
    return new Types.ObjectId(String(value));
  } catch {
    return null;
  }
}

@Injectable()
export class AIInteractionService {
  private readonly logger = new Logger(AIInteractionService.name);
  private readonly pricingWarned = new Set<string>();

  constructor(
    @InjectModel(AIInteractionEvent.name)
    private readonly model: Model<AIInteractionEventDocument>,
  ) {}


  async log(input: LogAiInteractionInput): Promise<string | null> {
    try {
      const userObjectId = toObjectId(input.userId);
      if (!userObjectId) {
        this.logger.warn(
          `Skipping AI interaction log — invalid userId for feature=${input.feature}`,
        );
        return null;
      }

      const promptTokens = Math.max(0, Math.floor(input.promptTokens ?? 0));
      const completionTokens = Math.max(0, Math.floor(input.completionTokens ?? 0));
      const totalTokens =
        input.totalTokens !== undefined
          ? Math.max(0, Math.floor(input.totalTokens))
          : promptTokens + completionTokens;

      const modelName = (input.model ?? 'unknown').toString();
      if (modelName !== 'unknown' && !resolvePricing(modelName) && !this.pricingWarned.has(modelName)) {
        this.pricingWarned.add(modelName);
        this.logger.warn(`No pricing entry for model "${modelName}" — costUsd will be 0`);
      }

      const costUsd = computeCostUsd(modelName, promptTokens, completionTokens);

      const doc = await this.model.create({
        userId: userObjectId,
        feature: input.feature,
        model: modelName,
        promptTokens,
        completionTokens,
        totalTokens,
        costUsd,
        resultType: input.resultType,
        latencyMs: Math.max(0, Math.floor(input.latencyMs ?? 0)),
        subjectId: toObjectId(input.subjectId),
        metadata: input.metadata ?? {},
      });

      return String(doc._id);
    } catch (err: any) {
      this.logger.error(
        `AI interaction log failed for feature=${input.feature}: ${err?.message}`,
      );
      return null;
    }
  }
  async logFromResponse(
    base: Omit<LogAiInteractionInput, 'promptTokens' | 'completionTokens' | 'totalTokens' | 'model'>,
    response: any,
    explicitModel?: string,
  ): Promise<string | null> {
    const usage = response?.usage ?? {};
    const promptTokens = Number(
      usage.prompt_tokens ?? usage.input_tokens ?? 0,
    ) || 0;
    const completionTokens = Number(
      usage.completion_tokens ?? usage.output_tokens ?? 0,
    ) || 0;
    const totalTokens = Number(usage.total_tokens ?? promptTokens + completionTokens) || 0;
    const model = explicitModel || response?.model || 'unknown';

    return this.log({
      ...base,
      model,
      promptTokens,
      completionTokens,
      totalTokens,
    });
  }

  /**
   * Log an aggregated pipeline that made multiple OpenAI calls across
   * possibly different models. Cost is computed accurately per-call using
   * each call's own pricing, then summed. The stored `model` is a comma
   * separated list of distinct models touched.
   */
  async logAggregated(
    base: Omit<LogAiInteractionInput, 'promptTokens' | 'completionTokens' | 'totalTokens' | 'model'>,
    calls: AggregatedCall[],
  ): Promise<string | null> {
    try {
      const userObjectId = toObjectId(base.userId);
      if (!userObjectId) {
        this.logger.warn(
          `Skipping aggregated AI log — invalid userId for feature=${base.feature}`,
        );
        return null;
      }
      const filtered = calls.filter((c) => c.model && (c.promptTokens > 0 || c.completionTokens > 0));
      const usage = aggregateUsage(filtered);
      const distinctModels = Array.from(new Set(filtered.map((c) => c.model)));
      for (const m of distinctModels) {
        if (!resolvePricing(m) && !this.pricingWarned.has(m)) {
          this.pricingWarned.add(m);
          this.logger.warn(`No pricing entry for model "${m}" — cost will be 0 for that call`);
        }
      }
      const doc = await this.model.create({
        userId: userObjectId,
        feature: base.feature,
        model: distinctModels.length > 0 ? distinctModels.join(',') : 'unknown',
        promptTokens: usage.promptTokens,
        completionTokens: usage.completionTokens,
        totalTokens: usage.totalTokens,
        costUsd: usage.costUsd,
        resultType: base.resultType,
        latencyMs: Math.max(0, Math.floor(base.latencyMs ?? 0)),
        subjectId: toObjectId(base.subjectId),
        metadata: {
          ...(base.metadata ?? {}),
          stages: filtered.map((c) => ({
            model: c.model,
            promptTokens: c.promptTokens,
            completionTokens: c.completionTokens,
          })),
        },
      });
      return String(doc._id);
    } catch (err: any) {
      this.logger.error(
        `Aggregated AI log failed for feature=${base.feature}: ${err?.message}`,
      );
      return null;
    }
  }

  async setUserAction(
    eventId: string,
    userId: string | Types.ObjectId,
    action: AIUserAction,
  ): Promise<AIInteractionEventDocument> {
    const oid = toObjectId(eventId);
    if (!oid) {
      throw new NotFoundException('AI interaction event not found');
    }
    const userOid = toObjectId(userId);
    if (!userOid) {
      throw new ForbiddenException('Not allowed');
    }

    const priority: Record<AIUserAction, number> = {
      [AIUserAction.IGNORED]: 0,
      [AIUserAction.VIEWED]: 1,
      [AIUserAction.SAVED]: 2,
      [AIUserAction.COOKED]: 3,
    };
    const incomingPriority = priority[action];
    // Only upgrade if the current stored action has strictly lower priority
    // (null counts as below IGNORED=0). Atomic: one query, safe under concurrency.
    const lowerActions = Object.entries(priority)
      .filter(([, p]) => p < incomingPriority)
      .map(([a]) => a);

    const updated = await this.model
      .findOneAndUpdate(
        {
          _id: oid,
          userId: userOid,
          $or: [
            { userAction: null },
            { userAction: { $exists: false } },
            ...(lowerActions.length > 0
              ? [{ userAction: { $in: lowerActions } }]
              : []),
          ],
        },
        { $set: { userAction: action } },
        { new: true },
      )
      .exec();

    if (updated) return updated;

    // Either the event doesn't exist / isn't owned by this user,
    // or the stored action is already at or above the incoming priority.
    const existing = await this.model.findById(oid).exec();
    if (!existing) {
      throw new NotFoundException('AI interaction event not found');
    }
    if (!existing.userId.equals(userOid)) {
      throw new ForbiddenException('Not allowed');
    }
    return existing;
  }

  async summary(params: { from?: Date; to?: Date; userId?: string }) {
    const match: Record<string, any> = {};
    if (params.from || params.to) {
      match.createdAt = {};
      if (params.from) match.createdAt.$gte = params.from;
      if (params.to) match.createdAt.$lte = params.to;
    }
    if (params.userId) {
      const oid = toObjectId(params.userId);
      if (oid) match.userId = oid;
    }

    const rows = await this.model.aggregate([
      { $match: match },
      {
        $group: {
          _id: { feature: '$feature', resultType: '$resultType' },
          count: { $sum: 1 },
          users: { $addToSet: '$userId' },
          promptTokens: { $sum: '$promptTokens' },
          completionTokens: { $sum: '$completionTokens' },
          totalTokens: { $sum: '$totalTokens' },
          costUsd: { $sum: '$costUsd' },
          viewed: {
            $sum: { $cond: [{ $eq: ['$userAction', 'viewed'] }, 1, 0] },
          },
          saved: {
            $sum: { $cond: [{ $eq: ['$userAction', 'saved'] }, 1, 0] },
          },
          cooked: {
            $sum: { $cond: [{ $eq: ['$userAction', 'cooked'] }, 1, 0] },
          },
          ignored: {
            $sum: { $cond: [{ $eq: ['$userAction', 'ignored'] }, 1, 0] },
          },
        },
      },
      {
        $project: {
          _id: 0,
          feature: '$_id.feature',
          resultType: '$_id.resultType',
          count: 1,
          uniqueUsers: { $size: '$users' },
          promptTokens: 1,
          completionTokens: 1,
          totalTokens: 1,
          costUsd: { $round: ['$costUsd', 6] },
          viewed: 1,
          saved: 1,
          cooked: 1,
          ignored: 1,
        },
      },
      { $sort: { feature: 1, resultType: 1 } },
    ]);

    return rows;
  }
}
