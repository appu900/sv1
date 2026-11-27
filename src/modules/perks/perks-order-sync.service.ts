import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron } from '@nestjs/schedule';
import { randomUUID } from 'crypto';
import { RedisService } from '../../redis/redis.service';
import { PerksService } from './perks.service';

export interface PerksOrderSyncSummary {
  runId: string;
  trigger: 'cron' | 'admin';
  status: 'running' | 'success' | 'failed';
  startedAt: string;
  finishedAt: string | null;
  members: number;
  synced: number;
  skipped: number;
  failed: number;
  orders: number;
  error: string | null;
}

const LOCK_KEY = 'lock:perks:orders-sync';
const LAST_KEY = 'perks:orders-sync:last';
const LOCK_TTL_SECONDS = 30 * 60;

/**
 * Copies every active member's WeMAD orders into `perksordersnapshots` so the
 * admin My Perks dashboard can report spend. Members' own visits already keep
 * their orders fresh; this catches the members who have not opened the app.
 *
 * One member at a time, so WeMAD never sees a burst of logins from us.
 */
@Injectable()
export class PerksOrderSyncService {
  private readonly logger = new Logger(PerksOrderSyncService.name);

  constructor(
    private readonly perks: PerksService,
    private readonly redis: RedisService,
    private readonly config: ConfigService,
  ) {}

  private cronEnabled(): boolean {
    const raw = String(
      this.config.get('PERKS_ORDER_SYNC_CRON_ENABLED') ?? 'true',
    ).toLowerCase();
    return !['false', '0', 'no'].includes(raw);
  }

  @Cron('40 */6 * * *')
  async scheduledSync() {
    if (!this.cronEnabled()) return;
    await this.syncAll('cron');
  }

  async lastSummary(): Promise<PerksOrderSyncSummary | null> {
    try {
      return await this.redis.get<PerksOrderSyncSummary>(LAST_KEY);
    } catch {
      return null;
    }
  }

  /**
   * Starts a full sync unless one is already running. Returns null when another
   * run holds the lock.
   */
  async syncAll(trigger: 'cron' | 'admin'): Promise<PerksOrderSyncSummary | null> {
    const token = randomUUID();
    const acquired = await this.redis.setIfAbsent(LOCK_KEY, token, LOCK_TTL_SECONDS);
    if (!acquired) {
      this.logger.debug('Skipping Perks order sync — lock held');
      return null;
    }

    const summary: PerksOrderSyncSummary = {
      runId: token,
      trigger,
      status: 'running',
      startedAt: new Date().toISOString(),
      finishedAt: null,
      members: 0,
      synced: 0,
      skipped: 0,
      failed: 0,
      orders: 0,
      error: null,
    };
    const save = () =>
      this.redis.set(LAST_KEY, summary, 30 * 24 * 60 * 60).catch(() => undefined);

    try {
      await save();
      const memberIds = await this.perks.listSyncableMemberIds();
      summary.members = memberIds.length;
      for (const userId of memberIds) {
        try {
          const result = await this.perks.syncMemberOrders(userId);
          if (result.status === 'synced') {
            summary.synced += 1;
            summary.orders += result.orders;
          } else {
            summary.skipped += 1;
          }
        } catch (error) {
          summary.failed += 1;
          this.logger.warn(
            `Perks order sync failed for user ${userId}: ${(error as Error).message}`,
          );
        }
      }
      summary.status = 'success';
    } catch (error) {
      summary.status = 'failed';
      summary.error = (error as Error).message;
      this.logger.error(`Perks order sync failed: ${summary.error}`);
    } finally {
      summary.finishedAt = new Date().toISOString();
      await save();
      await this.redis.releaseLock(LOCK_KEY, token).catch(() => undefined);
    }

    this.logger.log(
      `Perks order sync (${trigger}): ${summary.synced}/${summary.members} members, ${summary.orders} orders, ${summary.skipped} skipped, ${summary.failed} failed`,
    );
    return summary;
  }
}
