import { Logger } from 'winston';
import { RedisService } from './redis.service';
import { Controller, Get, Inject, Injectable, Post } from '@nestjs/common';
import { WINSTON_MODULE_PROVIDER } from 'nest-winston';

@Controller('cache')
export class RedisController {

  constructor(private readonly redisService: RedisService,
  @Inject(WINSTON_MODULE_PROVIDER) private readonly logger:Logger


  ) {}
  @Get('health')
  async cacheHealth() {
    return this.redisService.isHealthy();
  }

  @Get('version')
  async getVersion(){
    const key = "Ingredients:all"
    const res = this.redisService.getVersion(key);
    this.logger.info(`version for ${key} is`,res)
    return res;
  }
}
