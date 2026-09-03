import { Controller, Body, Post, Get, Patch, Delete, Param, UseGuards } from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiParam,
  ApiBody,
  ApiOkResponse,
  ApiCreatedResponse,
} from '@nestjs/swagger';
import { DietService } from './diet.service';
import { CreateDietDto } from './dto/create.diet.dto';
import { JwtAuthGuard } from 'src/common/guards/jwt-auth.guard';
import { RolesGuard } from 'src/common/guards/roles.guard';
import { Roles } from 'src/common/decorators/role.decorators';
import { UserRole } from 'src/database/schemas/user.auth.schema';
import { ApiJwtRoles } from 'src/common/swagger/api-auth.decorators';

@ApiTags('Diets')
@Controller('diet')
export class DietController {
  constructor(private readonly dietService: DietService) {}

  @Post('')
  @Roles(UserRole.ADMIN, UserRole.CHEF)
  @UseGuards(JwtAuthGuard, RolesGuard)
  @ApiJwtRoles('Requires admin or chef role.')
  @ApiOperation({
    summary: 'Create diet tags',
    description:
      'Creates one or more diet tags from `diets` (an array of names). Used across recipes, ingredients, and onboarding. Requires admin or chef.',
  })
  @ApiBody({ type: CreateDietDto })
  @ApiCreatedResponse({ description: 'Created diet documents.' })
  async create(@Body() dto: CreateDietDto) {
    return this.dietService.create(dto);
  }

  @Get('')
  @ApiOperation({
    summary: 'List diet tags',
    description:
      'Returns all diet tags (cached). Public; no auth required.',
  })
  @ApiOkResponse({ description: 'Array of diet tags.' })
  async getAll() {
    return this.dietService.getAll();
  }

  @Patch(':id')
  @Roles(UserRole.ADMIN, UserRole.CHEF)
  @UseGuards(JwtAuthGuard, RolesGuard)
  @ApiJwtRoles('Requires admin or chef role.')
  @ApiOperation({
    summary: 'Update a diet tag',
    description:
      'Renames a diet tag by id. Requires admin or chef.',
  })
  @ApiParam({ name: 'id', description: 'Diet tag ObjectId.' })
  @ApiBody({
    schema: {
      type: 'object',
      required: ['name'],
      properties: {
        name: { type: 'string', description: 'Display name of the diet tag.' },
      },
    },
  })
  @ApiOkResponse({ description: 'Updated diet tag.' })
  async update(@Param('id') id: string, @Body() dto: { name: string }) {
    return this.dietService.update(id, dto);
  }

  @Delete(':id')
  @Roles(UserRole.ADMIN, UserRole.CHEF)
  @UseGuards(JwtAuthGuard, RolesGuard)
  @ApiJwtRoles('Requires admin or chef role.')
  @ApiOperation({
    summary: 'Delete a diet tag',
    description: 'Deletes a diet tag by id. Requires admin or chef.',
  })
  @ApiParam({ name: 'id', description: 'Diet tag ObjectId.' })
  @ApiOkResponse({ description: 'Diet tag deleted successfully.' })
  async delete(@Param('id') id: string) {
    return this.dietService.delete(id);
  }
}
