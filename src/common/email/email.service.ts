import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';
import {
  otpTemplate,
  welcomeTemplate,
  passwordResetTemplate,
  accountDeletionTemplate,
} from './email-templates';

@Injectable()
export class EmailService implements OnModuleInit {
  private readonly logger = new Logger(EmailService.name);
  private readonly transporter: nodemailer.Transporter;
  private readonly fromEmail: string;
  private readonly replyTo: string;

  private static readonly MAX_RETRIES = 3;
  private static readonly BASE_DELAY_MS = 2_000;

  constructor(private readonly configService: ConfigService) {
    this.fromEmail =
      this.configService.get<string>('FROM_EMAIL') ??
      '"Saveful" <saveful@jogaadindia.com>';

    this.replyTo =
      this.configService.get<string>('REPLY_TO') ??
      '"Saveful" <saveful@jogaadindia.com>';

    this.transporter = nodemailer.createTransport({
      pool: true,
      maxConnections: 5,
      maxMessages: 100,
      host: this.configService.get<string>('SMTP_HOST'),
      port: this.configService.get<number>('SMTP_PORT') ?? 587,
      secure: false, 
      requireTLS: true,
      auth: {
        user: this.configService.get<string>('SMTP_USER'),
        pass: this.configService.get<string>('SMTP_PASS'),
      },
    });
  }

  async onModuleInit() {
    try {
      await this.transporter.verify();
      this.logger.log('SMTP server is ready to send emails');
    } catch (error) {
      this.logger.error('SMTP verification failed', error);
    }
  }


  async sendOTPEmail(
    email: string,
    otpCode: string,
    expiryMinutes: number = 10,
  ): Promise<void> {
    const html = otpTemplate(otpCode, expiryMinutes);
    await this.sendWithRetry(email, 'Your Saveful Verification Code', html);
    this.logger.log(`OTP email sent to ${email}`);
  }

  async sendWelcomeEmail(email: string, userName: string): Promise<void> {
    const html = welcomeTemplate(userName);
    await this.sendWithRetry(email, 'Welcome to Saveful', html);
    this.logger.log(`Welcome email sent to ${email}`);
  }

  async sendPasswordResetOTPEmail(
    email: string,
    otpCode: string,
    expiryMinutes: number = 15,
  ): Promise<void> {
    const html = passwordResetTemplate(otpCode, expiryMinutes);
    await this.sendWithRetry(email, 'Reset your Saveful password', html);
    this.logger.log(`Password reset email sent to ${email}`);
  }

  async sendAccountDeletionEmail(
    email: string,
    userName: string,
  ): Promise<void> {
    const html = accountDeletionTemplate(userName);
    await this.sendWithRetry(
      email,
      'Your Saveful account has been deleted',
      html,
    );
    this.logger.log(`Account deletion email sent to ${email}`);
  }

  private async sendWithRetry(
    to: string,
    subject: string,
    html: string,
  ): Promise<void> {
    let lastError: Error | undefined;

    for (
      let attempt = 1;
      attempt <= EmailService.MAX_RETRIES;
      attempt++
    ) {
      try {
        const info = await this.transporter.sendMail({
          from: this.fromEmail,
          replyTo: this.replyTo,
          to,
          subject,
          html,
        });
        this.logger.debug(`Message ID: ${info.messageId}`);
        return;
      } catch (error: any) {
        lastError = error;
        this.logger.warn(
          `Send attempt ${attempt}/${EmailService.MAX_RETRIES} failed for ${to}: ${error.message}`,
        );
        if (attempt < EmailService.MAX_RETRIES) {
          const delay =
            EmailService.BASE_DELAY_MS * Math.pow(2, attempt - 1);
          await new Promise((r) => setTimeout(r, delay));
        }
      }
    }

    this.logger.error(
      `All ${EmailService.MAX_RETRIES} attempts exhausted for ${to}`,
      lastError?.stack,
    );
    throw lastError;
  }
}
