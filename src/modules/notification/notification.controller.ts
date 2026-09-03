import {
  Body,
  Controller,
  Delete,
  Get,
  Inject,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiBody,
  ApiOkResponse,
  ApiCreatedResponse,
} from '@nestjs/swagger';
import { WINSTON_MODULE_PROVIDER } from 'nest-winston';
import { Logger } from 'winston';
import { JwtAuthGuard } from 'src/common/guards/jwt-auth.guard';
import { RolesGuard } from 'src/common/guards/roles.guard';
import { AdminServiceKeyGuard } from 'src/common/guards/admin-service-key.guard';
import { GetUser } from 'src/common/decorators/Get.user.decorator';
import { Roles } from 'src/common/decorators/role.decorators';
import {
  ApiJwtAuth,
  ApiJwtRoles,
  ApiAdminServiceKeyAuth,
} from 'src/common/swagger/api-auth.decorators';
import { NotificationService } from './notification.service';
import { NotificationProducer } from './notification.producer';
import {
  RegisterTokenDto,
  UnregisterTokenDto,
} from './dto/register-token.dto';
import { SendNotificationDto } from './dto/send-notification.dto';
import { NotificationStatus } from 'src/database/schemas/notification.schema';

@ApiTags('Notifications')
@Controller('notifications')
export class NotificationController {
  constructor(
    private readonly notificationService: NotificationService,
    private readonly notificationProducer: NotificationProducer,
    @Inject(WINSTON_MODULE_PROVIDER) private readonly logger: Logger,
  ) {}


  @Get('ping')
  @ApiOperation({
    summary: 'Ping the notification service',
    description:
      'Public liveness check (no JWT). Returns `{ status: "ok", timestamp }` so load balancers and the admin dashboard can confirm the module is up.',
  })
  @ApiOkResponse({ description: 'Service is reachable.' })
  ping() {
    return { status: 'ok', timestamp: new Date().toISOString() };
  }


  @Post('token')
  @UseGuards(JwtAuthGuard)
  @ApiJwtAuth()
  @ApiOperation({
    summary: 'Register a push token',
    description:
      'Registers or refreshes an Expo / FCM device token for the authenticated user so they can receive push notifications.',
  })
  @ApiBody({ type: RegisterTokenDto })
  @ApiCreatedResponse({ description: 'Token registered.' })
  async registerToken(
    @Body() dto: RegisterTokenDto,
    @GetUser() user: any,
    @Req() req: any,
  ) {
    this.logger.info('POST /notifications/token received', {
      service: 'NotificationController',
      userId: user?.userId,
      platform: dto?.platform,
      tokenPrefix: dto?.token?.substring(0, 20),
      ip: req?.ip,
    });
    return this.notificationService.registerToken(user.userId, dto);
  }

  @Delete('token')
  @UseGuards(JwtAuthGuard)
  @ApiJwtAuth()
  @ApiOperation({
    summary: 'Unregister a push token',
    description:
      'Removes a single device token for the authenticated user (for example on logout). Send the token in the request body.',
  })
  @ApiBody({ type: UnregisterTokenDto })
  @ApiOkResponse({ description: 'Token removed.' })
  async unregisterToken(
    @Body() dto: UnregisterTokenDto,
    @GetUser() user: any,
  ) {
    return this.notificationService.unregisterToken(user.userId, dto.token);
  }

  @Delete('tokens/all')
  @UseGuards(JwtAuthGuard)
  @ApiJwtAuth()
  @ApiOperation({
    summary: 'Unregister all push tokens',
    description:
      'Removes every device token for the authenticated user. Used when signing out of all devices.',
  })
  @ApiOkResponse({ description: 'All tokens removed.' })
  async unregisterAllTokens(@GetUser() user: any) {
    return this.notificationService.unregisterAllTokens(user.userId);
  }


  @Post('send')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN')
  @ApiJwtRoles('Requires admin role.')
  @ApiOperation({
    summary: 'Send a notification (admin)',
    description:
      'Admin-only. Creates and queues a push notification (title, body, optional deep link / image / audience). Delivery is handled asynchronously via BullMQ and Firebase / Expo.',
  })
  @ApiBody({ type: SendNotificationDto })
  @ApiCreatedResponse({ description: 'Notification queued.' })
  async sendNotification(
    @Body() dto: SendNotificationDto,
    @GetUser() user: any,
  ) {
    return this.notificationService.send(dto, user.userId);
  }

  /**
   * Admin-dashboard service-to-service endpoint.
   * Dispatches a notification that was already created in MongoDB (by the admin UI)
   * into the BullMQ queue for actual delivery via Firebase / Expo.
   * Auth: X-Admin-Service-Key header (no JWT required).
   */
  @Post('dispatch/:id')
  @UseGuards(AdminServiceKeyGuard)
  @ApiAdminServiceKeyAuth()
  @ApiOperation({
    summary: 'Dispatch an existing notification',
    description:
      'Service-to-service. Enqueues a notification that was already created in MongoDB (typically by the admin UI) for Firebase / Expo delivery. Auth is `x-admin-service-key` — no JWT.',
  })
  @ApiParam({ name: 'id', description: 'Notification document id to dispatch.' })
  @ApiOkResponse({ description: 'Notification dispatched to the queue.' })
  async dispatchNotification(@Param('id') id: string) {
    return this.notificationService.dispatchExisting(id);
  }



  @Get('stats')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN')
  @ApiJwtRoles('Requires admin role.')
  @ApiOperation({
    summary: 'Get notification delivery stats (admin JWT)',
    description:
      'Admin JWT. Returns aggregate counts by status (queued, sent, failed, etc.) for the notifications dashboard.',
  })
  @ApiOkResponse({ description: 'Notification statistics.' })
  async getStats() {
    return this.notificationService.getStats();
  }

  @Get('admin/stats')
  @UseGuards(AdminServiceKeyGuard)
  @ApiAdminServiceKeyAuth()
  @ApiOperation({
    summary: 'Get notification delivery stats (service key)',
    description:
      'Same stats payload as `GET /notifications/stats`, authenticated with `x-admin-service-key` for the admin dashboard service. No JWT.',
  })
  @ApiOkResponse({ description: 'Notification statistics.' })
  async getAdminStats() {
    return this.notificationService.getStats();
  }



  @Get('queue/stats')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN')
  @ApiJwtRoles('Requires admin role.')
  @ApiOperation({
    summary: 'Get BullMQ queue stats',
    description:
      'Admin-only. Returns waiting / active / completed / failed job counts for the notification queue.',
  })
  @ApiOkResponse({ description: 'Queue statistics.' })
  async getQueueStats() {
    return this.notificationProducer.getQueueStats();
  }

  @Post('queue/retry-failed')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN')
  @ApiJwtRoles('Requires admin role.')
  @ApiOperation({
    summary: 'Retry all failed notification jobs',
    description:
      'Admin-only. Re-queues every failed BullMQ notification job and returns how many were retried.',
  })
  @ApiOkResponse({ description: 'Failed jobs retried.' })
  async retryFailed() {
    const count = await this.notificationProducer.retryAllFailed();
    return { retriedCount: count, message: `Retried ${count} failed jobs` };
  }

  @Post('queue/drain')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN')
  @ApiJwtRoles('Requires admin role.')
  @ApiOperation({
    summary: 'Drain the notification queue',
    description:
      'Admin-only. Removes all pending (waiting) jobs from the notification queue. Does not delete already-sent notification documents.',
  })
  @ApiOkResponse({ description: 'Pending jobs removed.' })
  async drainQueue() {
    await this.notificationProducer.drain();
    return { message: 'Queue drained — all pending jobs removed' };
  }


  @Get()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN')
  @ApiJwtRoles('Requires admin role.')
  @ApiOperation({
    summary: 'List notifications',
    description:
      'Admin-only paginated list of notification documents. Filter by `status` (`queued`, `processing`, `sent`, `partially_sent`, `failed`). Defaults to page 1, limit 20.',
  })
  @ApiQuery({ name: 'page', required: false, description: 'Page number. Defaults to 1.' })
  @ApiQuery({ name: 'limit', required: false, description: 'Page size. Defaults to 20.' })
  @ApiQuery({
    name: 'status',
    required: false,
    enum: NotificationStatus,
    description: 'Optional status filter.',
  })
  @ApiOkResponse({ description: 'Paginated notification list.' })
  async getNotifications(
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('status') status?: NotificationStatus,
  ) {
    return this.notificationService.getNotifications(
      page ? parseInt(page, 10) : 1,
      limit ? parseInt(limit, 10) : 20,
      status,
    );
  }

  @Get(':id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN')
  @ApiJwtRoles('Requires admin role.')
  @ApiOperation({
    summary: 'Get a notification by id',
    description:
      'Admin-only. Returns one notification document including audience, payload, and delivery status.',
  })
  @ApiParam({ name: 'id', description: 'Notification document id.' })
  @ApiOkResponse({ description: 'Notification document.' })
  async getNotification(@Param('id') id: string) {
    return this.notificationService.getNotificationById(id);
  }
}
