import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Delete,
  UseGuards,
  UnauthorizedException,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiParam,
  ApiBody,
  ApiOkResponse,
  ApiCreatedResponse,
} from '@nestjs/swagger';
import { FeedbackService } from './feedback.service';
import { CreateFeedbackDto } from './dto/create-feedback.dto';
import { UpdateFeedbackDto } from './dto/update-feedback.dto';
import { JwtAuthGuard } from 'src/common/guards/jwt-auth.guard';
import { RolesGuard } from 'src/common/guards/roles.guard';
import { Roles } from 'src/common/decorators/role.decorators';
import { UserRole } from 'src/database/schemas/user.auth.schema';
import { GetUser } from 'src/common/decorators/Get.user.decorator';
import { ApiJwtRoles } from 'src/common/swagger/api-auth.decorators';

@ApiTags('Feedback')
@Controller('feedback')
export class FeedbackController {
  constructor(private readonly feedbackService: FeedbackService) {}

  @Post()
  @Roles(UserRole.USER, UserRole.ADMIN)
  @UseGuards(JwtAuthGuard, RolesGuard)
  @ApiJwtRoles('Requires user or admin role.')
  @ApiOperation({
    summary: 'Submit recipe feedback',
    description:
      'Creates a feedback / rating document for a recipe from the authenticated user (or admin acting as themselves).',
  })
  @ApiBody({ type: CreateFeedbackDto })
  @ApiCreatedResponse({ description: 'Feedback created.' })
  create(@Body() createFeedbackDto: CreateFeedbackDto, @GetUser() user: any) {
    const userId = user.userId;
    if (!userId) throw new UnauthorizedException();
    return this.feedbackService.create(userId, createFeedbackDto);
  }

  @Get()
  @Roles(UserRole.USER, UserRole.ADMIN)
  @UseGuards(JwtAuthGuard, RolesGuard)
  @ApiJwtRoles('Requires user or admin role.')
  @ApiOperation({
    summary: 'List the current user’s feedback',
    description:
      'Returns every feedback document written by the authenticated user.',
  })
  @ApiOkResponse({ description: 'User feedback list.' })
  findAll(@GetUser() user: any) {
    const userId = user.userId;
    if (!userId) throw new UnauthorizedException();
    return this.feedbackService.findAll(userId);
  }

  @Get('stats')
  @Roles(UserRole.USER, UserRole.ADMIN)
  @UseGuards(JwtAuthGuard, RolesGuard)
  @ApiJwtRoles('Requires user or admin role.')
  @ApiOperation({
    summary: 'Get the current user’s feedback stats',
    description:
      'Returns counts and averages for feedback the authenticated user has submitted.',
  })
  @ApiOkResponse({ description: 'User feedback statistics.' })
  getStats(@GetUser() user: any) {
    const userId = user.userId;
    if (!userId) throw new UnauthorizedException();
    return this.feedbackService.getStats(userId);
  }

  // Admin endpoints - MUST come before :id route
  @Get('admin/all')
  @Roles(UserRole.ADMIN)
  @UseGuards(JwtAuthGuard, RolesGuard)
  @ApiJwtRoles('Requires admin role.')
  @ApiOperation({
    summary: 'List all feedback (admin)',
    description:
      'Admin-only. Returns every feedback document with user and recipe details for moderation.',
  })
  @ApiOkResponse({ description: 'All feedback with details.' })
  async getAllFeedbacksAdmin() {
    return this.feedbackService.getAllFeedbacksWithDetails();
  }

  @Get('admin/recipe/:recipeId')
  @Roles(UserRole.ADMIN)
  @UseGuards(JwtAuthGuard, RolesGuard)
  @ApiJwtRoles('Requires admin role.')
  @ApiOperation({
    summary: 'List feedback for a recipe (admin)',
    description:
      'Admin-only. Returns all feedback documents attached to the given recipe id.',
  })
  @ApiParam({ name: 'recipeId', description: 'Recipe / framework id.' })
  @ApiOkResponse({ description: 'Feedback for the recipe.' })
  async getFeedbacksByRecipeAdmin(@Param('recipeId') recipeId: string) {
    return this.feedbackService.getFeedbacksByRecipe(recipeId);
  }

  @Get('admin/stats')
  @Roles(UserRole.ADMIN)
  @UseGuards(JwtAuthGuard, RolesGuard)
  @ApiJwtRoles('Requires admin role.')
  @ApiOperation({
    summary: 'Get global feedback stats (admin)',
    description:
      'Admin-only. Returns platform-wide feedback counts, averages, and moderation totals.',
  })
  @ApiOkResponse({ description: 'Global feedback statistics.' })
  async getFeedbackStatsAdmin() {
    return this.feedbackService.getAdminStats();
  }

  @Delete('admin/:id')
  @Roles(UserRole.ADMIN)
  @UseGuards(JwtAuthGuard, RolesGuard)
  @ApiJwtRoles('Requires admin role.')
  @ApiOperation({
    summary: 'Delete any feedback (admin)',
    description:
      'Admin-only. Permanently deletes a feedback document regardless of who wrote it.',
  })
  @ApiParam({ name: 'id', description: 'Feedback document id.' })
  @ApiOkResponse({ description: 'Feedback deleted.' })
  async removeAdmin(@Param('id') id: string) {
    return this.feedbackService.adminDelete(id);
  }

  @Get(':id')
  @Roles(UserRole.USER, UserRole.ADMIN)
  @UseGuards(JwtAuthGuard, RolesGuard)
  @ApiJwtRoles('Requires user or admin role.')
  @ApiOperation({
    summary: 'Get one of the current user’s feedback items',
    description:
      'Returns a single feedback document if it belongs to the authenticated user.',
  })
  @ApiParam({ name: 'id', description: 'Feedback document id.' })
  @ApiOkResponse({ description: 'Feedback document.' })
  findOne(@Param('id') id: string, @GetUser() user: any) {
    const userId = user.userId;
    if (!userId) throw new UnauthorizedException();
    return this.feedbackService.findOne(id, userId);
  }

  @Post(':id/update')
  @Roles(UserRole.USER, UserRole.ADMIN)
  @UseGuards(JwtAuthGuard, RolesGuard)
  @ApiJwtRoles('Requires user or admin role.')
  @ApiOperation({
    summary: 'Update the current user’s feedback',
    description:
      'Updates rating or comment on a feedback document owned by the authenticated user.',
  })
  @ApiParam({ name: 'id', description: 'Feedback document id.' })
  @ApiBody({ type: UpdateFeedbackDto })
  @ApiOkResponse({ description: 'Feedback updated.' })
  update(
    @Param('id') id: string,
    @Body() updateFeedbackDto: UpdateFeedbackDto,
    @GetUser() user: any,
  ) {
    const userId = user.userId;
    if (!userId) throw new UnauthorizedException();
    return this.feedbackService.update(id, userId, updateFeedbackDto);
  }

  @Delete(':id')
  @Roles(UserRole.USER, UserRole.ADMIN)
  @UseGuards(JwtAuthGuard, RolesGuard)
  @ApiJwtRoles('Requires user or admin role.')
  @ApiOperation({
    summary: 'Delete the current user’s feedback',
    description:
      'Deletes a feedback document owned by the authenticated user.',
  })
  @ApiParam({ name: 'id', description: 'Feedback document id.' })
  @ApiOkResponse({ description: 'Feedback deleted.' })
  remove(@Param('id') id: string, @GetUser() user: any) {
    const userId = user.userId;
    if (!userId) throw new UnauthorizedException();
    return this.feedbackService.delete(id, userId);
  }
}
