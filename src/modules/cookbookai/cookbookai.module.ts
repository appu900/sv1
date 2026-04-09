import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { BullModule } from '@nestjs/bullmq';
import { CookbookaiController } from './cookbookai.controller';
import { CookbookaiService } from './cookbookai.service';
import { CookbookaiProducer } from './cookbookai.producer';
import { CookbookaiWorker } from './cookbookai.worker';
import { userRecipe, UserRecipeSchema } from 'src/database/schemas/user.schema';
import { User, UserSchema } from 'src/database/schemas/user.auth.schema';
import { RedisModule } from 'src/redis/redis.module';
import { NotificationModule } from '../notification/notification.module';
import { COOKBOOKAI_QUEUE_NAME } from './cookbookai.constants';

@Module({
  imports: [
    BullModule.registerQueue({
      name: COOKBOOKAI_QUEUE_NAME,
    }),
    MongooseModule.forFeature([
      { name: userRecipe.name, schema: UserRecipeSchema },
      { name: User.name, schema: UserSchema },
    ]),
    RedisModule,
    NotificationModule,
  ],
  controllers: [CookbookaiController],
  providers: [CookbookaiService, CookbookaiProducer, CookbookaiWorker],
})
export class CookbookaiModule {}
