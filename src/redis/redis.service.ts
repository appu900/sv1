import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Redis } from 'ioredis';

@Injectable()
export class RedisService implements OnModuleDestroy {
  private readonly client: Redis;
  constructor() {
    this.client = new Redis({
      host: process.env.REDIS_HOST,
      port: Number(process.env.REDIS_PORT),
    });
  }

  async setSession(sessionId: string, userId: string, ttlSeconds: number) {
    const key = `auth:session:${sessionId}`;
    await this.client.set(key, userId, 'EX', ttlSeconds);
  }

  async getSession(sessionId: string) {
    const key = `auth:session:${sessionId}`;
    return this.client.get(key);
  }

  async deleteSession(sessionId: string) {
    const key = `auth:session:${sessionId}`;
    return this.client.del(key);
  }

  async onModuleDestroy() {
    await this.client.quit();
  }
}
