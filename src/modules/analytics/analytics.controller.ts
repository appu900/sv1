import { Body, Controller, Delete, Get, Patch, Post, Query, UnauthorizedException, UseGuards } from '@nestjs/common';
import { AnalyticsService } from './analytics.service';
import { MetricsService } from './metrics.service';
import { RolesGuard } from 'src/common/guards/roles.guard';
import { JwtAuthGuard } from 'src/common/guards/jwt-auth.guard';
import { GetUser } from 'src/common/decorators/Get.user.decorator';
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

@Controller('analytics')
export class AnalyticsController {
  constructor(
    private readonly analyticsService: AnalyticsService,
    private readonly metricsService: MetricsService,
  ) {}

  @Post('')
  @UseGuards(JwtAuthGuard, RolesGuard)
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
  async getCookedRecipes(@GetUser() user: any) {
    const userId = user.userId;
    if (!userId) throw new UnauthorizedException();
    return this.analyticsService.getUserCookedRecipes(userId);
  }

  @Get('cooked-recipes/details')
  @UseGuards(JwtAuthGuard, RolesGuard)
  async getCookedRecipesDetails(@GetUser() user: any) {
    const userId = user.userId;
    if (!userId) throw new UnauthorizedException();
    return this.analyticsService.getUserCookedRecipesDetails(userId);
  }

  @Get('stats')
  @UseGuards(JwtAuthGuard, RolesGuard)
  async getStats(@GetUser() user: any) {
    const userId = user.userId;
    if (!userId) throw new UnauthorizedException();
    return this.analyticsService.getStats(userId);
  }

  @Get('trending')
  @UseGuards(JwtAuthGuard, RolesGuard)
  async getTrending(@GetUser() user: any, @Query('country') country?: string) {
    return this.analyticsService.getTrendingRecipes(5, country);
  }

  @Get('leaderboard')
  @UseGuards(JwtAuthGuard, RolesGuard)
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
  async getLeaderboardStats() {
    return this.analyticsService.getLeaderboardStats();
  }

  @Get('leaderboard/my-profile')
  @UseGuards(JwtAuthGuard, RolesGuard)
  async getMyLeaderboardProfile(@GetUser() user: any) {
    const userId = user.userId;
    if (!userId) throw new UnauthorizedException();
    return this.analyticsService.getLeaderboardProfile(userId);
  }

  @Post('leaderboard/join')
  @UseGuards(JwtAuthGuard, RolesGuard)
  async joinLeaderboard(@Body() dto: JoinLeaderboardDto, @GetUser() user: any) {
    const userId = user.userId;
    if (!userId) throw new UnauthorizedException();
    return this.analyticsService.joinLeaderboard(userId, dto.displayName);
  }

  @Patch('leaderboard/update-profile')
  @UseGuards(JwtAuthGuard, RolesGuard)
  async updateLeaderboardProfile(@Body() dto: UpdateLeaderboardProfileDto, @GetUser() user: any) {
    const userId = user.userId;
    if (!userId) throw new UnauthorizedException();
    return this.analyticsService.updateLeaderboardProfile(userId, dto);
  }

  @Delete('leaderboard/leave')
  @UseGuards(JwtAuthGuard, RolesGuard)
  async leaveLeaderboard(@GetUser() user: any) {
    const userId = user.userId;
    if (!userId) throw new UnauthorizedException();
    return this.analyticsService.leaveLeaderboard(userId);
  }

  @Get('recipe-rating-stats')
  @UseGuards(JwtAuthGuard, RolesGuard)
  async getRecipeRatingStats(@Query('framework_id') frameworkId: string) {
    return this.analyticsService.getRecipeRatingStats(frameworkId);
  }

  @Get('recipe-rating-stats-batch')
  @UseGuards(JwtAuthGuard, RolesGuard)
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
  async logClientEventsBatch(
    @Body() dto: LogClientEventsBatchDto,
    @GetUser() user: any,
  ) {
    const userId = user?.userId ?? null;
    const result = await this.metricsService.logClientEvents(userId, dto.events ?? []);
    return { success: true, ...result };
  }
}
