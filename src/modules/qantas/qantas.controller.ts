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
import {
  ApiTags,
  ApiOperation,
  ApiBody,
  ApiOkResponse,
  ApiCreatedResponse,
} from '@nestjs/swagger';
import { QantasService } from './qantas.service';
import { LinkFFNDto } from './dto/link-ffn.dto';
import { QantasApiClient } from './qantas-api-client';
import { GetUser } from 'src/common/decorators/Get.user.decorator';
import { JwtAuthGuard } from 'src/common/guards/jwt-auth.guard';
import { ApiJwtAuth } from 'src/common/swagger/api-auth.decorators';

@ApiTags('Qantas')
@Controller('qantas')
export class QantasController {
  private readonly logger = new Logger(QantasController.name);

  constructor(
    private readonly qantasService: QantasService,
    private readonly qantasApiClient: QantasApiClient,
  ) {}


  @Get('test-connection')
  @ApiOperation({
    summary: 'Test Qantas API connectivity',
    description:
      'Public health check (no JWT). Probes Qantas partner-linking, QLPOS earn, and member-detail endpoints and reports HTTP status, Akamai blocks, and a short body snippet. Used by ops — not the mobile app.',
  })
  @ApiOkResponse({ description: 'Connectivity probe results.' })
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
  @ApiJwtAuth()
  @ApiOperation({
    summary: 'Get linked Qantas Frequent Flyer number',
    description:
      'Returns the authenticated user’s linked Qantas Frequent Flyer number and link status, or an empty/unlinked payload when none is stored.',
  })
  @ApiOkResponse({ description: 'Linked FFN status.' })
  async getFFN(@GetUser() user: any) {
    return this.qantasService.getFFN(user.userId);
  }

  @UseGuards(JwtAuthGuard)
  @Get('dashboard')
  @ApiJwtAuth()
  @ApiOperation({
    summary: 'Get Qantas points dashboard',
    description:
      'Returns the user’s Qantas earn dashboard: linked FFN, points earned through Saveful, and recent earn activity.',
  })
  @ApiOkResponse({ description: 'Qantas dashboard payload.' })
  async getDashboard(@GetUser() user: any) {
    return this.qantasService.getDashboard(user.userId);
  }

  @UseGuards(JwtAuthGuard)
  @Post('link')
  @HttpCode(HttpStatus.CREATED)
  @ApiJwtAuth()
  @ApiOperation({
    summary: 'Link a Qantas Frequent Flyer number',
    description:
      'Links the authenticated user’s account to a Qantas Frequent Flyer number so subsequent Saveful activity can earn points.',
  })
  @ApiBody({ type: LinkFFNDto })
  @ApiCreatedResponse({ description: 'FFN linked.' })
  async linkFFN(@GetUser() user: any, @Body() dto: LinkFFNDto) {
    return this.qantasService.linkFFN(user.userId, dto);
  }

  @UseGuards(JwtAuthGuard)
  @Delete('unlink')
  @HttpCode(HttpStatus.OK)
  @ApiJwtAuth()
  @ApiOperation({
    summary: 'Unlink the Qantas Frequent Flyer number',
    description:
      'Removes the linked Frequent Flyer number from the authenticated user’s account. Past earn history is retained.',
  })
  @ApiOkResponse({ description: 'FFN unlinked.' })
  async unlinkFFN(@GetUser() user: any) {
    return this.qantasService.unlinkFFN(user.userId);
  }
}
