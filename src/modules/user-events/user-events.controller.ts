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
import {
  ApiTags,
  ApiOperation,
  ApiQuery,
  ApiBody,
  ApiOkResponse,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { GetUser } from '../../common/decorators/Get.user.decorator';
import { ApiJwtAuth } from '../../common/swagger/api-auth.decorators';
import { UserEventService } from './user-event.service';
import { RecipeViewService } from './recipe-view.service';
import { FeatureUsageService } from './feature-usage.service';
import { RecordRecipeViewDto, RecordUserEventDto } from './dto/user-event.dto';
import { LogFeatureUsageDto } from './dto/feature-usage.dto';
import { RecipeViewSource } from '../../database/schemas/recipe-view.schema';

@ApiTags('User Events')
@ApiJwtAuth()
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
  @ApiOperation({
    summary: 'Record a first-occurrence user event',
    description:
      'Records a named product event for the authenticated user. Only the first occurrence of each `eventType` is stored; later calls return `firstOccurrence: false`. Optional `metadata` is kept on the first write.',
  })
  @ApiBody({ type: RecordUserEventDto })
  @ApiOkResponse({ description: 'Event recorded or already present.' })
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
  @ApiOperation({
    summary: 'List the current user’s events',
    description:
      'Returns every first-occurrence event recorded for the authenticated user (onboarding funnel, feature unlocks, etc.).',
  })
  @ApiOkResponse({ description: 'User event list.' })
  async list(@GetUser() user: any) {
    const userId = user?.userId || user?._id;
    if (!userId) throw new UnauthorizedException();
    const events = await this.userEventService.getEventsForUser(userId);
    return { success: true, events };
  }

  @Get('user-events/funnel')
  @ApiOperation({
    summary: 'Get funnel counts',
    description:
      'Returns aggregate first-occurrence counts per event type across all users. Used for conversion-funnel dashboards. Still requires a JWT because the controller is JWT-guarded.',
  })
  @ApiOkResponse({ description: 'Funnel counts by event type.' })
  async funnel() {
    return this.userEventService.funnelCounts();
  }

  @Post('recipe-views')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Record a recipe view',
    description:
      'Increments the authenticated user’s view for a recipe. `source` defaults to `OTHER` when omitted (home, search, inventory suggestions, etc.).',
  })
  @ApiBody({ type: RecordRecipeViewDto })
  @ApiOkResponse({ description: 'View recorded.' })
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
  @ApiOperation({
    summary: 'Log a feature-usage event',
    description:
      'Records that the authenticated user performed an `action` on a named `feature`, with optional `metadata`. Used for product analytics, not first-occurrence events.',
  })
  @ApiBody({ type: LogFeatureUsageDto })
  @ApiOkResponse({ description: 'Usage logged.' })
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
  @ApiOperation({
    summary: 'Get feature-usage summary',
    description:
      'Aggregated feature-usage counts. Optional `from` and `to` are ISO date-times that bound the window; invalid dates are ignored and the query becomes unbounded on that side.',
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
  @ApiOkResponse({ description: 'Feature-usage summary rows.' })
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
