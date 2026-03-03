import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { EmailService } from './email.service';
import {
  EMAIL_QUEUE_NAME,
  EmailJobType,
  EmailJobData,
} from './email.constants';


@Processor(EMAIL_QUEUE_NAME)
export class EmailProcessor extends WorkerHost {
  private readonly logger = new Logger(EmailProcessor.name);

  constructor(private readonly emailService: EmailService) {
    super();
  }

  async process(job: Job<EmailJobData>): Promise<void> {
    const { data } = job;
    this.logger.log(
      `Processing ${data.type} email for ${data.email} (attempt ${job.attemptsMade + 1})`,
    );

    switch (data.type) {
      case EmailJobType.OTP:
        await this.emailService.sendOTPEmail(
          data.email,
          data.otpCode,
          data.expiryMinutes,
        );
        break;

      case EmailJobType.WELCOME:
        await this.emailService.sendWelcomeEmail(
          data.email,
          data.userName,
        );
        break;

      case EmailJobType.PASSWORD_RESET:
        await this.emailService.sendPasswordResetOTPEmail(
          data.email,
          data.otpCode,
          data.expiryMinutes,
        );
        break;

      case EmailJobType.ACCOUNT_DELETION:
        await this.emailService.sendAccountDeletionEmail(
          data.email,
          data.userName,
        );
        break;

      default:
        this.logger.error(`Unknown email job type: ${(data as any).type}`);
    }
  }
}
