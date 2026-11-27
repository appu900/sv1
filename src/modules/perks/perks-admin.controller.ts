import { Controller, Get, HttpCode, Post, UseGuards } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AdminServiceKeyGuard } from '../../common/guards/admin-service-key.guard';
import { ApiAdminServiceKeyAuth } from '../../common/swagger/api-auth.decorators';
import { PerksOrderSyncService } from './perks-order-sync.service';

/** Server-to-server endpoints for the admin dashboard. Auth: `x-admin-service-key`. */
@ApiTags('Perks')
@Controller('perks/admin')
@UseGuards(AdminServiceKeyGuard)
@ApiAdminServiceKeyAuth()
export class PerksAdminController {
  constructor(private readonly sync: PerksOrderSyncService) {}

  @Get('orders/sync')
  @ApiOperation({
    summary: 'Last Perks order sync (service key)',
    description:
      'Summary of the most recent copy of members’ WeMAD orders into the reporting store.',
  })
  @ApiOkResponse({ description: 'Last sync summary, or null.' })
  async lastSync() {
    return { success: true, data: await this.sync.lastSummary() };
  }

  @Post('orders/sync')
  @HttpCode(202)
  @ApiOperation({
    summary: 'Start a Perks order sync (service key)',
    description:
      'Starts copying every active member’s WeMAD orders into the reporting store, in the background. Does nothing if a sync is already running.',
  })
  @ApiOkResponse({ description: 'Whether a sync was started.' })
  async startSync() {
    const last = await this.sync.lastSummary();
    if (last?.status === 'running') {
      return { success: true, started: false, data: last };
    }
    void this.sync.syncAll('admin');
    return { success: true, started: true };
  }
}
