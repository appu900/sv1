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
import {
  ApiTags,
  ApiOperation,
  ApiParam,
  ApiBody,
  ApiOkResponse,
  ApiCreatedResponse,
} from '@nestjs/swagger';
import { FoodFactService } from './food-fact.service';
import { Roles } from 'src/common/decorators/role.decorators';
import { UserRole } from 'src/database/schemas/user.auth.schema';
import { JwtAuthGuard } from 'src/common/guards/jwt-auth.guard';
import { RolesGuard } from 'src/common/guards/roles.guard';
import { CreateFoodFactDto } from './dto/create-food-fact.dto';
import { UpdateFoodFactDto } from './dto/update-food-fact.dto';
import { ApiJwtRoles } from 'src/common/swagger/api-auth.decorators';

@ApiTags('Food Facts')
@Controller('food-facts')
export class FoodFactController {
  constructor(private readonly foodFactService: FoodFactService) {}

  @Post()
  @Roles(UserRole.ADMIN, UserRole.CHEF)
  @UseGuards(JwtAuthGuard, RolesGuard)
  @ApiJwtRoles('Requires admin or chef role.')
  @ApiOperation({
    summary: 'Create a food fact',
    description:
      'Creates a food-fact card (title, optional sponsor, related ingredient, and fact/insight text). Requires admin or chef.',
  })
  @ApiBody({ type: CreateFoodFactDto })
  @ApiCreatedResponse({ description: 'Food fact created.' })
  async create(
    @Body() dto: CreateFoodFactDto,
  ) {
    return this.foodFactService.create(dto);
  }

  @Get()
  @ApiOperation({
    summary: 'List food facts',
    description: 'Returns all food-fact cards. Public; no auth required.',
  })
  @ApiOkResponse({ description: 'Array of food facts.' })
  async fetchAll() {
    return this.foodFactService.fetchAll();
  }

  @Get(':id')
  @ApiOperation({
    summary: 'Get food fact by id',
    description: 'Returns a single food-fact card by Mongo ObjectId.',
  })
  @ApiParam({ name: 'id', description: 'Food fact ObjectId.' })
  @ApiOkResponse({ description: 'Food fact document.' })
  async fetchById(@Param('id') id: string) {
    return this.foodFactService.fetchById(id);
  }

  @Patch(':id')
  @Roles(UserRole.ADMIN, UserRole.CHEF)
  @UseGuards(JwtAuthGuard, RolesGuard)
  @ApiJwtRoles('Requires admin or chef role.')
  @ApiOperation({
    summary: 'Update a food fact',
    description:
      'Partial update of a food-fact card. Requires admin or chef.',
  })
  @ApiParam({ name: 'id', description: 'Food fact ObjectId.' })
  @ApiBody({ type: UpdateFoodFactDto })
  @ApiOkResponse({ description: 'Updated food fact.' })
  async update(
    @Param('id') id: string,
    @Body() dto: UpdateFoodFactDto,
  ) {
    return this.foodFactService.update(id, dto);
  }

  @Delete(':id')
  @Roles(UserRole.ADMIN, UserRole.CHEF)
  @UseGuards(JwtAuthGuard, RolesGuard)
  @ApiJwtRoles('Requires admin or chef role.')
  @ApiOperation({
    summary: 'Delete a food fact',
    description: 'Deletes a food-fact card by id. Requires admin or chef.',
  })
  @ApiParam({ name: 'id', description: 'Food fact ObjectId.' })
  @ApiOkResponse({ description: 'Food fact deleted.' })
  async delete(@Param('id') id: string) {
    return this.foodFactService.delete(id);
  }
}
