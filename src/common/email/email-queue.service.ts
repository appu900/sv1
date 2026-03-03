import { Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { RedisService } from 'src/redis/redis.service';
import {
  EMAIL_QUEUE_NAME,
  EmailJobType,
  EmailJobData,
} from './email.constants';


@Injectable()
export class EmailQueueService {
  private readonly logger = new Logger(EmailQueueService.name);

  private static readonly OTP_COOLDOWN_SECONDS = 60;

  constructor(
    @InjectQueue(EMAIL_QUEUE_NAME) private readonly emailQueue: Queue,
    private readonly redis: RedisService,
  ) {}

  private static readonly DEFAULT_JOB_OPTS = {
    attempts: 3,
    backoff: { type: 'exponential' as const, delay: 3_000 },
    removeOnComplete: { count: 1_000 },
    removeOnFail: { count: 5_000 },
  };

  private async enqueue(data: EmailJobData): Promise<void> {
    await this.emailQueue.add(data.type, data, {
      ...EmailQueueService.DEFAULT_JOB_OPTS,
    });
    this.logger.debug(
      `Enqueued ${data.type} email for ${data.email}`,
    );
  }


  private async acquireCooldown(
    type: string,
    email: string,
  ): Promise<boolean> {
    const key = `email:cooldown:${type}:${email}`;
    return this.redis.setNX(
      key,
      '1',
      EmailQueueService.OTP_COOLDOWN_SECONDS,
    );
  }

  async queueOTPEmail(
    email: string,
    otpCode: string,
    expiryMinutes: number = 10,
  ): Promise<boolean> {
    if (!(await this.acquireCooldown('otp', email))) {
      this.logger.warn(`OTP email cooldown active for ${email} — skipped`);
      return false;
    }
    await this.enqueue({
      type: EmailJobType.OTP,
      email,
      otpCode,
      expiryMinutes,
    });
    return true;
  }

  async queueWelcomeEmail(
    email: string,
    userName: string,
  ): Promise<void> {
    await this.enqueue({
      type: EmailJobType.WELCOME,
      email,
      userName,
    });
  }

  async queuePasswordResetEmail(
    email: string,
    otpCode: string,
    expiryMinutes: number = 15,
  ): Promise<boolean> {
    if (!(await this.acquireCooldown('password-reset', email))) {
      this.logger.warn(
        `Password-reset email cooldown active for ${email} — skipped`,
      );
      return false;
    }
    await this.enqueue({
      type: EmailJobType.PASSWORD_RESET,
      email,
      otpCode,
      expiryMinutes,
    });
    return true;
  }

  async queueAccountDeletionEmail(
    email: string,
    userName: string,
  ): Promise<void> {
    await this.enqueue({
      type: EmailJobType.ACCOUNT_DELETION,
      email,
      userName,
    });
  }
}
