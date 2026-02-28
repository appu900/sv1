import { Module } from '@nestjs/common';
import { CookbookaiController } from './cookbookai.controller';
import { CookbookaiService } from './cookbookai.service';

@Module({
  controllers: [CookbookaiController],
  providers: [CookbookaiService]
})
export class CookbookaiModule {}
