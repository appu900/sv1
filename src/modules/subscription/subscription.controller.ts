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
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/role.decorators';
import { SubscriptionService } from './subscription.service';
import { SyncSubscriptionDto } from './dto/sync-subscription.dto';
import { CancelFeedbackDto } from './dto/cancel-feedback.dto';

function resolveUserId(req: any): string {
  return (req.user?._id || req.user?.userId || req.user?.id) as string;
}

@Controller('subscription')
@UseGuards(JwtAuthGuard)
export class SubscriptionController {
  constructor(private readonly subscriptionService: SubscriptionService) {}

 
  @Post('sync')
  @HttpCode(HttpStatus.OK)
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
  async get(@Request() req: any) {
    const userId = resolveUserId(req);
    return this.subscriptionService.getSubscriptionSnapshot(userId);
  }

  /**
   * Records the user's cancellation reason. Apple/Google still own the
   * actual cancellation flow — we only capture feedback for product analytics
   * and so support can follow up if needed.
   */
  @Post('cancel-feedback')
  @HttpCode(HttpStatus.OK)
  async cancelFeedback(
    @Request() req: any,
    @Body() dto: CancelFeedbackDto,
  ) {
    const userId = resolveUserId(req);
    await this.subscriptionService.recordCancelFeedback(userId, dto);
    return { ok: true };
  }

  /**
   * Admin-only: hard-revoke a user from the subscription system.
   * Deletes the customer at RevenueCat and purges local Subscription /
   * SubscriptionUsage docs. Use for refunds, banned users, or wiping
   * test accounts.
   *
   *   POST /subscription/admin/revoke/:userId            (keeps trial markers)
   *   POST /subscription/admin/revoke/:userId?purgeTrialHistory=true
   */
  @Post('admin/revoke/:userId')
  @UseGuards(RolesGuard)
  @Roles('admin')
  @HttpCode(HttpStatus.OK)
  async adminRevoke(
    @Param('userId') userId: string,
    @Query('purgeTrialHistory') purgeTrialHistory?: string,
  ) {
    return this.subscriptionService.revokeUserSubscription(userId, {
      purgeTrialHistory: purgeTrialHistory === 'true',
    });
  }
}
