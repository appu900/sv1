import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiParam,
  ApiBody,
  ApiOkResponse,
  ApiCreatedResponse,
} from '@nestjs/swagger';
import { SurveyConfigService } from './survey-config.service';
import { CreateSurveyConfigDto } from './dto/create-survey-config.dto';
import { UpdateSurveyConfigDto } from './dto/update-survey-config.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/role.decorators';
import { UserRole } from '../../database/schemas/user.auth.schema';
import { ApiJwtRoles } from '../../common/swagger/api-auth.decorators';

@ApiTags('Survey Config')
@Controller('survey-config')
export class SurveyConfigController {
  constructor(private readonly surveyConfigService: SurveyConfigService) {}

  @Post()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @HttpCode(HttpStatus.CREATED)
  @ApiJwtRoles('Requires admin role.')
  @ApiOperation({
    summary: 'Create a survey config',
    description:
      'Admin-only. Creates a new tracking-survey configuration (questions, cadence, and active flag).',
  })
  @ApiBody({ type: CreateSurveyConfigDto })
  @ApiCreatedResponse({ description: 'Survey config created.' })
  async create(@Body() dto: CreateSurveyConfigDto) {
    const result = await this.surveyConfigService.create(dto);
    return { message: 'Survey config created', result };
  }

  @Get()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @ApiJwtRoles('Requires admin role.')
  @ApiOperation({
    summary: 'List all survey configs',
    description:
      'Admin-only. Returns every survey configuration, including inactive ones, for the admin CMS.',
  })
  @ApiOkResponse({ description: 'All survey configs.' })
  async findAll() {
    return this.surveyConfigService.findAll();
  }

  @Get(':id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @ApiJwtRoles('Requires admin role.')
  @ApiOperation({
    summary: 'Get a survey config by id',
    description:
      'Admin-only. Returns one survey configuration document by Mongo ObjectId.',
  })
  @ApiParam({ name: 'id', description: 'Survey config ObjectId.' })
  @ApiOkResponse({ description: 'Survey config document.' })
  async findById(@Param('id') id: string) {
    return this.surveyConfigService.findById(id);
  }

  @Patch(':id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @ApiJwtRoles('Requires admin role.')
  @ApiOperation({
    summary: 'Update a survey config',
    description:
      'Admin-only. Partial update of questions, cadence, or metadata for an existing survey configuration.',
  })
  @ApiParam({ name: 'id', description: 'Survey config ObjectId.' })
  @ApiBody({ type: UpdateSurveyConfigDto })
  @ApiOkResponse({ description: 'Survey config updated.' })
  async update(@Param('id') id: string, @Body() dto: UpdateSurveyConfigDto) {
    const result = await this.surveyConfigService.update(id, dto);
    return { message: 'Survey config updated', result };
  }

  @Patch(':id/toggle-active')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @ApiJwtRoles('Requires admin role.')
  @ApiOperation({
    summary: 'Toggle a survey config active flag',
    description:
      'Admin-only. Activates or deactivates the given config. Typically only one config is active at a time for the app.',
  })
  @ApiParam({ name: 'id', description: 'Survey config ObjectId.' })
  @ApiOkResponse({ description: 'Active flag toggled.' })
  async toggleActive(@Param('id') id: string) {
    const result = await this.surveyConfigService.toggleActive(id);
    return { message: `Survey config ${result.isActive ? 'activated' : 'deactivated'}`, result };
  }

  @Delete(':id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @HttpCode(HttpStatus.OK)
  @ApiJwtRoles('Requires admin role.')
  @ApiOperation({
    summary: 'Delete a survey config',
    description:
      'Admin-only. Permanently removes a survey configuration. Existing user submissions are not deleted.',
  })
  @ApiParam({ name: 'id', description: 'Survey config ObjectId.' })
  @ApiOkResponse({ description: 'Survey config deleted.' })
  async remove(@Param('id') id: string) {
    return this.surveyConfigService.remove(id);
  }

  @Get('active/current')
  @ApiOperation({
    summary: 'Get the currently active survey config',
    description:
      'Public (no JWT). Returns the survey configuration the mobile app should render right now. Prefer this over listing configs.',
  })
  @ApiOkResponse({ description: 'Active survey config, or empty when none is active.' })
  async getActiveConfig() {
    return this.surveyConfigService.getActiveConfig();
  }

  @Post('seed')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @HttpCode(HttpStatus.OK)
  @ApiJwtRoles('Requires admin role.')
  @ApiOperation({
    summary: 'Seed the default survey config if empty',
    description:
      'Admin-only. Inserts the built-in default survey configuration only when the collection is empty. Safe to call repeatedly.',
  })
  @ApiOkResponse({ description: 'Default config seeded if the collection was empty.' })
  async seed() {
    await this.surveyConfigService.seedDefaultIfEmpty();
    return { message: 'Default config seeded (if empty)' };
  }

  @Post('reseed')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @HttpCode(HttpStatus.OK)
  @ApiJwtRoles('Requires admin role.')
  @ApiOperation({
    summary: 'Re-seed survey config with latest defaults',
    description:
      'Admin-only. Replaces the stored default survey configuration with the latest built-in questions and settings. Use after a product content update.',
  })
  @ApiOkResponse({ description: 'Survey config re-seeded.' })
  async reseed() {
    await this.surveyConfigService.reseed();
    return { message: 'Survey config re-seeded with latest defaults' };
  }
}
