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
import {
  ApiTags,
  ApiOperation,
  ApiHeader,
  ApiOkResponse,
  ApiBody,
} from '@nestjs/swagger';
import { ConfigService } from '@nestjs/config';
import { SubscriptionService } from './subscription.service';

@ApiTags('Webhooks')
@Controller('webhook/revenuecat')
export class RevenueCatWebhookController {
  private readonly logger = new Logger(RevenueCatWebhookController.name);

  constructor(
    private readonly subscriptionService: SubscriptionService,
    private readonly configService: ConfigService,
  ) {}

  @Post()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'RevenueCat subscription webhook',
    description:
      'Called by RevenueCat (not the mobile app). Authenticate with `Authorization: Bearer <REVENUECAT_WEBHOOK_SECRET>` — this is the webhook secret, not a user JWT. Body is the RevenueCat event payload (`event` or a root event). Syncs subscription state and returns `{ received: true }`.',
  })
  @ApiHeader({
    name: 'authorization',
    required: true,
    description:
      'Bearer <REVENUECAT_WEBHOOK_SECRET>. Compared with timing-safe equality against the configured secret. Not an app JWT.',
  })
  @ApiBody({
    description: 'RevenueCat webhook JSON. Typically `{ event: { type, app_user_id, product_id, ... } }`.',
    schema: { type: 'object', additionalProperties: true },
  })
  @ApiOkResponse({ description: '`{ received: true }` after the event is processed.' })
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
