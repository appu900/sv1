import { Injectable, OnModuleDestroy } from '@nestjs/common';
import Redis from 'ioredis';

@Injectable()
export class RedisService implements OnModuleDestroy {
  private readonly client: Redis;
  private readonly JOIN_CODE_SET_KEY = 'community:join_codes';

  constructor() {
    this.client = new Redis(process.env.REDIS_URL || 'redis://localhost:6379', {
      maxRetriesPerRequest: 5,
      enableReadyCheck: true,
    });

    this.client.on('connect', () => console.log('Redis connected'));

    this.client.on('error', (err) => console.error('Redis error:', err));
  }

  async isHealthy(): Promise<boolean> {
    try {
      await this.client.ping();
      return true;
    } catch {
      return false;
    }
  }

  async isJoinCodeUsed(code: string): Promise<boolean> {
    return (await this.client.sismember(this.JOIN_CODE_SET_KEY, code)) === 1;
  }


   async resetJoinCodes(): Promise<void> {
    await this.client.del(this.JOIN_CODE_SET_KEY);
  }


  async releaseJoinCode(code: string): Promise<void> {
    await this.client.srem(this.JOIN_CODE_SET_KEY, code);
  }

  async addJoinCodes(codes: string[]): Promise<void> {
    if (!codes.length) return;
    await this.client.sadd(this.JOIN_CODE_SET_KEY, ...codes);
  }

  async set(key: string, value: any, ttlSeconds: number) {
    await this.client.set(key, JSON.stringify(value), 'EX', ttlSeconds);
  }

  async get(key: string) {
    const value = await this.client.get(key);
    return value ? JSON.parse(value) : null;
  }

  async del(key: string) {
    await this.client.del(key);
  }

  async setSession(sessionId: string, userId: string, ttlSeconds: number) {
    await this.client.set(
      `auth:session:${sessionId}`,
      userId,
      'EX',
      ttlSeconds,
    );
  }

  async getSession(sessionId: string) {
    return this.client.get(`auth:session:${sessionId}`);
  }

  async deleteSession(sessionId: string) {
    return this.client.del(`auth:session:${sessionId}`);
  }

  async onModuleDestroy() {
    await this.client.quit();
  }
}
