import {
  Controller,
  Body,
  Get,
  Post,
  Patch,
  Delete,
  Param,
  UseGuards,
} from '@nestjs/common';
import { FoodFactService } from './food-fact.service';
import { Roles } from 'src/common/decorators/role.decorators';
import { UserRole } from 'src/database/schemas/user.auth.schema';
import { JwtAuthGuard } from 'src/common/guards/jwt-auth.guard';
import { RolesGuard } from 'src/common/guards/roles.guard';
import { CreateFoodFactDto } from './dto/create-food-fact.dto';
import { UpdateFoodFactDto } from './dto/update-food-fact.dto';

@Controller('food-facts')
export class FoodFactController {
  constructor(private readonly foodFactService: FoodFactService) {}

  @Post()
  @Roles(UserRole.ADMIN, UserRole.CHEF)
  @UseGuards(JwtAuthGuard, RolesGuard)
  async create(
    @Body() dto: CreateFoodFactDto,
  ) {
    return this.foodFactService.create(dto);
  }

  @Get()
  async fetchAll() {
    return this.foodFactService.fetchAll();
  }

  @Get(':id')
  async fetchById(@Param('id') id: string) {
    return this.foodFactService.fetchById(id);
  }

  @Patch(':id')
  @Roles(UserRole.ADMIN, UserRole.CHEF)
  @UseGuards(JwtAuthGuard, RolesGuard)
  async update(
    @Param('id') id: string,
    @Body() dto: UpdateFoodFactDto,
  ) {
    return this.foodFactService.update(id, dto);
  }

  @Delete(':id')
  @Roles(UserRole.ADMIN, UserRole.CHEF)
  @UseGuards(JwtAuthGuard, RolesGuard)
  async delete(@Param('id') id: string) {
    return this.foodFactService.delete(id);
  }
}
