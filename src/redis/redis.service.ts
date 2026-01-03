import { Injectable, OnModuleDestroy } from '@nestjs/common';
import Redis from 'ioredis';

@Injectable()
export class RedisService implements OnModuleDestroy {
  private readonly client: Redis;

  constructor() {
    this.client = new Redis(process.env.REDIS_URL || 'redis://localhost:6379', {
      maxRetriesPerRequest: 5,
      enableReadyCheck: true,
    });

    this.client.on('connect', () =>
      console.log('Redis connected'),
    );

    this.client.on('error', (err) =>
      console.error('Redis error:', err),
    );
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
