import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Query,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { GetUser } from '../../common/decorators/Get.user.decorator';
import { UserEventService } from './user-event.service';
import { RecipeViewService } from './recipe-view.service';
import { FeatureUsageService } from './feature-usage.service';
import { RecordRecipeViewDto, RecordUserEventDto } from './dto/user-event.dto';
import { LogFeatureUsageDto } from './dto/feature-usage.dto';
import { RecipeViewSource } from '../../database/schemas/recipe-view.schema';

@Controller()
@UseGuards(JwtAuthGuard)
export class UserEventsController {
  constructor(
    private readonly userEventService: UserEventService,
    private readonly recipeViewService: RecipeViewService,
    private readonly featureUsageService: FeatureUsageService,
  ) {}

  @Post('user-events')
  @HttpCode(HttpStatus.OK)
  async record(@GetUser() user: any, @Body() dto: RecordUserEventDto) {
    const userId = user?.userId || user?._id;
    if (!userId) throw new UnauthorizedException();

    const firstOccurrence = await this.userEventService.recordFirst(
      userId,
      dto.eventType,
      dto.metadata ?? {},
    );
    return { success: true, firstOccurrence };
  }

  @Get('user-events')
  async list(@GetUser() user: any) {
    const userId = user?.userId || user?._id;
    if (!userId) throw new UnauthorizedException();
    const events = await this.userEventService.getEventsForUser(userId);
    return { success: true, events };
  }

  @Get('user-events/funnel')
  async funnel() {
    return this.userEventService.funnelCounts();
  }

  @Post('recipe-views')
  @HttpCode(HttpStatus.OK)
  async recordRecipeView(
    @GetUser() user: any,
    @Body() dto: RecordRecipeViewDto,
  ) {
    const userId = user?.userId || user?._id;
    if (!userId) throw new UnauthorizedException();

    const result = await this.recipeViewService.recordView(
      String(userId),
      dto.recipeId,
      dto.source ?? RecipeViewSource.OTHER,
    );
    return result;
  }

  @Post('feature-usage')
  @HttpCode(HttpStatus.OK)
  async logFeatureUsage(
    @GetUser() user: any,
    @Body() dto: LogFeatureUsageDto,
  ) {
    const userId = user?.userId || user?._id;
    if (!userId) throw new UnauthorizedException();
    const success = await this.featureUsageService.log(
      userId,
      dto.feature,
      dto.action,
      dto.metadata ?? {},
    );
    return { success };
  }

  @Get('feature-usage/summary')
  async featureUsageSummary(
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    const fromDate = from ? new Date(from) : undefined;
    const toDate = to ? new Date(to) : undefined;
    const rows = await this.featureUsageService.summary(
      fromDate && !isNaN(fromDate.getTime()) ? fromDate : undefined,
      toDate && !isNaN(toDate.getTime()) ? toDate : undefined,
    );
    return { success: true, rows };
  }
}
