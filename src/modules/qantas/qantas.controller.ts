import {
  Controller,
  Get,
  Post,
  Delete,
  Body,
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


  @Get('test-connection')
  async testConnection() {
    const runtime = this.qantasApiClient.getRuntimeConfig();

    const results: Record<string, any> = {
      timestamp: new Date().toISOString(),
      baseUrl: runtime.baseUrl,
      partnerCode: runtime.partnerCode,
      linkAuthPresent: runtime.linkAuthPresent,
      redeemAuthPresent: runtime.redeemAuthPresent,
      endpoints: {},
    };

    try {
      const url = `${runtime.baseUrl}/member/program/partner/link`;
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ partnerCode: 'CONNECTIVITYTEST' }),
      });
      const body = await res.text();
      const isAkamai = body.includes('Access Denied') || body.includes('akamai');
      results.endpoints.partnerLinking = {
        status: res.status,
        isAkamaiBlock: isAkamai,
        reachable: !isAkamai,
        body: body.substring(0, 300),
      };
    } catch (err) {
      results.endpoints.partnerLinking = { error: String(err) };
    }

    try {
      const url = `${runtime.baseUrl}/pos/api/member/v2/members/0000000000/earntransactions`;
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      const body = await res.text();
      const isAkamai = body.includes('Access Denied') || body.includes('akamai');
      results.endpoints.qlposEarn = {
        status: res.status,
        isAkamaiBlock: isAkamai,
        reachable: !isAkamai,
        body: body.substring(0, 300),
      };
    } catch (err) {
      results.endpoints.qlposEarn = { error: String(err) };
    }

    try {
      const url = `${runtime.baseUrl}/member/0000000000/program/QFF`;
      const res = await fetch(url, {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' },
      });
      const body = await res.text();
      const isAkamai = body.includes('Access Denied') || body.includes('akamai');
      results.endpoints.memberDetail = {
        status: res.status,
        isAkamaiBlock: isAkamai,
        reachable: !isAkamai,
        body: body.substring(0, 300),
      };
    } catch (err) {
      results.endpoints.memberDetail = { error: String(err) };
    }

    this.logger.log(`[test-connection] ${JSON.stringify(results)}`);
    return results;
  }


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
}