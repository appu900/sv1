import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, UseGuards } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { GetUser } from '../../common/decorators/Get.user.decorator';
import { ApiJwtAuth } from '../../common/swagger/api-auth.decorators';
import { ReferralCodeService } from './referral-code.service';
import { ReferralAttributionService } from './referral-attribution.service';
import { BindReferralDto } from './dto/bind-referral.dto';

@ApiTags('Referrals')
@Controller('referrals')
export class ReferralsController {
  constructor(
    private readonly codeService: ReferralCodeService,
    private readonly attributionService: ReferralAttributionService,
  ) {}

  @Get('codes/:code')
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  @ApiOperation({
    summary: 'Look up a chef referral code',
    description:
      'Public, rate-limited. Used by the referral landing page and the app code field. Returns `{ valid: false }` for unknown or disabled codes, otherwise the chef card and the customer offer (discount %, trial days).',
  })
  @ApiParam({ name: 'code', description: 'Referral code (case-insensitive).' })
  @ApiOkResponse({ description: '`{ valid, code, link, chef, discountPercent, trialDays }`.' })
  lookup(@Param('code') code: string) {
    return this.codeService.publicLookup(code);
  }

  @Post('bind')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard)
  @ApiJwtAuth()
  @ApiOperation({
    summary: 'Attach a chef referral to my account',
    description:
      'Locks the caller to the chef behind the code. Only accounts that have never subscribed or trialled are eligible, and the first valid code wins. Returns `{ status: "bound" | "already_bound", referral }` or `{ status: "rejected", reason }`.',
  })
  bind(@GetUser() user: any, @Body() dto: BindReferralDto) {
    return this.attributionService.bind(user.userId, dto.code, dto.source);
  }

  @Get('me')
  @UseGuards(JwtAuthGuard)
  @ApiJwtAuth()
  @ApiOperation({
    summary: 'My referral and discount eligibility',
    description:
      'Returns the chef this account was referred by (if any) and whether the first-payment referral discount applies, with the store details the paywall needs (iOS offer codes per product, Android offer tag).',
  })
  me(@GetUser() user: any) {
    return this.attributionService.getMine(user.userId);
  }
}
