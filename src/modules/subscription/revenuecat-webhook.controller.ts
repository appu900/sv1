import * as crypto from 'crypto';
import {
  BadRequestException,
  Body,
  Controller,
  Headers,
  HttpCode,
  HttpStatus,
  Logger,
  Post,
  Req,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SubscriptionService } from './subscription.service';

@Controller('webhook/revenuecat')
export class RevenueCatWebhookController {
  private readonly logger = new Logger(RevenueCatWebhookController.name);

  constructor(
    private readonly subscriptionService: SubscriptionService,
    private readonly configService: ConfigService,
  ) {}

  @Post()
  @HttpCode(HttpStatus.OK)
  async handle(
    @Headers('authorization') authHeader: string | undefined,
    @Body() payload: any,
  ) {
    const secret = this.configService.get<string>('REVENUECAT_WEBHOOK_SECRET');
    if (!secret) {
      this.logger.error('REVENUECAT_WEBHOOK_SECRET not configured');
      throw new BadRequestException('Webhook not configured');
    }

    const provided = (authHeader || '').replace(/^Bearer\s+/i, '').trim();
    const providedBuf = Buffer.from(provided, 'utf8');
    const secretBuf = Buffer.from(secret, 'utf8');
    if (
      providedBuf.length === 0 ||
      providedBuf.length !== secretBuf.length ||
      !crypto.timingSafeEqual(providedBuf, secretBuf)
    ) {
      throw new UnauthorizedException('Invalid webhook signature');
    }

    const event = payload?.event ?? payload;
    this.logger.log(
      `RC webhook type=${event?.type} app_user_id=${event?.app_user_id} product=${event?.product_id} entitlement_ids=${JSON.stringify(event?.entitlement_ids ?? [])}`,
    );

    await this.subscriptionService.syncFromWebhook(payload);
    return { received: true };
  }
}
