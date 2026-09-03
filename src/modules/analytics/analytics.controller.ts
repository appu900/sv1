import { Body, Controller, Delete, Get, Patch, Post, Query, UnauthorizedException, UseGuards } from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiQuery,
  ApiBody,
  ApiOkResponse,
  ApiCreatedResponse,
} from '@nestjs/swagger';
import { AnalyticsService } from './analytics.service';
import { MetricsService } from './metrics.service';
import { RolesGuard } from 'src/common/guards/roles.guard';
import { JwtAuthGuard } from 'src/common/guards/jwt-auth.guard';
import { GetUser } from 'src/common/decorators/Get.user.decorator';
import { ApiJwtRoles } from 'src/common/swagger/api-auth.decorators';
import { SaveFoodDto } from './dto/savefood.dto';
import { GetLeaderboardDto } from './dto/leaderboard.dto';
import { JoinLeaderboardDto, UpdateLeaderboardProfileDto } from './dto/leaderboard-profile.dto';
import {
  LogClientEventDto,
  LogClientEventsBatchDto,
  LogIngredientSearchDto,
  MetricsQueryDto,
  MetricsWindow,
  MostCookedQueryDto,
  MostSearchedQueryDto,
} from './dto/metrics.dto';

@ApiTags('Analytics')
@ApiJwtRoles()
@Controller('analytics')
export class AnalyticsController {
  constructor(
    private readonly analyticsService: AnalyticsService,
    private readonly metricsService: MetricsService,
  ) {}

  @Post('')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @ApiOperation({
    summary: 'Record a cooked meal',
    description:
      'Logs that the authenticated user cooked a recipe. Pass ingredient IDs, the framework/recipe id, optional ingredient details, and an optional idempotency key so retries do not double-count impact.',
  })
  @ApiBody({ type: SaveFoodDto })
  @ApiCreatedResponse({ description: 'Cooked-meal event saved.' })
  async saveFood(@Body() dto: SaveFoodDto, @GetUser() user: any) {
    try {
      const userId = user.userId;
      const result = await this.analyticsService.saveFood(
        userId,
        dto.ingredinatsIds,
        dto.frameworkId,
        dto.ingredients,
        dto.idempotencyKey,
      );
      return result;
    } catch (error) {
      throw error;
    }
  }

  @Get('cooked-recipes')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @ApiOperation({
    summary: 'List cooked recipe ids',
    description:
      'Returns the authenticated user’s cooked-recipe identifiers used by the app to mark recipes as cooked.',
  })
  @ApiOkResponse({ description: 'Cooked recipe identifiers.' })
  async getCookedRecipes(@GetUser() user: any) {
    const userId = user.userId;
    if (!userId) throw new UnauthorizedException();
    return this.analyticsService.getUserCookedRecipes(userId);
  }

  @Get('cooked-recipes/details')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @ApiOperation({
    summary: 'List cooked recipes with details',
    description:
      'Same cooked history as `/cooked-recipes`, expanded with recipe titles and metadata for profile / history screens.',
  })
  @ApiOkResponse({ description: 'Cooked recipes with display details.' })
  async getCookedRecipesDetails(@GetUser() user: any) {
    const userId = user.userId;
    if (!userId) throw new UnauthorizedException();
    return this.analyticsService.getUserCookedRecipesDetails(userId);
  }

  @Get('stats')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @ApiOperation({
    summary: 'Get personal impact stats',
    description:
      'Returns the authenticated user’s food-saved, money-saved, and CO₂ impact totals used on the home and impact screens.',
  })
  @ApiOkResponse({ description: 'User impact statistics.' })
  async getStats(@GetUser() user: any) {
    const userId = user.userId;
    if (!userId) throw new UnauthorizedException();
    return this.analyticsService.getStats(userId);
  }

  @Get('trending')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @ApiOperation({
    summary: 'Get trending recipes',
    description:
      'Returns the top 5 trending recipes, optionally filtered by country code so regional popularity is respected.',
  })
  @ApiQuery({
    name: 'country',
    required: false,
    description: 'ISO country code used to scope trending recipes.',
  })
  @ApiOkResponse({ description: 'Trending recipe list.' })
  async getTrending(@GetUser() user: any, @Query('country') country?: string) {
    return this.analyticsService.getTrendingRecipes(5, country);
  }

  @Get('leaderboard')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @ApiOperation({
    summary: 'Get the public leaderboard',
    description:
      'Paged leaderboard of opted-in users. Filter by period (`ALL_TIME`, `YEARLY`, `MONTHLY`, `WEEKLY`, `DAILY`), metric (`MEALS_COOKED`, `FOOD_SAVED`, `MONEY_SAVED`, `CO2_SAVED`, `BADGES`, `BOTH`), country, and state.',
  })
  @ApiQuery({ name: 'period', required: false, description: 'Time window. Defaults to ALL_TIME.' })
  @ApiQuery({ name: 'metric', required: false, description: 'Ranking metric. Defaults to BOTH.' })
  @ApiQuery({ name: 'limit', required: false, description: 'Page size (1–100). Defaults to 20.' })
  @ApiQuery({ name: 'offset', required: false, description: 'Pagination offset. Defaults to 0.' })
  @ApiQuery({ name: 'country', required: false, description: 'Optional country filter.' })
  @ApiQuery({ name: 'stateCode', required: false, description: 'Optional state / region filter.' })
  @ApiOkResponse({ description: 'Leaderboard rows.' })
  async getLeaderboard(@Query() query: GetLeaderboardDto) {
    return this.analyticsService.getLeaderboard({
      period: query.period,
      metric: query.metric,
      limit: query.limit,
      offset: query.offset,
      country: query.country,
      stateCode: query.stateCode,
    });
  }

  @Get('leaderboard/my-rank')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @ApiOperation({
    summary: 'Get the current user’s leaderboard rank',
    description:
      'Returns the authenticated user’s rank and score for the requested period and metric. The user must have joined the leaderboard.',
  })
  @ApiQuery({ name: 'period', required: false, description: 'Time window. Defaults to ALL_TIME.' })
  @ApiQuery({ name: 'metric', required: false, description: 'Ranking metric. Defaults to BOTH.' })
  @ApiOkResponse({ description: 'Current user rank payload.' })
  async getMyRank(@Query() query: GetLeaderboardDto, @GetUser() user: any) {
    const userId = user.userId;
    if (!userId) throw new UnauthorizedException();
    return this.analyticsService.getUserRank(userId, {
      period: query.period,
      metric: query.metric,
    });
  }

  @Get('leaderboard/stats')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @ApiOperation({
    summary: 'Get leaderboard aggregate stats',
    description:
      'Returns global leaderboard totals such as participant count and period metadata for the leaderboard screen header.',
  })
  @ApiOkResponse({ description: 'Leaderboard aggregate statistics.' })
  async getLeaderboardStats() {
    return this.analyticsService.getLeaderboardStats();
  }

  @Get('leaderboard/my-profile')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @ApiOperation({
    summary: 'Get the current user’s leaderboard profile',
    description:
      'Returns the authenticated user’s public leaderboard display name and opt-in status.',
  })
  @ApiOkResponse({ description: 'Leaderboard profile.' })
  async getMyLeaderboardProfile(@GetUser() user: any) {
    const userId = user.userId;
    if (!userId) throw new UnauthorizedException();
    return this.analyticsService.getLeaderboardProfile(userId);
  }

  @Post('leaderboard/join')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @ApiOperation({
    summary: 'Join the leaderboard',
    description:
      'Opts the authenticated user into the public leaderboard with a chosen display name.',
  })
  @ApiBody({ type: JoinLeaderboardDto })
  @ApiOkResponse({ description: 'User joined the leaderboard.' })
  async joinLeaderboard(@Body() dto: JoinLeaderboardDto, @GetUser() user: any) {
    const userId = user.userId;
    if (!userId) throw new UnauthorizedException();
    return this.analyticsService.joinLeaderboard(userId, dto.displayName);
  }

  @Patch('leaderboard/update-profile')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @ApiOperation({
    summary: 'Update leaderboard display profile',
    description:
      'Updates the authenticated user’s leaderboard display name or profile fields without leaving the board.',
  })
  @ApiBody({ type: UpdateLeaderboardProfileDto })
  @ApiOkResponse({ description: 'Leaderboard profile updated.' })
  async updateLeaderboardProfile(@Body() dto: UpdateLeaderboardProfileDto, @GetUser() user: any) {
    const userId = user.userId;
    if (!userId) throw new UnauthorizedException();
    return this.analyticsService.updateLeaderboardProfile(userId, dto);
  }

  @Delete('leaderboard/leave')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @ApiOperation({
    summary: 'Leave the leaderboard',
    description:
      'Opts the authenticated user out of the public leaderboard and removes their public rank.',
  })
  @ApiOkResponse({ description: 'User left the leaderboard.' })
  async leaveLeaderboard(@GetUser() user: any) {
    const userId = user.userId;
    if (!userId) throw new UnauthorizedException();
    return this.analyticsService.leaveLeaderboard(userId);
  }

  @Get('recipe-rating-stats')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @ApiOperation({
    summary: 'Get rating stats for one recipe',
    description:
      'Returns aggregated rating counts and averages for a single framework/recipe id.',
  })
  @ApiQuery({
    name: 'framework_id',
    required: true,
    description: 'Framework / recipe id to load rating stats for.',
  })
  @ApiOkResponse({ description: 'Recipe rating aggregates.' })
  async getRecipeRatingStats(@Query('framework_id') frameworkId: string) {
    return this.analyticsService.getRecipeRatingStats(frameworkId);
  }

  @Get('recipe-rating-stats-batch')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @ApiOperation({
    summary: 'Get rating stats for many recipes',
    description:
      'Batch variant of recipe rating stats. Pass a comma-separated list of framework ids in `ids`.',
  })
  @ApiQuery({
    name: 'ids',
    required: true,
    description: 'Comma-separated framework / recipe ids.',
  })
  @ApiOkResponse({ description: 'Map of recipe rating aggregates.' })
  async getRecipeRatingStatsBatch(@Query('ids') ids: string) {
    const frameworkIds = (ids || '')
      .split(',')
      .map(id => id.trim())
      .filter(Boolean);
    return this.analyticsService.getRecipeRatingStatsBatch(frameworkIds);
  }

  // ──────────────────── unit-impact metrics ────────────────────

  /**
   * Per-user impact metrics rolled up for week / month / year / all-time
   * in one round trip. Window query param narrows to a single window.
   */
  @Get('metrics')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @ApiOperation({
    summary: 'Get rolled-up impact metrics',
    description:
      'Returns per-user impact metrics for week, month, year, and all-time in one round trip. Pass `window` (`week` | `month` | `year` | `all`) to narrow to a single window. `tz` is an IANA timezone used for window boundaries.',
  })
  @ApiQuery({ name: 'window', required: false, description: 'Optional single window: week, month, year, or all.' })
  @ApiQuery({ name: 'tz', required: false, description: 'IANA timezone for window rollups (max 64 chars).' })
  @ApiOkResponse({ description: 'Impact metrics for one or all windows.' })
  async getMetrics(@Query() query: MetricsQueryDto, @GetUser() user: any) {
    const userId = user?.userId;
    if (!userId) throw new UnauthorizedException();
    if (query.window) {
      const row = await this.metricsService.getUserMetrics(userId, query.window, query.tz);
      return { success: true, data: row };
    }
    const rows = await this.metricsService.getImpactMetrics(userId, query.tz);
    return { success: true, data: rows };
  }

  @Get('most-cooked')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @ApiOperation({
    summary: 'Get most-cooked recipes',
    description:
      'Returns the most-cooked recipes for the current user (`scope=mine`, default) or globally (`scope=global`). Global scope does not require a user id. Optional `window`, `tz`, and `limit` (1–50) narrow the ranking.',
  })
  @ApiQuery({ name: 'window', required: false, description: 'week | month | year | all. Defaults to all.' })
  @ApiQuery({ name: 'scope', required: false, description: 'mine (default) or global.' })
  @ApiQuery({ name: 'tz', required: false, description: 'IANA timezone for the window.' })
  @ApiQuery({ name: 'limit', required: false, description: 'Max rows (1–50).' })
  @ApiOkResponse({ description: 'Most-cooked recipe rows.' })
  async getMostCooked(@Query() query: MostCookedQueryDto, @GetUser() user: any) {
    const userId = user?.userId;
    if (!userId && query.scope !== 'global') throw new UnauthorizedException();
    const rows = await this.metricsService.getMostCookedRecipes({
      userId,
      scope: query.scope,
      window: query.window ?? MetricsWindow.ALL,
      tz: query.tz,
      limit: query.limit,
    });
    return { success: true, rows };
  }

  @Get('most-searched')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @ApiOperation({
    summary: 'Get most-searched ingredients',
    description:
      'Returns the most-searched ingredients for the current user (`scope=mine`) or globally (`scope=global`). Global scope does not require a user id. Optional `window`, `tz`, and `limit` (1–50).',
  })
  @ApiQuery({ name: 'window', required: false, description: 'week | month | year | all. Defaults to all.' })
  @ApiQuery({ name: 'scope', required: false, description: 'mine (default) or global.' })
  @ApiQuery({ name: 'tz', required: false, description: 'IANA timezone for the window.' })
  @ApiQuery({ name: 'limit', required: false, description: 'Max rows (1–50).' })
  @ApiOkResponse({ description: 'Most-searched ingredient rows.' })
  async getMostSearched(@Query() query: MostSearchedQueryDto, @GetUser() user: any) {
    const userId = user?.userId;
    if (!userId && query.scope !== 'global') throw new UnauthorizedException();
    const rows = await this.metricsService.getMostSearchedIngredients({
      userId,
      scope: query.scope,
      window: query.window ?? MetricsWindow.ALL,
      tz: query.tz,
      limit: query.limit,
    });
    return { success: true, rows };
  }

  /**
   * Log an ingredient-search interaction. Either `ingredientId` (user picked
   * a concrete ingredient from the list) or `query` (free-text search) must
   * be provided. Both can be present when the user selects after typing.
   */
  @Post('ingredient-search')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @ApiOperation({
    summary: 'Log an ingredient search',
    description:
      'Records an ingredient-search interaction. Provide `ingredientId` when the user picked a catalog ingredient, `query` for free-text search, or both when they type then select. Optional `source` identifies the screen.',
  })
  @ApiBody({ type: LogIngredientSearchDto })
  @ApiOkResponse({ description: 'Search event accepted.' })
  async logIngredientSearch(
    @Body() dto: LogIngredientSearchDto,
    @GetUser() user: any,
  ) {
    const userId = user?.userId;
    if (!userId) throw new UnauthorizedException();
    await this.metricsService.logIngredientSearch({
      userId,
      ingredientId: dto.ingredientId,
      query: dto.query,
      source: dto.source,
    });
    return { success: true };
  }

  @Post('client-event')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @ApiOperation({
    summary: 'Log a single client analytics event',
    description:
      'Fire-and-forget client event (screen view, tap, etc.). The user id is taken from the JWT when present. Returns immediately; persistence is asynchronous.',
  })
  @ApiBody({ type: LogClientEventDto })
  @ApiOkResponse({ description: 'Event accepted.' })
  async logClientEvent(
    @Body() dto: LogClientEventDto,
    @GetUser() user: any,
  ) {
    const userId = user?.userId ?? null;
    void this.metricsService.logClientEvent({
      userId,
      event: dto.event,
      properties: dto.properties,
      route: dto.route,
      platform: dto.platform,
      appVersion: dto.appVersion,
      sessionId: dto.sessionId,
    });
    return { success: true };
  }

  @Post('client-events/batch')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @ApiOperation({
    summary: 'Log a batch of client analytics events',
    description:
      'Persists up to 50 client events in one request. Used by the app to flush a queued analytics buffer.',
  })
  @ApiBody({ type: LogClientEventsBatchDto })
  @ApiOkResponse({ description: 'Batch accepted with persist counts.' })
  async logClientEventsBatch(
    @Body() dto: LogClientEventsBatchDto,
    @GetUser() user: any,
  ) {
    const userId = user?.userId ?? null;
    const result = await this.metricsService.logClientEvents(userId, dto.events ?? []);
    return { success: true, ...result };
  }
}
