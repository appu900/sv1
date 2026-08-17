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
  UseGuards,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Request } from 'express';
import { GetUser } from '../../../common/decorators/Get.user.decorator';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard';
import { PerksService } from '../perks.service';
import { PerksBillingService } from './perks-billing.service';
import { PerksBillingError, PerksStripeClient } from './perks-stripe.client';

@Controller('perks/billing')
export class PerksBillingController {
  private readonly logger = new Logger(PerksBillingController.name);

  constructor(
    private readonly billing: PerksBillingService,
    private readonly stripe: PerksStripeClient,
    private readonly perksService: PerksService,
    private readonly config: ConfigService,
  ) {}

  private success<T>(data: T) {
    return { success: true, data };
  }

  @Post('checkout')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  async createCheckout(@GetUser() user: { userId: string }) {
    return this.success(await this.billing.startCheckout(user.userId));
  }

  @Post('portal')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  async openPortal(@GetUser() user: { userId: string }) {
    const returnUrl = this.config.get<string>(
      'PERKS_BILLING_PORTAL_RETURN_URL',
      'https://admin.saveful.app/perks/success',
    );
    return this.success(await this.billing.openPortal(user.userId, returnUrl));
  }

  /**
   * Unauthenticated by design — Stripe authenticates itself with a signature
   * over the raw body. `main.ts` mounts a raw body parser for this exact path;
   * without it the global JSON parser consumes the body and every signature
   * check fails.
   */
  @Post('webhook')
  @HttpCode(HttpStatus.OK)
  async handleWebhook(
    @Req() request: Request,
    @Headers('stripe-signature') signature: string,
    @Body() body: unknown,
  ) {
    if (!signature) {
      throw new BadRequestException('Missing Stripe signature');
    }

    const payload = Buffer.isBuffer(body)
      ? body
      : ((request as unknown as { rawBody?: Buffer }).rawBody ?? null);
    if (!payload) {
      this.logger.error(
        'Stripe webhook received a parsed body — the raw body parser is not mounted',
      );
      throw new BadRequestException('Webhook payload was not readable');
    }

    const event = this.stripe.constructWebhookEvent(payload, signature);

    try {
      const outcome = await this.billing.applyWebhookEvent(event);

      // Payment succeeded, so register with WeMAD now — the member should come
      // back to a usable membership rather than have to tap Join again.
      if (outcome.activatedUserId) {
        await this.perksService.completeRegistrationAfterPayment(
          outcome.activatedUserId,
        );
      }
    } catch (error) {
      if (error instanceof PerksBillingError) throw error;
      // Never fail the webhook for downstream problems: Stripe would retry a
      // payment that already succeeded. The membership records the failure and
      // the app retries registration on its next call.
      this.logger.error(
        `Perks webhook ${event.id} (${event.type}) failed after the payment: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }

    return { received: true };
  }
}
