import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { GetUser } from '../../common/decorators/Get.user.decorator';
import { UserEventService } from './user-event.service';
import { RecipeViewService } from './recipe-view.service';
import { RecordRecipeViewDto, RecordUserEventDto } from './dto/user-event.dto';
import { RecipeViewSource } from '../../database/schemas/recipe-view.schema';

@Controller()
@UseGuards(JwtAuthGuard)
export class UserEventsController {
  constructor(
    private readonly userEventService: UserEventService,
    private readonly recipeViewService: RecipeViewService,
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
}
