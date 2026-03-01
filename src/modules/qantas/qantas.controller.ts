import {
  Controller,
  Get,
  Post,
  Delete,
  Body,
  Param,
  UseGuards,
  HttpCode,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { QantasService } from './qantas.service';
import { LinkFFNDto } from './dto/link-ffn.dto';
import { QantasApiClient } from './qantas-api-client';
import { GetUser } from 'src/common/decorators/Get.user.decorator';
import { JwtAuthGuard } from 'src/common/guards/jwt-auth.guard';

@Controller('qantas')
export class QantasController {
  private readonly logger = new Logger(QantasController.name);

  constructor(
    private readonly qantasService: QantasService,
    private readonly qantasApiClient: QantasApiClient,
  ) {}

  /* ─────── Public diagnostic endpoint (no auth needed) ─────── */

  /**
   * GET /api/qantas/test-connection
   *
   * Tests connectivity from THIS server to the Qantas SIT/PRD API.
   * Returns detailed status so we can tell if Akamai is blocking us.
   */
  @Get('test-connection')
  async testConnection() {
    const runtime = this.qantasApiClient.getRuntimeConfig();
    const baseUrl = runtime.baseUrl;
    const validationAuth = runtime.validationAuthHeader;
    const accrualAuth = runtime.accrualAuthHeader;
    const partnerId = runtime.partnerId;

    const results: Record<string, any> = {
      timestamp: new Date().toISOString(),
      environment: runtime.environment,
      baseUrl,
      partnerId,
      validationAuthPresent: !!validationAuth,
      accrualAuthPresent: !!accrualAuth,
    };

    // Test 1: validation endpoint with a dummy payload
    try {
      const valUrl = `${baseUrl}/validation/members`;
      const valRes = await fetch(valUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Basic ${validationAuth}`,
        },
        body: JSON.stringify({
          memberId: '0000000000',
          criteria: { surname: 'CONNECTIVITYTEST' },
        }),
      });
      const valBody = await valRes.text();
      const isAkamai = valBody.includes('Access Denied') || valBody.includes('akamai');
      results.validation = {
        status: valRes.status,
        isAkamaiBlock: isAkamai,
        body: valBody.substring(0, 500),
      };
    } catch (err) {
      results.validation = { error: String(err) };
    }

    // Test 2: accrual endpoint (OPTIONS-like probe)
    try {
      const accUrl = `${baseUrl}/member/transactions/accrual/partner`;
      const accRes = await fetch(accUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Basic ${accrualAuth}`,
        },
        body: JSON.stringify({ partnerID: partnerId }),
      });
      const accBody = await accRes.text();
      const isAkamai = accBody.includes('Access Denied') || accBody.includes('akamai');
      results.accrual = {
        status: accRes.status,
        isAkamaiBlock: isAkamai,
        body: accBody.substring(0, 500),
      };
    } catch (err) {
      results.accrual = { error: String(err) };
    }

    this.logger.log(`[test-connection] results: ${JSON.stringify(results)}`);
    return results;
  }

  /* ─────── Protected endpoints ─────── */

  @UseGuards(JwtAuthGuard)
  @Get()
  async getFFN(@GetUser() user: any) {
    return this.qantasService.getFFN(user.userId);
  }

  @UseGuards(JwtAuthGuard)
  @Get('dashboard')
  async getDashboard(@GetUser() user: any) {
    return this.qantasService.getDashboard(user.userId);
  }

  @UseGuards(JwtAuthGuard)
  @Post('link')
  @HttpCode(HttpStatus.CREATED)
  async linkFFN(@GetUser() user: any, @Body() dto: LinkFFNDto) {
    return this.qantasService.linkFFN(user.userId, dto);
  }

  @UseGuards(JwtAuthGuard)
  @Delete('unlink')
  @HttpCode(HttpStatus.OK)
  async unlinkFFN(@GetUser() user: any) {
    return this.qantasService.unlinkFFN(user.userId);
  }

  @UseGuards(JwtAuthGuard)
  @Post('cancel-accrual/:allocationId')
  @HttpCode(HttpStatus.OK)
  async cancelAccrual(@Param('allocationId') allocationId: string) {
    return this.qantasService.cancelAccrual(allocationId);
  }
}
