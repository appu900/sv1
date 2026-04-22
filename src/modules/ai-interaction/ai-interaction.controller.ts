import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Query,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { GetUser } from '../../common/decorators/Get.user.decorator';
import { UserRole } from '../../database/schemas/user.auth.schema';
import { AIInteractionService } from './ai-interaction.service';
import { SetAiUserActionDto } from './dto/set-user-action.dto';

@Controller('ai-events')
@UseGuards(JwtAuthGuard)
export class AIInteractionController {
  constructor(private readonly aiService: AIInteractionService) {}

  @Patch(':id/user-action')
  @HttpCode(HttpStatus.OK)
  async setUserAction(
    @GetUser() user: any,
    @Param('id') id: string,
    @Body() dto: SetAiUserActionDto,
  ) {
    const userId = user?.userId || user?._id || user?.sub || user?.id;
    if (!userId) throw new UnauthorizedException();
    const event = await this.aiService.setUserAction(id, userId, dto.action);
    return {
      success: true,
      data: {
        id: String(event._id),
        userAction: event.userAction,
      },
    };
  }

  @Get('summary')
  async summary(
    @GetUser() user: any,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('scope') scope?: string,
  ) {
    const userId = user?.userId || user?._id || user?.sub || user?.id;
    if (!userId) throw new UnauthorizedException();

    const parseDate = (raw?: string): Date | undefined => {
      if (!raw) return undefined;
      const d = new Date(raw);
      return Number.isNaN(d.getTime()) ? undefined : d;
    };

    const isAdminScope = scope === 'all';
    if (isAdminScope && user?.role !== UserRole.ADMIN) {
      throw new ForbiddenException('Admin role required');
    }

    const rows = await this.aiService.summary({
      from: parseDate(from),
      to: parseDate(to),
      userId: isAdminScope ? undefined : String(userId),
    });
    return { success: true, rows };
  }
}
