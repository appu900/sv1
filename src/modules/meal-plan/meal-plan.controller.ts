import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Request,
  UseGuards,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiParam,
  ApiBody,
  ApiOkResponse,
  ApiCreatedResponse,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/role.decorators';
import {
  RequireFeature,
  SubscriptionGuard,
} from '../subscription/subscription.guard';
import { ApiSubscription } from '../../common/swagger/api-auth.decorators';
import { MealPlanService } from './meal-plan.service';
import {
  GenerateMealPlanDto,
  GenerateRecipeFromPlanDto,
  MarkPlanRecipeDto,
} from './dto/meal-plan.dto';

@ApiTags('Meal Plan')
@ApiSubscription()
@Controller('meal-plan')
@UseGuards(JwtAuthGuard, RolesGuard, SubscriptionGuard)
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
  @RequireFeature('smart_meal_planning')
  @ApiOperation({
    summary: 'Generate an AI meal plan',
    description:
      'Creates a new AI meal plan for the subscriber and archives any previous active plan. Optional `days` (1–14) and `preference` text steer the generator. Requires the `smart_meal_planning` feature.',
  })
  @ApiBody({ type: GenerateMealPlanDto })
  @ApiCreatedResponse({ description: 'New meal plan generated.' })
  async generate(@Request() req, @Body() dto: GenerateMealPlanDto) {
    const userId = this.resolveUserId(req);
    const plan = await this.mealPlanService.generate(userId, dto);
    return { success: true, data: plan };
  }

  /** Get the current active meal plan */
  @Get('active')
  @ApiOperation({
    summary: 'Get the active meal plan',
    description:
      'Returns the subscriber’s current active meal plan, or `data: null` when none is active.',
  })
  @ApiOkResponse({ description: 'Active plan or null.' })
  async getActive(@Request() req) {
    const userId = this.resolveUserId(req);
    const plan = await this.mealPlanService.getActivePlan(userId);
    return { success: true, data: plan ?? null };
  }

  /** Get plan history (last 10 plans) */
  @Get('history')
  @ApiOperation({
    summary: 'Get meal-plan history',
    description:
      'Returns the last 10 meal plans for the subscriber, including archived and completed plans.',
  })
  @ApiOkResponse({ description: 'Recent meal plans.' })
  async getHistory(@Request() req) {
    const userId = this.resolveUserId(req);
    const plans = await this.mealPlanService.getPlanHistory(userId);
    return { success: true, count: plans.length, data: plans };
  }

  /** Get a single plan by ID */
  @Get(':planId')
  @ApiOperation({
    summary: 'Get a meal plan by id',
    description:
      'Returns one meal plan owned by the subscriber. Unknown or foreign ids fail with not-found.',
  })
  @ApiParam({ name: 'planId', description: 'Meal plan ObjectId.' })
  @ApiOkResponse({ description: 'Meal plan document.' })
  async getById(@Request() req, @Param('planId') planId: string) {
    const userId = this.resolveUserId(req);
    const plan = await this.mealPlanService.getPlanById(userId, planId);
    return { success: true, data: plan };
  }

  /** Archive / dismiss a plan */
  @Delete(':planId')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Archive a meal plan',
    description:
      'Archives (dismisses) a meal plan owned by the subscriber. The plan remains in history.',
  })
  @ApiParam({ name: 'planId', description: 'Meal plan ObjectId.' })
  @ApiOkResponse({ description: 'Plan archived.' })
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
  @RequireFeature('recipe_conversions')
  @ApiOperation({
    summary: 'Generate a cookbook recipe from a planned meal',
    description:
      'Converts a specific day/slot in the plan into a pending cookbook recipe. Requires the `recipe_conversions` feature. Returns a pending recipe id that will appear in the cookbook when generation finishes.',
  })
  @ApiBody({ type: GenerateRecipeFromPlanDto })
  @ApiCreatedResponse({ description: 'Recipe generation started.' })
  async generateRecipe(@Request() req, @Body() dto: GenerateRecipeFromPlanDto) {
    const userId = this.resolveUserId(req);
    const result = await this.mealPlanService.generateRecipeFromMeal(userId, dto);
    return { success: true, data: result };
  }

  /** Transition plan to STARTED (idempotent) */
  @Post(':planId/start')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Start a meal plan',
    description:
      'Transitions the plan to STARTED. Idempotent — calling again on an already-started plan returns the current plan.',
  })
  @ApiParam({ name: 'planId', description: 'Meal plan ObjectId.' })
  @ApiOkResponse({ description: 'Plan marked started.' })
  async start(@Request() req, @Param('planId') planId: string) {
    const userId = this.resolveUserId(req);
    const plan = await this.mealPlanService.startPlan(userId, planId);
    return { success: true, data: plan };
  }

  /** Transition plan to COMPLETED (idempotent) */
  @Post(':planId/complete')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Complete a meal plan',
    description:
      'Transitions the plan to COMPLETED. Idempotent — calling again on an already-completed plan returns the current plan.',
  })
  @ApiParam({ name: 'planId', description: 'Meal plan ObjectId.' })
  @ApiOkResponse({ description: 'Plan marked completed.' })
  async complete(@Request() req, @Param('planId') planId: string) {
    const userId = this.resolveUserId(req);
    const plan = await this.mealPlanService.completePlan(userId, planId);
    return { success: true, data: plan };
  }

  /** Mark a meal in the plan as cooked / swapped */
  @Patch(':planId/recipes')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Mark a planned meal as cooked or swapped',
    description:
      'Updates one meal slot on the plan: mark cooked, mark swapped, and/or attach a replacement `recipeId`. Identify the slot with `dayIndex` and `mealSlot`.',
  })
  @ApiParam({ name: 'planId', description: 'Meal plan ObjectId.' })
  @ApiBody({ type: MarkPlanRecipeDto })
  @ApiOkResponse({ description: 'Updated meal plan.' })
  async markRecipe(
    @Request() req,
    @Param('planId') planId: string,
    @Body() dto: MarkPlanRecipeDto,
  ) {
    const userId = this.resolveUserId(req);
    const plan = await this.mealPlanService.markPlanRecipe(userId, planId, dto);
    return { success: true, data: plan };
  }
}
