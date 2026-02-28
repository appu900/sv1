import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { ScheduleModule } from '@nestjs/schedule';
import {
  DeviceToken,
  DeviceTokenSchema,
} from 'src/database/schemas/device-token.schema';
import {
  Notification,
  NotificationSchema,
} from 'src/database/schemas/notification.schema';
import { RedisModule } from 'src/redis/redis.module';
import { NotificationController } from './notification.controller';
import { NotificationService } from './notification.service';
import { NotificationProcessor } from './notification.processor';
import { FirebaseGateway } from './firebase.gateway';

@Module({
  imports: [
    ScheduleModule.forRoot(),
    MongooseModule.forFeature([
      { name: DeviceToken.name, schema: DeviceTokenSchema },
      { name: Notification.name, schema: NotificationSchema },
    ]),
    RedisModule,
  ],
  controllers: [NotificationController],
  providers: [NotificationService, NotificationProcessor, FirebaseGateway],
  exports: [NotificationService],
})
export class NotificationModule {}
