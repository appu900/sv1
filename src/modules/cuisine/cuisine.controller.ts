import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Delete,
  Put,
  Query,
  UseGuards,
  UseInterceptors,
  UploadedFiles,
} from '@nestjs/common';
import { FileFieldsInterceptor } from '@nestjs/platform-express';
import { CuisineService } from './cuisine.service';
import { CreateCuisineDto } from './dto/create-cuisine.dto';
import { UpdateCuisineDto } from './dto/update-cuisine.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/role.decorators';
import { UserRole } from '../../database/schemas/user.auth.schema';

@Controller('api/cuisine')
export class CuisineController {
  constructor(private readonly cuisineService: CuisineService) {}

  @Post()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.CHEF)
  @UseInterceptors(FileFieldsInterceptor([{ name: 'image', maxCount: 1 }]))
  async create(
    @Body() createDto: CreateCuisineDto,
    @UploadedFiles() files?: { image?: Express.Multer.File[] },
  ) {
    const cuisine = await this.cuisineService.create(createDto, files);
    return {
      message: 'Cuisine created successfully',
      cuisine,
    };
  }

  @Get()
  async findAll(@Query('activeOnly') activeOnly?: string) {
    // Default: active only (dropdowns/public). Admin management can pass activeOnly=false.
    const onlyActive = activeOnly !== 'false';
    return this.cuisineService.findAll(onlyActive);
  }

  @Get(':id')
  async findOne(@Param('id') id: string) {
    return this.cuisineService.findOne(id);
  }

  @Put(':id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.CHEF)
  @UseInterceptors(FileFieldsInterceptor([{ name: 'image', maxCount: 1 }]))
  async update(
    @Param('id') id: string,
    @Body() updateDto: UpdateCuisineDto,
    @UploadedFiles() files?: { image?: Express.Multer.File[] },
  ) {
    const cuisine = await this.cuisineService.update(id, updateDto, files);
    return {
      message: 'Cuisine updated successfully',
      cuisine,
    };
  }

  @Delete(':id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.CHEF)
  async remove(@Param('id') id: string) {
    await this.cuisineService.remove(id);
    return { message: 'Cuisine deleted successfully' };
  }
}
