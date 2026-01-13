import { Global, Module } from '@nestjs/common';
import { RedisService } from './redis.service';
import { RedisController } from './redis.controller';

@Global()
@Module({
  providers: [RedisService],
  controllers:[RedisController],
  exports: [RedisService],
})
export class RedisModule {}
