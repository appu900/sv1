import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/role.decorators';
import { GetUser } from '../../common/decorators/Get.user.decorator';
import { UserRole } from '../../database/schemas/user.auth.schema';
import { ApiJwtRoles } from '../../common/swagger/api-auth.decorators';
import { ReferralCodeService } from './referral-code.service';
import { ReferralAttributionService } from './referral-attribution.service';
import { ReferralLedgerService } from './referral-ledger.service';
import { ReferralPayoutService } from './referral-payout.service';
import { ReferralAdminService } from './referral-admin.service';
import {
  AttributionNoteDto,
  AttributionQueryDto,
  CreateAdjustmentDto,
  CreateReferralCodeDto,
  ExportPayoutsQueryDto,
  GeneratePayoutsDto,
  LedgerQueryDto,
  MarkPayoutPaidDto,
  PayoutQueryDto,
  ReassignAttributionDto,
  ResolveHoldDto,
  UpdatePaymentDetailsDto,
  UpdateReferralCodeDto,
  VoidPayoutDto,
} from './dto/admin-referral.dto';

@ApiTags('Admin Referrals')
@Controller('admin/referrals')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN)
@ApiJwtRoles()
export class AdminReferralsController {
  constructor(
    private readonly codeService: ReferralCodeService,
    private readonly attributionService: ReferralAttributionService,
    private readonly ledgerService: ReferralLedgerService,
    private readonly payoutService: ReferralPayoutService,
    private readonly adminService: ReferralAdminService,
  ) {}

  // Chefs ------------------------------------------------------------------

  @Get('chefs')
  @ApiOperation({ summary: 'Referral overview per chef (codes, counts, balances, payment status)' })
  overview() {
    return this.adminService.overview();
  }

  @Patch('chefs/:chefUserId/payment-details')
  @ApiOperation({
    summary: 'Record chef payout-detail status',
    description:
      'Bank details are held by finance outside Saveful; this stores only status, last 4 digits, payout currency and a note. Verifying releases on-hold payouts.',
  })
  updatePaymentDetails(
    @Param('chefUserId') chefUserId: string,
    @Body() dto: UpdatePaymentDetailsDto,
  ) {
    return this.adminService.updatePaymentDetails(chefUserId, dto);
  }

  // Codes -------------------------------------------------------------------

  @Get('codes')
  @ApiOperation({ summary: 'List referral codes' })
  listCodes(@Query('chefUserId') chefUserId?: string) {
    return this.codeService.listAll({ chefUserId });
  }

  @Post('codes')
  @ApiOperation({ summary: 'Create a referral code for a chef (generated or vanity)' })
  createCode(@GetUser() user: any, @Body() dto: CreateReferralCodeDto) {
    return this.codeService.createForChef(
      dto.chefUserId,
      { code: dto.code, makePrimary: dto.makePrimary },
      user.userId,
    );
  }

  @Patch('codes/:id')
  @ApiOperation({ summary: 'Disable/enable a code or make it primary' })
  updateCode(@Param('id') id: string, @Body() dto: UpdateReferralCodeDto) {
    return this.codeService.update(id, dto);
  }

  // Attributions --------------------------------------------------------------

  @Get('attributions')
  @ApiOperation({ summary: 'Referred customers (admin only; includes subscriber email)' })
  listAttributions(@Query() query: AttributionQueryDto) {
    return this.attributionService.listForAdmin(query);
  }

  @Post('attributions/:id/void')
  @ApiOperation({ summary: 'Void a referral before its first paid transaction' })
  voidAttribution(
    @GetUser() user: any,
    @Param('id') id: string,
    @Body() dto: AttributionNoteDto,
  ) {
    return this.attributionService.voidByAdmin(id, user.userId, dto.note ?? '');
  }

  @Post('attributions/:id/reassign')
  @ApiOperation({ summary: 'Move a referral to another chef code before its first paid transaction' })
  reassignAttribution(
    @GetUser() user: any,
    @Param('id') id: string,
    @Body() dto: ReassignAttributionDto,
  ) {
    return this.attributionService.reassignByAdmin(id, dto.code, user.userId, dto.note ?? '');
  }

  // Ledger --------------------------------------------------------------------

  @Get('ledger')
  @ApiOperation({ summary: 'Commission ledger (PRODUCTION by default)' })
  listLedger(@Query() query: LedgerQueryDto) {
    return this.ledgerService.listForAdmin(query);
  }

  @Post('ledger/:id/resolve-hold')
  @ApiOperation({ summary: 'Confirm the amount of a held earning from store reports' })
  resolveHold(@GetUser() user: any, @Param('id') id: string, @Body() dto: ResolveHoldDto) {
    return this.ledgerService.resolveHold(id, dto, user.userId);
  }

  @Post('ledger/:id/void-hold')
  @ApiOperation({ summary: 'Drop a held earning that should not be paid' })
  voidHold(@GetUser() user: any, @Param('id') id: string, @Body() dto: AttributionNoteDto) {
    return this.ledgerService.voidHold(id, dto.note ?? '', user.userId);
  }

  @Post('ledger/adjustments')
  @ApiOperation({ summary: 'Manual commission adjustment (signed), settled with the next payout' })
  createAdjustment(@GetUser() user: any, @Body() dto: CreateAdjustmentDto) {
    return this.ledgerService.createAdjustment(dto, user.userId);
  }

  // Payouts -------------------------------------------------------------------

  @Get('payouts')
  @ApiOperation({ summary: 'List quarterly payouts' })
  listPayouts(@Query() query: PayoutQueryDto) {
    return this.payoutService.list(query);
  }

  @Get('payouts/export')
  @ApiOperation({ summary: 'Finance export rows for a quarter' })
  exportPayouts(@Query() query: ExportPayoutsQueryDto) {
    return this.payoutService.exportRows(query.quarter);
  }

  @Post('payouts/generate')
  @ApiOperation({
    summary: 'Generate draft payouts for an ended quarter',
    description:
      'One payout per chef from all PRODUCTION pending entries dated before the quarter end. Non-positive balances carry forward. Chefs without verified payment details are put on hold.',
  })
  generatePayouts(@GetUser() user: any, @Body() dto: GeneratePayoutsDto) {
    return this.payoutService.generate(dto.quarter, user.userId);
  }

  @Get('payouts/:id')
  @ApiOperation({ summary: 'Payout with its ledger entries' })
  getPayout(@Param('id') id: string) {
    return this.payoutService.get(id);
  }

  @Post('payouts/:id/approve')
  @ApiOperation({ summary: 'Approve a payout after reconciling against store reports' })
  approvePayout(@GetUser() user: any, @Param('id') id: string) {
    return this.payoutService.approve(id, user.userId);
  }

  @Post('payouts/:id/mark-paid')
  @ApiOperation({ summary: 'Record the bank payment and email the chef their statement' })
  markPaid(@GetUser() user: any, @Param('id') id: string, @Body() dto: MarkPayoutPaidDto) {
    return this.payoutService.markPaid(id, dto, user.userId);
  }

  @Post('payouts/:id/void')
  @ApiOperation({ summary: 'Void an unpaid payout; its entries return to pending' })
  voidPayout(@GetUser() user: any, @Param('id') id: string, @Body() dto: VoidPayoutDto) {
    return this.payoutService.void(id, dto.reason, user.userId);
  }
}
