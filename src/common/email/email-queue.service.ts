import { Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { RedisService } from 'src/redis/redis.service';
import { EmailService } from './email.service';
import {
  EMAIL_QUEUE_NAME,
  EmailJobType,
  EmailJobData,
} from './email.constants';


@Injectable()
export class EmailQueueService {
  private readonly logger = new Logger(EmailQueueService.name);

  private static readonly OTP_COOLDOWN_SECONDS = 60;

  private static readonly WORKER_PROBE_TTL_MS = 30_000;

  private workerProbedAt = 0;
  private workerAvailable = false;

  constructor(
    @InjectQueue(EMAIL_QUEUE_NAME) private readonly emailQueue: Queue,
    private readonly redis: RedisService,
    private readonly emailService: EmailService,
  ) {}

  private static readonly DEFAULT_JOB_OPTS = {
    attempts: 3,
    backoff: { type: 'exponential' as const, delay: 3_000 },
    removeOnComplete: { count: 1_000 },
    removeOnFail: { count: 5_000 },
  };

  private async hasActiveWorker(): Promise<boolean> {
    const now = Date.now();
    if (now - this.workerProbedAt < EmailQueueService.WORKER_PROBE_TTL_MS) {
      return this.workerAvailable;
    }

    try {
      const workers = await this.emailQueue.getWorkers();
      this.workerAvailable = workers.length > 0;
      if (!this.workerAvailable) {
        this.logger.error(
          'No BullMQ worker is attached to the email queue — falling back to ' +
            'inline delivery. Check that the deployed process runs EmailProcessor ' +
            'and points at the same Redis as the API.',
        );
      }
    } catch (error: any) {
      this.workerAvailable = false;
      this.logger.warn(
        `Could not probe email queue workers (${error.message}) — delivering inline`,
      );
    }

    this.workerProbedAt = now;
    return this.workerAvailable;
  }

  private async deliver(data: EmailJobData): Promise<void> {
    if (await this.hasActiveWorker()) {
      await this.emailQueue.add(data.type, data, {
        ...EmailQueueService.DEFAULT_JOB_OPTS,
      });
      this.logger.debug(`Enqueued ${data.type} email for ${data.email}`);
      return;
    }

    await this.emailService.send(data);
    this.logger.log(`Sent ${data.type} email inline for ${data.email}`);
  }


  private async acquireCooldown(
    type: string,
    email: string,
  ): Promise<boolean> {
    const key = `email:cooldown:${type}:${email}`;
    try {
      return await this.redis.setNX(
        key,
        '1',
        EmailQueueService.OTP_COOLDOWN_SECONDS,
      );
    } catch (error: any) {
      // Fail open. This gate only suppresses duplicate sends; letting a Redis
      // outage turn it into a hard failure would block password resets outright,
      // which is far worse than an occasional repeat email.
      this.logger.warn(
        `Cooldown check failed for ${type}/${email} (${error.message}) — allowing send`,
      );
      return true;
    }
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
    await this.deliver({
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
    await this.deliver({
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
    await this.deliver({
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
    await this.deliver({
      type: EmailJobType.ACCOUNT_DELETION,
      email,
      userName,
    });
  }
}
