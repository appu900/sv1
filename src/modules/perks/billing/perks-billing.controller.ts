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
import {
  ApiTags,
  ApiOperation,
  ApiHeader,
  ApiOkResponse,
} from '@nestjs/swagger';
import { ConfigService } from '@nestjs/config';
import { Request } from 'express';
import { GetUser } from '../../../common/decorators/Get.user.decorator';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard';
import { ApiJwtAuth } from '../../../common/swagger/api-auth.decorators';
import { PerksService } from '../perks.service';
import { PerksBillingService } from './perks-billing.service';
import { PerksBillingError, PerksStripeClient } from './perks-stripe.client';

@ApiTags('Perks Billing')
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
  @ApiJwtAuth()
  @ApiOperation({
    summary: 'Start Perks membership checkout',
    description:
      'Creates a Stripe Checkout session for Saveful Perks membership. The app should open the returned URL. Requires a JWT. After payment, Stripe calls the webhook and membership is activated.',
  })
  @ApiOkResponse({ description: 'Hosted checkout URL payload.' })
  async createCheckout(@GetUser() user: { userId: string }) {
    return this.success(await this.billing.startCheckout(user.userId));
  }

  @Post('portal')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  @ApiJwtAuth()
  @ApiOperation({
    summary: 'Open the Stripe customer portal',
    description:
      'Returns a Stripe Customer Portal URL so the member can update payment method or cancel. Return URL defaults to the Saveful deep link `saveful://perks?checkout=portal`. Requires a JWT.',
  })
  @ApiOkResponse({ description: 'Customer portal URL payload.' })
  async openPortal(@GetUser() user: { userId: string }) {
    // Same reasoning as checkout: deep-link straight back so the browser closes
    // itself when they tap "Return to Saveful" in the portal.
    const returnUrl = this.config.get<string>(
      'PERKS_BILLING_PORTAL_RETURN_URL',
      'saveful://perks?checkout=portal',
    );
    return this.success(await this.billing.openPortal(user.userId, returnUrl));
  }

  @Post('webhook')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Stripe Perks billing webhook',
    description:
      'Public Stripe webhook (no JWT). Must send the raw JSON body and a `Stripe-Signature` header. Activates Perks membership after successful payment. Mounted at `POST /api/perks/billing/webhook` with a raw-body parser.',
  })
  @ApiHeader({
    name: 'Stripe-Signature',
    required: true,
    description: 'Stripe webhook signature used to verify the raw payload.',
  })
  @ApiOkResponse({ description: '{ received: true } after the event is accepted.' })
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

      if (outcome.activatedUserId) {
        await this.perksService.completeRegistrationAfterPayment(
          outcome.activatedUserId,
        );
      }
    } catch (error) {
      if (error instanceof PerksBillingError) throw error;
      this.logger.error(
        `Perks webhook ${event.id} (${event.type}) failed after the payment: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }

    return { received: true };
  }
}
