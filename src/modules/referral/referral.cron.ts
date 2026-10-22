import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { randomUUID } from 'crypto';
import { RedisService } from '../../redis/redis.service';
import { ReferralLedgerService } from './referral-ledger.service';

@Injectable()
export class ReferralCronService {
  private readonly logger = new Logger(ReferralCronService.name);

  constructor(
    private readonly redisService: RedisService,
    private readonly ledgerService: ReferralLedgerService,
  ) {}

  // @Cron fires on every instance; the Redis lock keeps one runner.
  private async withLock(key: string, ttlSeconds: number, fn: () => Promise<void>) {
    const token = randomUUID();
    const lockKey = `lock:referral-cron:${key}`;
    const acquired = await this.redisService.setIfAbsent(lockKey, token, ttlSeconds);
    if (!acquired) {
      this.logger.debug(`Skipping ${key} — lock held`);
      return;
    }
    try {
      await fn();
    } finally {
      await this.redisService.releaseLock(lockKey, token);
    }
  }

  /** Re-applies RevenueCat events whose ledger step failed inside the webhook. */
  @Cron('*/10 * * * *')
  async retryUnprocessedEvents() {
    await this.withLock('retry-events', 300, async () => {
      try {
        const processed = await this.ledgerService.processPending();
        if (processed > 0) this.logger.log(`Retried ${processed} RevenueCat event(s) for referrals`);
      } catch (error: any) {
        this.logger.error(`Referral event retry failed: ${error.message}`);
      }
    });
  }
}
