import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Request,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/role.decorators';
import { MealPlanService } from './meal-plan.service';
import { GenerateMealPlanDto, GenerateRecipeFromPlanDto } from './dto/meal-plan.dto';

@Controller('meal-plan')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('USER')
export class MealPlanController {
  constructor(private readonly mealPlanService: MealPlanService) {}

  private resolveUserId(req: any): string {
    const id =
      req?.user?.userId ??
      req?.user?.id ??
      req?.user?._id ??
      req?.user?.sub ??
      '';
    return String(id);
  }

  /** Generate a new AI meal plan (archives the previous active plan) */
  @Post('generate')
  async generate(@Request() req, @Body() dto: GenerateMealPlanDto) {
    const userId = this.resolveUserId(req);
    const plan = await this.mealPlanService.generate(userId, dto);
    return { success: true, data: plan };
  }

  /** Get the current active meal plan */
  @Get('active')
  async getActive(@Request() req) {
    const userId = this.resolveUserId(req);
    const plan = await this.mealPlanService.getActivePlan(userId);
    return { success: true, data: plan ?? null };
  }

  /** Get plan history (last 10 plans) */
  @Get('history')
  async getHistory(@Request() req) {
    const userId = this.resolveUserId(req);
    const plans = await this.mealPlanService.getPlanHistory(userId);
    return { success: true, count: plans.length, data: plans };
  }

  /** Get a single plan by ID */
  @Get(':planId')
  async getById(@Request() req, @Param('planId') planId: string) {
    const userId = this.resolveUserId(req);
    const plan = await this.mealPlanService.getPlanById(userId, planId);
    return { success: true, data: plan };
  }

  /** Archive / dismiss a plan */
  @Delete(':planId')
  @HttpCode(HttpStatus.OK)
  async archive(@Request() req, @Param('planId') planId: string) {
    const userId = this.resolveUserId(req);
    await this.mealPlanService.archivePlan(userId, planId);
    return { success: true };
  }

  /**
   * Generate a cookbook recipe from a specific meal in the plan.
   * Returns a pending recipe ID that will appear in the cookbook.
   */
  @Post('generate-recipe')
  async generateRecipe(@Request() req, @Body() dto: GenerateRecipeFromPlanDto) {
    const userId = this.resolveUserId(req);
    const result = await this.mealPlanService.generateRecipeFromMeal(userId, dto);
    return { success: true, data: result };
  }
}
