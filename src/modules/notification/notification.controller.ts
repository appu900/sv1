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
import { WINSTON_MODULE_PROVIDER } from 'nest-winston';
import { Logger } from 'winston';
import { JwtAuthGuard } from 'src/common/guards/jwt-auth.guard';
import { RolesGuard } from 'src/common/guards/roles.guard';
import { GetUser } from 'src/common/decorators/Get.user.decorator';
import { Roles } from 'src/common/decorators/role.decorators';
import { NotificationService } from './notification.service';
import { NotificationProducer } from './notification.producer';
import {
  RegisterTokenDto,
  UnregisterTokenDto,
} from './dto/register-token.dto';
import { SendNotificationDto } from './dto/send-notification.dto';
import { NotificationStatus } from 'src/database/schemas/notification.schema';

@Controller('notifications')
export class NotificationController {
  constructor(
    private readonly notificationService: NotificationService,
    private readonly notificationProducer: NotificationProducer,
    @Inject(WINSTON_MODULE_PROVIDER) private readonly logger: Logger,
  ) {}


  @Get('ping')
  ping() {
    return { status: 'ok', timestamp: new Date().toISOString() };
  }


  @Post('token')
  @UseGuards(JwtAuthGuard)
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
  async unregisterToken(
    @Body() dto: UnregisterTokenDto,
    @GetUser() user: any,
  ) {
    return this.notificationService.unregisterToken(user.userId, dto.token);
  }

  @Delete('tokens/all')
  @UseGuards(JwtAuthGuard)
  async unregisterAllTokens(@GetUser() user: any) {
    return this.notificationService.unregisterAllTokens(user.userId);
  }


  @Post('send')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN')
  async sendNotification(
    @Body() dto: SendNotificationDto,
    @GetUser() user: any,
  ) {
    return this.notificationService.send(dto, user.userId);
  }



  @Get('stats')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN')
  async getStats() {
    return this.notificationService.getStats();
  }



  @Get('queue/stats')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN')
  async getQueueStats() {
    return this.notificationProducer.getQueueStats();
  }

  @Post('queue/retry-failed')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN')
  async retryFailed() {
    const count = await this.notificationProducer.retryAllFailed();
    return { retriedCount: count, message: `Retried ${count} failed jobs` };
  }

  @Post('queue/drain')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN')
  async drainQueue() {
    await this.notificationProducer.drain();
    return { message: 'Queue drained — all pending jobs removed' };
  }


  @Get()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN')
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
  async getNotification(@Param('id') id: string) {
    return this.notificationService.getNotificationById(id);
  }
}