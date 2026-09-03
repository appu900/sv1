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
import {
  ApiTags,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiBody,
  ApiOkResponse,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { GetUser } from '../../common/decorators/Get.user.decorator';
import { ApiJwtAuth } from '../../common/swagger/api-auth.decorators';
import { UserRole } from '../../database/schemas/user.auth.schema';
import { AIInteractionService } from './ai-interaction.service';
import { SetAiUserActionDto } from './dto/set-user-action.dto';

@ApiTags('AI Events')
@ApiJwtAuth()
@Controller('ai-events')
@UseGuards(JwtAuthGuard)
export class AIInteractionController {
  constructor(private readonly aiService: AIInteractionService) {}

  @Patch(':id/user-action')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Set the user action on an AI event',
    description:
      'Records what the authenticated user did with a generated AI result (accepted, rejected, edited, etc.). The event must belong to the caller. Body: `{ action }` from the `AIUserAction` enum.',
  })
  @ApiParam({ name: 'id', description: 'AI interaction event ObjectId.' })
  @ApiBody({ type: SetAiUserActionDto })
  @ApiOkResponse({ description: 'Updated userAction on the event.' })
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
  @ApiOperation({
    summary: 'Get AI interaction summary',
    description:
      'Aggregated AI-event counts for the authenticated user. Optional `from` and `to` are ISO date-times. Pass `scope=all` for a platform-wide summary — that scope requires an admin role and returns 403 otherwise.',
  })
  @ApiQuery({
    name: 'from',
    required: false,
    description: 'Inclusive start of the window (ISO-8601 date-time).',
  })
  @ApiQuery({
    name: 'to',
    required: false,
    description: 'Inclusive end of the window (ISO-8601 date-time).',
  })
  @ApiQuery({
    name: 'scope',
    required: false,
    description:
      'Omit or any value other than `all` for the current user. `scope=all` is admin-only and aggregates every user.',
  })
  @ApiOkResponse({ description: 'AI interaction summary rows.' })
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
