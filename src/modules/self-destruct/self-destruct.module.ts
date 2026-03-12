import { Module } from '@nestjs/common';
import { SelfDestructController } from './self-destruct.controller';

@Module({
  controllers: [SelfDestructController],
})
export class SelfDestructModule {}
