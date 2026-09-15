import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { BullModule } from '@nestjs/bullmq';
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
import { NotificationProducer } from './notification.producer';
import { NotificationWorker } from './notification.worker';
import { FirebaseGateway } from './firebase.gateway';
import { ExpoGateway } from './expo.gateway';
import { NotificationMaintenanceService } from './notification.maintenance';
import { NOTIFICATION_QUEUE_NAME } from './constants';

@Module({
  imports: [
    ScheduleModule.forRoot(),
    BullModule.registerQueue({
      name: NOTIFICATION_QUEUE_NAME,
    }),
    MongooseModule.forFeature([
      { name: DeviceToken.name, schema: DeviceTokenSchema },
      { name: Notification.name, schema: NotificationSchema },
    ]),
    RedisModule,
  ],
  controllers: [NotificationController],
  providers: [
    NotificationService,
    NotificationProducer,
    NotificationWorker,   
    FirebaseGateway,
    ExpoGateway,
    NotificationMaintenanceService,
  ],
  exports: [NotificationService],
})
export class NotificationModule {}