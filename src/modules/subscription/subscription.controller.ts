import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Request,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
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
}
