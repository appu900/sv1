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
import {
  ApiTags,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiBody,
  ApiConsumes,
  ApiOkResponse,
  ApiCreatedResponse,
} from '@nestjs/swagger';
import { CuisineService } from './cuisine.service';
import { CreateCuisineDto } from './dto/create-cuisine.dto';
import { UpdateCuisineDto } from './dto/update-cuisine.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/role.decorators';
import { UserRole } from '../../database/schemas/user.auth.schema';
import { ApiJwtRoles } from '../../common/swagger/api-auth.decorators';

@ApiTags('Cuisines')
@Controller('api/cuisine')
export class CuisineController {
  constructor(private readonly cuisineService: CuisineService) {}

  @Post()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.CHEF)
  @UseInterceptors(FileFieldsInterceptor([{ name: 'image', maxCount: 1 }]))
  @ApiJwtRoles('Requires admin or chef role.')
  @ApiConsumes('multipart/form-data')
  @ApiOperation({
    summary: 'Create a cuisine',
    description:
      'Creates a cuisine with title, optional description/order/active flag, and an optional image. Live path is `POST /api/api/cuisine` because this controller is mounted at `api/cuisine` under the global `api` prefix.',
  })
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'Cuisine display name.' },
        description: { type: 'string', description: 'Optional cuisine description.' },
        order: { type: 'string', description: 'Display order (number).' },
        isActive: { type: 'string', description: '`true`/`false`. Defaults to active when omitted.' },
        image: {
          type: 'string',
          format: 'binary',
          description: 'Cuisine image file.',
        },
      },
    },
  })
  @ApiCreatedResponse({ description: 'Cuisine created successfully.' })
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
  @ApiOperation({
    summary: 'List cuisines',
    description:
      'Returns cuisines. By default only active cuisines are returned (dropdowns / public). Pass `activeOnly=false` to include inactive ones for admin management. Live path is `GET /api/api/cuisine`.',
  })
  @ApiQuery({
    name: 'activeOnly',
    required: false,
    description:
      'Defaults to active-only. Set to `false` to include inactive cuisines.',
  })
  @ApiOkResponse({ description: 'Array of cuisines.' })
  async findAll(@Query('activeOnly') activeOnly?: string) {
    // Default: active only (dropdowns/public). Admin management can pass activeOnly=false.
    const onlyActive = activeOnly !== 'false';
    return this.cuisineService.findAll(onlyActive);
  }

  @Get(':id')
  @ApiOperation({
    summary: 'Get cuisine by id',
    description:
      'Returns a single cuisine by Mongo ObjectId. Live path is `GET /api/api/cuisine/:id`.',
  })
  @ApiParam({ name: 'id', description: 'Cuisine ObjectId.' })
  @ApiOkResponse({ description: 'Cuisine document.' })
  async findOne(@Param('id') id: string) {
    return this.cuisineService.findOne(id);
  }

  @Put(':id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.CHEF)
  @UseInterceptors(FileFieldsInterceptor([{ name: 'image', maxCount: 1 }]))
  @ApiJwtRoles('Requires admin or chef role.')
  @ApiConsumes('multipart/form-data')
  @ApiOperation({
    summary: 'Update a cuisine',
    description:
      'Partial update of a cuisine. Optional new `image` replaces the stored image. Live path is `PUT /api/api/cuisine/:id`.',
  })
  @ApiParam({ name: 'id', description: 'Cuisine ObjectId.' })
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'Cuisine display name.' },
        description: { type: 'string', description: 'Optional cuisine description.' },
        order: { type: 'string', description: 'Display order (number).' },
        isActive: { type: 'string', description: '`true`/`false`.' },
        image: {
          type: 'string',
          format: 'binary',
          description: 'Replacement cuisine image file.',
        },
      },
    },
  })
  @ApiOkResponse({ description: 'Cuisine updated successfully.' })
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
  @ApiJwtRoles('Requires admin or chef role.')
  @ApiOperation({
    summary: 'Delete a cuisine',
    description:
      'Permanently deletes a cuisine by id. Live path is `DELETE /api/api/cuisine/:id`.',
  })
  @ApiParam({ name: 'id', description: 'Cuisine ObjectId.' })
  @ApiOkResponse({ description: 'Cuisine deleted successfully.' })
  async remove(@Param('id') id: string) {
    await this.cuisineService.remove(id);
    return { message: 'Cuisine deleted successfully' };
  }
}
