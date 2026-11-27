import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import {
  PerksOrderSnapshot,
  PerksOrderSnapshotDocument,
} from '../../database/schemas/perks-order-snapshot.schema';
import type { OrderSnapshot } from './corp/perks-order-snapshot.mapper';

/** Persists members' WeMAD orders for the admin reporting dashboard. */
@Injectable()
export class PerksOrderSnapshotService {
  private readonly logger = new Logger(PerksOrderSnapshotService.name);

  constructor(
    @InjectModel(PerksOrderSnapshot.name)
    private readonly snapshotModel: Model<PerksOrderSnapshotDocument>,
  ) {}

  /** Upserts each order by (userId, orderKey). Returns how many were written. */
  async upsert(userId: string, snapshots: OrderSnapshot[]): Promise<number> {
    if (!snapshots.length || !Types.ObjectId.isValid(userId)) return 0;
    const objectId = new Types.ObjectId(userId);
    const now = new Date();
    const result = await this.snapshotModel.bulkWrite(
      snapshots.map((snapshot) => ({
        updateOne: {
          filter: { userId: objectId, orderKey: snapshot.orderKey },
          update: {
            $set: { ...snapshot, userId: objectId, lastSyncedAt: now },
          },
          upsert: true,
        },
      })),
      { ordered: false },
    );
    const written = (result.upsertedCount ?? 0) + (result.modifiedCount ?? 0);
    this.logger.debug(
      `Perks order snapshots for ${userId}: ${snapshots.length} read, ${written} written`,
    );
    return snapshots.length;
  }
}
