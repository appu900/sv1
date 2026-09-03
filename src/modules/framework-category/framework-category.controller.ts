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
import {
  ApiTags,
  ApiOperation,
  ApiParam,
  ApiBody,
  ApiOkResponse,
  ApiCreatedResponse,
} from '@nestjs/swagger';
import { FrameworkCategoryService } from './framework-category.service';
import { CreateFrameworkCategoryDto } from './dto/create-framework-category.dto';
import { UpdateFrameworkCategoryDto } from './dto/update-framework-category.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/role.decorators';
import { UserRole } from '../../database/schemas/user.auth.schema';
import { ApiJwtRoles } from '../../common/swagger/api-auth.decorators';

@ApiTags('Framework Categories')
@Controller('api/framework-category')
export class FrameworkCategoryController {
  constructor(
    private readonly frameworkCategoryService: FrameworkCategoryService,
  ) {}

  @Post()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.CHEF)
  @ApiJwtRoles('Requires admin or chef role.')
  @ApiOperation({
    summary: 'Create a framework category',
    description:
      'Creates a recipe framework category (title and optional description). Live path is `POST /api/api/framework-category` because this controller is mounted at `api/framework-category` under the global `api` prefix.',
  })
  @ApiBody({ type: CreateFrameworkCategoryDto })
  @ApiCreatedResponse({ description: 'Framework category created successfully.' })
  async create(@Body() createDto: CreateFrameworkCategoryDto) {
    const category = await this.frameworkCategoryService.create(createDto);
    return {
      message: 'Framework category created successfully',
      category,
    };
  }

  @Get()
  @ApiOperation({
    summary: 'List framework categories',
    description:
      'Returns all recipe framework categories. Public; no auth required. Live path is `GET /api/api/framework-category`.',
  })
  @ApiOkResponse({ description: 'Array of framework categories.' })
  async findAll() {
    return this.frameworkCategoryService.findAll();
  }

  @Get(':id')
  @ApiOperation({
    summary: 'Get framework category by id',
    description:
      'Returns a single framework category by Mongo ObjectId. Live path is `GET /api/api/framework-category/:id`.',
  })
  @ApiParam({ name: 'id', description: 'Framework category ObjectId.' })
  @ApiOkResponse({ description: 'Framework category document.' })
  async findOne(@Param('id') id: string) {
    return this.frameworkCategoryService.findOne(id);
  }

  @Put(':id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.CHEF)
  @ApiJwtRoles('Requires admin or chef role.')
  @ApiOperation({
    summary: 'Update a framework category',
    description:
      'Partial update of a framework category title and/or description. Live path is `PUT /api/api/framework-category/:id`.',
  })
  @ApiParam({ name: 'id', description: 'Framework category ObjectId.' })
  @ApiBody({ type: UpdateFrameworkCategoryDto })
  @ApiOkResponse({ description: 'Framework category updated successfully.' })
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
  @ApiJwtRoles('Requires admin or chef role.')
  @ApiOperation({
    summary: 'Delete a framework category',
    description:
      'Permanently deletes a framework category by id. Live path is `DELETE /api/api/framework-category/:id`.',
  })
  @ApiParam({ name: 'id', description: 'Framework category ObjectId.' })
  @ApiOkResponse({ description: 'Framework category deleted successfully.' })
  async remove(@Param('id') id: string) {
    await this.frameworkCategoryService.remove(id);
    return { message: 'Framework category deleted successfully' };
  }
}
