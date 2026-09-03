import { Logger } from 'winston';
import { RedisService } from './redis.service';
import { Controller, Delete, Get, Inject, Injectable, Post, Query } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiOkResponse } from '@nestjs/swagger';
import { WINSTON_MODULE_PROVIDER } from 'nest-winston';

@ApiTags('Cache')
@Controller('cache')
export class RedisController {

  constructor(private readonly redisService: RedisService,
  @Inject(WINSTON_MODULE_PROVIDER) private readonly logger:Logger


  ) {}
  @Get('health')
  @ApiOperation({
    summary: 'Redis health check',
    description:
      'Public. Pings Redis via RedisService.isHealthy(). Returns a boolean: true when the cache is reachable. Used by ops/monitoring, not by the mobile app.',
  })
  @ApiOkResponse({ description: '`true` if Redis is healthy, otherwise `false`.' })
  async cacheHealth() {
    return this.redisService.isHealthy();
  }

  @Get('version')
  @ApiOperation({
    summary: 'Ingredients cache version',
    description:
      'Public. Returns the numeric cache version for the `Ingredients:all` key. Clients or ops can compare this to detect a stale ingredients list without fetching the full payload.',
  })
  @ApiOkResponse({ description: 'Integer version for the Ingredients:all cache key.' })
  async getVersion(){
    const key = "Ingredients:all"
    const res = this.redisService.getVersion(key);
    this.logger.info(`version for ${key} is`,res)
    return res;
  }

  @Delete('flush-ingredients')
  @ApiOperation({
    summary: 'Flush ingredient caches',
    description:
      'Public. Deletes versioned `Ingredients:all*` keys, country-filtered `Ingredients:all:country:*` keys, and the `Ingrediants:Category:all` category cache. Returns `{ message }` on success. Intended for ops after ingredient data changes.',
  })
  @ApiOkResponse({
    description: '`{ message: "Ingredient caches flushed successfully" }`.',
  })
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
