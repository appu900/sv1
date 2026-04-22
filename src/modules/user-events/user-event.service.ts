import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import {
  UserEvent,
  UserEventDocument,
  UserEventType,
} from '../../database/schemas/user-event.schema';

@Injectable()
export class UserEventService {
  private readonly logger = new Logger(UserEventService.name);

  constructor(
    @InjectModel(UserEvent.name)
    private readonly userEventModel: Model<UserEventDocument>,
  ) {}

  /**
   * Record a first-time user event. Subsequent calls for the same
   * (userId, eventType) are silently ignored.
   *
   * @returns true if this was the first occurrence (newly inserted),
   *          false if the event already existed.
   */
  async recordFirst(
    userId: string | Types.ObjectId,
    eventType: UserEventType,
    metadata: Record<string, any> = {},
  ): Promise<boolean> {
    if (!userId) return false;
    let uid: Types.ObjectId;
    try {
      uid =
        typeof userId === 'string'
          ? new Types.ObjectId(userId)
          : userId;
    } catch {
      return false;
    }

    try {
      const res = await this.userEventModel.updateOne(
        { userId: uid, eventType },
        {
          $setOnInsert: {
            userId: uid,
            eventType,
            metadata,
            createdAt: new Date(),
          },
        },
        { upsert: true },
      );

      // `upsertedCount` is 1 on the first insert; 0 on subsequent calls.
      return (res as any).upsertedCount === 1;
    } catch (error) {
      // E11000 can occur under a race; treat as "already recorded".
      if ((error as any)?.code === 11000) return false;
      this.logger.error(
        `recordFirst failed (${eventType}, user=${String(userId)}): ${
          (error as Error).message
        }`,
      );
      return false;
    }
  }

  async getEventsForUser(userId: string): Promise<UserEventDocument[]> {
    if (!Types.ObjectId.isValid(userId)) return [];
    return this.userEventModel
      .find({ userId: new Types.ObjectId(userId) })
      .sort({ createdAt: 1 })
      .lean<UserEventDocument[]>()
      .exec();
  }

  async funnelCounts(): Promise<Record<UserEventType, number>> {
    const agg = await this.userEventModel.aggregate<{
      _id: UserEventType;
      count: number;
    }>([{ $group: { _id: '$eventType', count: { $sum: 1 } } }]);

    const out = {} as Record<UserEventType, number>;
    for (const t of Object.values(UserEventType)) out[t] = 0;
    for (const row of agg) out[row._id] = row.count;
    return out;
  }
}
