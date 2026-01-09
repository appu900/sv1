import { Body, Controller, Post, UseGuards } from '@nestjs/common';
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
    return this.analyticsService.saveFood(userId, dto.ingredinatsIds);
  }
}
