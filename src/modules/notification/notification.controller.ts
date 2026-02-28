import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from 'src/common/guards/jwt-auth.guard';
import { RolesGuard } from 'src/common/guards/roles.guard';
import { GetUser } from 'src/common/decorators/Get.user.decorator';
import { Roles } from 'src/common/decorators/role.decorators';
import { NotificationService } from './notification.service';
import { RegisterTokenDto, UnregisterTokenDto } from './dto/register-token.dto';
import { SendNotificationDto } from './dto/send-notification.dto';
import { NotificationStatus } from 'src/database/schemas/notification.schema';

@Controller('notifications')
export class NotificationController {
  constructor(private readonly notificationService: NotificationService) {}

  @Post('token')
  @UseGuards(JwtAuthGuard)
  async registerToken(
    @Body() dto: RegisterTokenDto,
    @GetUser() user: any,
  ) {
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
