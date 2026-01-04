import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  Query,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { HackOrTipService } from './hack-or-tip.service';
import { CreateHackOrTipDto } from './dto/create-hack-or-tip.dto';
import { UpdateHackOrTipDto } from './dto/update-hack-or-tip.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/role.decorators';
import { UserRole } from '../../database/schemas/user.auth.schema';

@Controller('hack-or-tip')
export class HackOrTipController {
  constructor(private readonly hackOrTipService: HackOrTipService) {}

  @Post()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @HttpCode(HttpStatus.CREATED)
  async create(@Body() createDto: CreateHackOrTipDto) {
    const hackOrTip = await this.hackOrTipService.create(createDto);
    return {
      message: 'Hack or Tip created successfully',
      result: hackOrTip,
    };
  }

  @Get()
  async findAll(
    @Query('type') type?: string,
    @Query('isActive') isActive?: string,
  ) {
    const isActiveBool =
      isActive === 'true' ? true : isActive === 'false' ? false : undefined;
    return await this.hackOrTipService.findAll(type, isActiveBool);
  }

  @Get('type/:type')
  async findByType(@Param('type') type: string) {
    return await this.hackOrTipService.findByType(type);
  }

  @Get(':id')
  async findOne(@Param('id') id: string) {
    return await this.hackOrTipService.findOne(id);
  }

  @Patch(':id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  async update(
    @Param('id') id: string,
    @Body() updateDto: UpdateHackOrTipDto,
  ) {
    const hackOrTip = await this.hackOrTipService.update(id, updateDto);
    return {
      message: 'Hack or Tip updated successfully',
      result: hackOrTip,
    };
  }

  @Patch(':id/toggle-active')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  async toggleActive(@Param('id') id: string) {
    const hackOrTip = await this.hackOrTipService.toggleActive(id);
    return {
      message: 'Status toggled successfully',
      result: hackOrTip,
    };
  }

  @Delete(':id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @HttpCode(HttpStatus.OK)
  async remove(@Param('id') id: string) {
    return await this.hackOrTipService.remove(id);
  }
}
