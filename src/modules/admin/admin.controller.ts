import {
  Controller,
  Post,
  Get,
  Delete,
  Body,
  Param,
  UseGuards,
} from '@nestjs/common';
import { AdminService } from './admin.service';
import { CreateChefDto } from './dto/create-chef.dto';
import { JwtAuthGuard } from 'src/common/guards/jwt-auth.guard';
import { RolesGuard } from 'src/common/guards/roles.guard';
import { Roles } from 'src/common/decorators/role.decorators';
import { UserRole } from 'src/database/schemas/user.auth.schema';

@Controller('admin')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN)
export class AdminController {
  constructor(private readonly adminService: AdminService) {}

  // Chef management endpoints
  @Get('chefs')
  async getAllChefs() {
    return this.adminService.getAllChefs();
  }

  @Get('chefs/:id')
  async getChefById(@Param('id') id: string) {
    return this.adminService.getChefById(id);
  }

  @Delete('chefs/:id')
  async deleteChef(@Param('id') id: string) {
    return this.adminService.deleteChef(id);
  }

  // User management endpoints
  @Get('users')
  async getAllUsers() {
    return this.adminService.getAllUsers();
  }

  @Get('users/:id')
  async getUserById(@Param('id') id: string) {
    return this.adminService.getUserById(id);
  }

  @Delete('users/:id')
  async deleteUser(@Param('id') id: string) {
    return this.adminService.deleteUser(id);
  }

  // Stats endpoint
  @Get('stats')
  async getStats() {
    return this.adminService.getStats();
  }

  // Dashboard endpoints
  @Get('dashboard/stats')
  async getDashboardStats() {
    return this.adminService.getDashboardStats();
  }

  @Get('dashboard/health')
  async getPlatformHealth() {
    return this.adminService.getPlatformHealth();
  }

  @Get('dashboard/user-growth')
  async getUserGrowth() {
    return this.adminService.getUserGrowth();
  }

  @Get('dashboard/activity')
  async getActivityLog() {
    return this.adminService.getActivityLog();
  }
}
