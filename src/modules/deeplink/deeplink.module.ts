import { Module } from '@nestjs/common';
import { DeeplinkController } from './deeplink.controller';

@Module({
  controllers: [DeeplinkController],
})
export class DeeplinkModule {}
