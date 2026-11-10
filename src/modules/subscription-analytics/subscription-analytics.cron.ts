import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron } from '@nestjs/schedule';
import { randomUUID } from 'crypto';
import { RedisService } from '../../redis/redis.service';
import { SubscriptionAnalyticsService } from './subscription-analytics.service';

@Injectable()
export class SubscriptionAnalyticsCron {
  private readonly logger = new Logger(SubscriptionAnalyticsCron.name);

  constructor(
    private readonly redisService: RedisService,
    private readonly analytics: SubscriptionAnalyticsService,
    private readonly configService: ConfigService,
  ) {}

  private enabled(): boolean {
    const raw = String(this.configService.get('SUBSCRIPTION_ANALYTICS_CRON_ENABLED') ?? 'true').toLowerCase();
    return !['false', '0', 'no'].includes(raw);
  }

  /** Rebuilds subscription history every 6 hours; the Redis lock keeps one runner. */
  @Cron('15 */6 * * *')
  async rebuild() {
    if (!this.enabled()) return;
    const token = randomUUID();
    const lockKey = 'lock:subscription-analytics:rebuild';
    const acquired = await this.redisService.setIfAbsent(lockKey, token, 30 * 60);
    if (!acquired) {
      this.logger.debug('Skipping subscription analytics rebuild — lock held');
      return;
    }
    try {
      await this.analytics.rebuild({ trigger: 'cron' });
    } catch (error: any) {
      this.logger.error(`Subscription analytics cron failed: ${error.message}`);
    } finally {
      await this.redisService.releaseLock(lockKey, token);
    }
  }
}
