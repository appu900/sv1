import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Delete,
  Put,
  UseGuards,
} from '@nestjs/common';
import { FrameworkCategoryService } from './framework-category.service';
import { CreateFrameworkCategoryDto } from './dto/create-framework-category.dto';
import { UpdateFrameworkCategoryDto } from './dto/update-framework-category.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/role.decorators';
import { UserRole } from '../../database/schemas/user.auth.schema';

@Controller('api/framework-category')
export class FrameworkCategoryController {
  constructor(
    private readonly frameworkCategoryService: FrameworkCategoryService,
  ) {}

  @Post()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.CHEF)
  async create(@Body() createDto: CreateFrameworkCategoryDto) {
    const category = await this.frameworkCategoryService.create(createDto);
    return {
      message: 'Framework category created successfully',
      category,
    };
  }

  @Get()
  async findAll() {
    return this.frameworkCategoryService.findAll();
  }

  @Get(':id')
  async findOne(@Param('id') id: string) {
    return this.frameworkCategoryService.findOne(id);
  }

  @Put(':id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.CHEF)
  async update(
    @Param('id') id: string,
    @Body() updateDto: UpdateFrameworkCategoryDto,
  ) {
    const category = await this.frameworkCategoryService.update(id, updateDto);
    return {
      message: 'Framework category updated successfully',
      category,
    };
  }

  @Delete(':id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.CHEF)
  async remove(@Param('id') id: string) {
    await this.frameworkCategoryService.remove(id);
    return { message: 'Framework category deleted successfully' };
  }
}
