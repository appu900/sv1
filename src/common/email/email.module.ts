import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { EMAIL_QUEUE_NAME } from './email.constants';
import { EmailService } from './email.service';
import { EmailQueueService } from './email-queue.service';
import { EmailProcessor } from './email.processor';

@Module({
  imports: [
    BullModule.registerQueue({ name: EMAIL_QUEUE_NAME }),
  ],
  providers: [EmailService, EmailQueueService, EmailProcessor],
  exports: [EmailQueueService],
})
export class EmailModule {}
