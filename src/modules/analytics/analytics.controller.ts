import { Body, Controller, Get, Post, UnauthorizedException, UseGuards } from '@nestjs/common';
import { AnalyticsService } from './analytics.service';
import { RolesGuard } from 'src/common/guards/roles.guard';
import { JwtAuthGuard } from 'src/common/guards/jwt-auth.guard';
import { GetUser } from 'src/common/decorators/Get.user.decorator';
import { SaveFoodDto } from './dto/savefood.dto';

@Controller('analytics')
export class AnalyticsController {
  constructor(private readonly analyticsService: AnalyticsService) {}

  @Post('')
  @UseGuards(JwtAuthGuard, RolesGuard)
  async saveFood(@Body() dto: SaveFoodDto, @GetUser() user: any) {
    const userId = user.userId;
    console.log("this is request body",dto)
    return this.analyticsService.saveFood(userId, dto.ingredinatsIds, dto.frameworkId);
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
  async getTrending(@GetUser() user: any) {
    // Trending is global; user context used to auth only
    return this.analyticsService.getTrendingRecipes(5);
  }
}
