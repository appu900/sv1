import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  Request,
  UseGuards,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiOkResponse,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/role.decorators';
import { SubscriptionService } from './subscription.service';
import { SyncSubscriptionDto } from './dto/sync-subscription.dto';
import { CancelFeedbackDto } from './dto/cancel-feedback.dto';
import { ApiJwtAuth, ApiJwtRoles } from '../../common/swagger/api-auth.decorators';

function resolveUserId(req: any): string {
  return (req.user?._id || req.user?.userId || req.user?.id) as string;
}

@ApiTags('Subscription')
@ApiJwtAuth()
@Controller('subscription')
@UseGuards(JwtAuthGuard)
export class SubscriptionController {
  constructor(private readonly subscriptionService: SubscriptionService) {}

 
  @Post('sync')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Sync subscription from RevenueCat',
    description:
      'Authenticated user (JWT). Body: SyncSubscriptionDto — `customerInfo` (RevenueCat CustomerInfo object) and optional `revenueCatUserId`. Writes the caller’s subscription from the SDK snapshot, then returns the current subscription snapshot (plan, usage, limits).',
  })
  @ApiOkResponse({
    description:
      'Subscription snapshot after sync (plan, billedPlan, status, features, limits, usage).',
  })
  async sync(@Request() req: any, @Body() dto: SyncSubscriptionDto) {
    const userId = resolveUserId(req);
    await this.subscriptionService.syncFromCustomerInfo(
      userId,
      dto.customerInfo,
      dto.revenueCatUserId,
    );
    return this.subscriptionService.getSubscriptionSnapshot(userId);
  }

  @Get()
  @ApiOperation({
    summary: 'Get subscription snapshot',
    description:
      'Authenticated user (JWT). Returns the caller’s current plan, billing status, entitlements, trial flags, feature limits, and period usage. Read-only; does not call RevenueCat.',
  })
  @ApiOkResponse({
    description:
      'Snapshot: plan, billedPlan, status, isPaid, features, limits, usage, trial fields.',
  })
  async get(@Request() req: any) {
    const userId = resolveUserId(req);
    return this.subscriptionService.getSubscriptionSnapshot(userId);
  }

  @Post('cancel-feedback')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Record cancel-survey feedback',
    description:
      'Authenticated user (JWT). Body: CancelFeedbackDto — required `reason` (enum such as too_expensive, not_using_enough, other) and optional details, productId, plan. Stores cancel feedback on the subscription document. Returns `{ ok: true }`.',
  })
  @ApiOkResponse({ description: '`{ ok: true }` after feedback is saved.' })
  async cancelFeedback(
    @Request() req: any,
    @Body() dto: CancelFeedbackDto,
  ) {
    const userId = resolveUserId(req);
    await this.subscriptionService.recordCancelFeedback(userId, dto);
    return { ok: true };
  }

  @Post('admin/revoke/:userId')
  @UseGuards(RolesGuard)
  @Roles('admin')
  @HttpCode(HttpStatus.OK)
  @ApiJwtRoles('Admin role required to revoke a user subscription.')
  @ApiOperation({
    summary: 'Admin revoke user subscription',
    description:
      'Admin JWT (RolesGuard). Path `:userId` is the target user. Deletes the RevenueCat subscriber when configured and clears local subscription/usage. Query `purgeTrialHistory=true` also wipes trialsConsumed so the user can trial again; omit or false to retain trial history.',
  })
  @ApiParam({ name: 'userId', description: 'User ObjectId whose subscription is revoked.' })
  @ApiQuery({
    name: 'purgeTrialHistory',
    required: false,
    description:
      'Set to `true` to clear trialsConsumed. Any other value (or omit) retains trial history.',
  })
  @ApiOkResponse({
    description:
      '`{ revenueCatDeleted, localDeleted, usageDeleted, trialsRetained }` after revoke.',
  })
  async adminRevoke(
    @Param('userId') userId: string,
    @Query('purgeTrialHistory') purgeTrialHistory?: string,
  ) {
    return this.subscriptionService.revokeUserSubscription(userId, {
      purgeTrialHistory: purgeTrialHistory === 'true',
    });
  }
}
