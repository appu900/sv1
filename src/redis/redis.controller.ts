import { Logger } from 'winston';
import { RedisService } from './redis.service';
import { Controller, Delete, Get, Inject, Injectable, Post, Query } from '@nestjs/common';
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

  @Delete('flush-ingredients')
  async flushIngredientCache() {
    // Delete versioned keys
    await this.redisService.delByPattern('Ingredients:all*');
    // Delete country-filtered keys
    await this.redisService.delByPattern('Ingredients:all:country:*');
    // Delete category cache
    await this.redisService.del('Ingrediants:Category:all');
    this.logger.info('Flushed all ingredient caches manually');
    return { message: 'Ingredient caches flushed successfully' };
  }
}
