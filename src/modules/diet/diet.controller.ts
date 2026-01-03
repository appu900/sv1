import { Controller, Body, Post, Get, UseGuards } from '@nestjs/common';
import { DietService } from './diet.service';
import { CreateDietDto } from './dto/create.diet.dto';
import { JwtAuthGuard } from 'src/common/guards/jwt-auth.guard';
import { RolesGuard } from 'src/common/guards/roles.guard';
import { Roles } from 'src/common/decorators/role.decorators';
import { UserRole } from 'src/database/schemas/user.auth.schema';

@Controller('diet')
export class DietController {
  constructor(private readonly dietService: DietService) {}

  @Post('')
  @Roles(UserRole.ADMIN, UserRole.CHEF)
  @UseGuards(JwtAuthGuard, RolesGuard)
  async create(@Body() dto: CreateDietDto) {
    return this.dietService.create(dto);
  }

  @Get('')
  async getAll() {
    return this.dietService.getAll();
  }
}
