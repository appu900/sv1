import {
  Controller,
  Post,
  Get,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiOkResponse,
} from '@nestjs/swagger';
import { AdminService } from './admin.service';
import { CreateChefDto } from './dto/create-chef.dto';
import { JwtAuthGuard } from 'src/common/guards/jwt-auth.guard';
import { RolesGuard } from 'src/common/guards/roles.guard';
import { Roles } from 'src/common/decorators/role.decorators';
import { UserRole } from 'src/database/schemas/user.auth.schema';
import { ApiJwtRoles } from 'src/common/swagger/api-auth.decorators';

@ApiTags('Admin')
@ApiJwtRoles('Admin role required.')
@Controller('admin')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN)
export class AdminController {
  constructor(private readonly adminService: AdminService) {}

  // Chef management endpoints
  @Get('chefs')
  @ApiOperation({
    summary: 'List all chefs',
    description:
      'Admin JWT. Returns every chef-role account (password hashes omitted): id, email, name, role, timestamps.',
  })
  @ApiOkResponse({ description: '`{ chefs: [...] }` — all chef accounts.' })
  async getAllChefs() {
    return this.adminService.getAllChefs();
  }

  @Get('chefs/:id')
  @ApiOperation({
    summary: 'Get chef by id',
    description:
      'Admin JWT. Path `:id` is the chef user ObjectId. Returns that chef’s public fields or 404 if missing / not a chef.',
  })
  @ApiParam({ name: 'id', description: 'Chef user ObjectId.' })
  @ApiOkResponse({ description: 'Single chef object (no password hash).' })
  async getChefById(@Param('id') id: string) {
    return this.adminService.getChefById(id);
  }

  @Delete('chefs/:id')
  @ApiOperation({
    summary: 'Delete chef',
    description:
      'Admin JWT. Permanently deletes the chef user identified by `:id`. Use with care; this is not a soft delete.',
  })
  @ApiParam({ name: 'id', description: 'Chef user ObjectId to delete.' })
  @ApiOkResponse({ description: 'Deletion result from AdminService.deleteChef.' })
  async deleteChef(@Param('id') id: string) {
    return this.adminService.deleteChef(id);
  }

  // User management endpoints
  @Get('users')
  @ApiOperation({
    summary: 'List users (paginated)',
    description:
      'Admin JWT. Paginated USER-role accounts with dietary/onboarding summaries, Qantas FFN, and survey counts. Filter with `name` and `country` (case-insensitive substring). `page` defaults to 1 and `limit` to 20.',
  })
  @ApiQuery({
    name: 'name',
    required: false,
    description: 'Case-insensitive name substring filter.',
  })
  @ApiQuery({
    name: 'country',
    required: false,
    description: 'Case-insensitive country substring filter.',
  })
  @ApiQuery({
    name: 'page',
    required: false,
    description: '1-based page number. Defaults to 1.',
  })
  @ApiQuery({
    name: 'limit',
    required: false,
    description: 'Page size. Defaults to 20.',
  })
  @ApiOkResponse({
    description:
      '`{ total, page, limit, totalPages, users }` where each user includes dietaryProfile, onboarding, qantasFFN, and `_count`.',
  })
  async getAllUsers(
    @Query('name') name?: string,
    @Query('country') country?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.adminService.getAllUsers({ name, country, page: page ? parseInt(page) : 1, limit: limit ? parseInt(limit) : 20 });
  }

  @Get('users/:id')
  @ApiOperation({
    summary: 'Get user by id',
    description:
      'Admin JWT. Path `:id` is the user ObjectId. Returns that user’s admin detail view (profile, dietary, related counts).',
  })
  @ApiParam({ name: 'id', description: 'User ObjectId.' })
  @ApiOkResponse({ description: 'Single user admin detail object.' })
  async getUserById(@Param('id') id: string) {
    return this.adminService.getUserById(id);
  }

  @Delete('users/:id')
  @ApiOperation({
    summary: 'Delete user',
    description:
      'Admin JWT. Permanently deletes the USER-role account identified by `:id`. Irreversible.',
  })
  @ApiParam({ name: 'id', description: 'User ObjectId to delete.' })
  @ApiOkResponse({ description: 'Deletion result from AdminService.deleteUser.' })
  async deleteUser(@Param('id') id: string) {
    return this.adminService.deleteUser(id);
  }

  // Stats endpoint
  @Get('stats')
  @ApiOperation({
    summary: 'Platform user/chef stats',
    description:
      'Admin JWT. Counts of users and chefs plus dietary-profile and onboarding completion rates. Lighter than dashboard/stats.',
  })
  @ApiOkResponse({
    description:
      '`{ totalUsers, totalChefs, usersWithDietaryProfile, dietaryProfileCompletionRate, usersWithOnboarding, onboardingCompletionRate }`.',
  })
  async getStats() {
    return this.adminService.getStats();
  }

  // Dashboard endpoints
  @Get('dashboard/stats')
  @ApiOperation({
    summary: 'Dashboard overview stats',
    description:
      'Admin JWT. Broader CMS dashboard payload: content counts (ingredients, hacks, sponsors, food facts, stickers), completion rates, last-five users/chefs, and 7-day growth.',
  })
  @ApiOkResponse({
    description:
      'Dashboard totals, recent users/chefs, userGrowth, and chefGrowth.',
  })
  async getDashboardStats() {
    return this.adminService.getDashboardStats();
  }

  @Get('dashboard/health')
  @ApiOperation({
    summary: 'Platform health snapshot',
    description:
      'Admin JWT. Returns a simple health score from 7-day active users vs total users, plus placeholder uptime/load fields for the admin dashboard.',
  })
  @ApiOkResponse({
    description:
      '`{ score, uptime, responseTime, activeUsers, serverLoad }`.',
  })
  async getPlatformHealth() {
    return this.adminService.getPlatformHealth();
  }

  @Get('dashboard/user-growth')
  @ApiOperation({
    summary: 'User growth (7 days)',
    description:
      'Admin JWT. Returns `{ growth }` — daily USER-role signup counts for the last 7 days.',
  })
  @ApiOkResponse({ description: '`{ growth }` array/object for the last 7 days.' })
  async getUserGrowth() {
    return this.adminService.getUserGrowth();
  }

  @Get('dashboard/activity')
  @ApiOperation({
    summary: 'Recent activity log',
    description:
      'Admin JWT. Combined feed of recent user and chef signups for the admin activity panel.',
  })
  @ApiOkResponse({ description: 'Activity entries derived from recent user and chef creates.' })
  async getActivityLog() {
    return this.adminService.getActivityLog();
  }
}
