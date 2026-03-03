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
import { SurveyConfigService } from './survey-config.service';
import { CreateSurveyConfigDto } from './dto/create-survey-config.dto';
import { UpdateSurveyConfigDto } from './dto/update-survey-config.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/role.decorators';
import { UserRole } from '../../database/schemas/user.auth.schema';

@Controller('survey-config')
export class SurveyConfigController {
  constructor(private readonly surveyConfigService: SurveyConfigService) {}

  @Post()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @HttpCode(HttpStatus.CREATED)
  async create(@Body() dto: CreateSurveyConfigDto) {
    const result = await this.surveyConfigService.create(dto);
    return { message: 'Survey config created', result };
  }

  @Get()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  async findAll() {
    return this.surveyConfigService.findAll();
  }

  @Get(':id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  async findById(@Param('id') id: string) {
    return this.surveyConfigService.findById(id);
  }

  @Patch(':id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  async update(@Param('id') id: string, @Body() dto: UpdateSurveyConfigDto) {
    const result = await this.surveyConfigService.update(id, dto);
    return { message: 'Survey config updated', result };
  }

  @Patch(':id/toggle-active')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  async toggleActive(@Param('id') id: string) {
    const result = await this.surveyConfigService.toggleActive(id);
    return { message: `Survey config ${result.isActive ? 'activated' : 'deactivated'}`, result };
  }

  @Delete(':id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @HttpCode(HttpStatus.OK)
  async remove(@Param('id') id: string) {
    return this.surveyConfigService.remove(id);
  }

  @Get('active/current')
  async getActiveConfig() {
    return this.surveyConfigService.getActiveConfig();
  }

  @Post('seed')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @HttpCode(HttpStatus.OK)
  async seed() {
    await this.surveyConfigService.seedDefaultIfEmpty();
    return { message: 'Default config seeded (if empty)' };
  }

  @Post('reseed')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @HttpCode(HttpStatus.OK)
  async reseed() {
    await this.surveyConfigService.reseed();
    return { message: 'Survey config re-seeded with latest defaults' };
  }
}
