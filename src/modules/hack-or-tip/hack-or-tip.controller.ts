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
import {
  ApiTags,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiBody,
  ApiOkResponse,
  ApiCreatedResponse,
} from '@nestjs/swagger';
import { HackOrTipService } from './hack-or-tip.service';
import { CreateHackOrTipDto } from './dto/create-hack-or-tip.dto';
import { UpdateHackOrTipDto } from './dto/update-hack-or-tip.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/role.decorators';
import { UserRole } from '../../database/schemas/user.auth.schema';
import { ApiJwtRoles } from '../../common/swagger/api-auth.decorators';

@ApiTags('Hack or Tip')
@Controller('hack-or-tip')
export class HackOrTipController {
  constructor(private readonly hackOrTipService: HackOrTipService) {}

  @Post()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @HttpCode(HttpStatus.CREATED)
  @ApiJwtRoles('Requires admin role.')
  @ApiOperation({
    summary: 'Create a hack or tip',
    description:
      'Creates a short hack-or-tip card (`Pro Tip`, `Mini Hack`, or `Serving Suggestion`) shown in the app. Optional sponsor heading and sponsor id. Requires admin.',
  })
  @ApiBody({ type: CreateHackOrTipDto })
  @ApiCreatedResponse({ description: 'Hack or Tip created successfully.' })
  async create(@Body() createDto: CreateHackOrTipDto) {
    const hackOrTip = await this.hackOrTipService.create(createDto);
    return {
      message: 'Hack or Tip created successfully',
      result: hackOrTip,
    };
  }

  @Get()
  @ApiOperation({
    summary: 'List hacks or tips',
    description:
      'Returns hack-or-tip cards, newest first, with sponsor populated. Filter by `type` and/or `isActive`. Public; no auth required.',
  })
  @ApiQuery({
    name: 'type',
    required: false,
    description:
      'Filter by type: `Pro Tip`, `Mini Hack`, or `Serving Suggestion`.',
  })
  @ApiQuery({
    name: 'isActive',
    required: false,
    description:
      '`true` to return only active cards, `false` for inactive. Omit to return both.',
  })
  @ApiOkResponse({ description: 'Array of hack-or-tip cards.' })
  async findAll(
    @Query('type') type?: string,
    @Query('isActive') isActive?: string,
  ) {
    const isActiveBool =
      isActive === 'true' ? true : isActive === 'false' ? false : undefined;
    return await this.hackOrTipService.findAll(type, isActiveBool);
  }

  @Get('type/:type')
  @ApiOperation({
    summary: 'List hacks or tips by type',
    description:
      'Returns hack-or-tip cards of a single type (`Pro Tip`, `Mini Hack`, or `Serving Suggestion`).',
  })
  @ApiParam({
    name: 'type',
    description: 'Hack-or-tip type: `Pro Tip`, `Mini Hack`, or `Serving Suggestion`.',
  })
  @ApiOkResponse({ description: 'Array of matching hack-or-tip cards.' })
  async findByType(@Param('type') type: string) {
    return await this.hackOrTipService.findByType(type);
  }

  @Get(':id')
  @ApiOperation({
    summary: 'Get hack or tip by id',
    description: 'Returns a single hack-or-tip card by Mongo ObjectId.',
  })
  @ApiParam({ name: 'id', description: 'Hack-or-tip ObjectId.' })
  @ApiOkResponse({ description: 'Hack-or-tip document.' })
  async findOne(@Param('id') id: string) {
    return await this.hackOrTipService.findOne(id);
  }

  @Patch(':id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @ApiJwtRoles('Requires admin role.')
  @ApiOperation({
    summary: 'Update a hack or tip',
    description:
      'Partial update of a hack-or-tip card. Requires admin.',
  })
  @ApiParam({ name: 'id', description: 'Hack-or-tip ObjectId.' })
  @ApiBody({ type: UpdateHackOrTipDto })
  @ApiOkResponse({ description: 'Hack or Tip updated successfully.' })
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
  @ApiJwtRoles('Requires admin role.')
  @ApiOperation({
    summary: 'Toggle hack or tip active status',
    description:
      'Flips `isActive` on a hack-or-tip card. Requires admin.',
  })
  @ApiParam({ name: 'id', description: 'Hack-or-tip ObjectId.' })
  @ApiOkResponse({ description: 'Status toggled successfully.' })
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
  @ApiJwtRoles('Requires admin role.')
  @ApiOperation({
    summary: 'Delete a hack or tip',
    description: 'Deletes a hack-or-tip card by id. Requires admin.',
  })
  @ApiParam({ name: 'id', description: 'Hack-or-tip ObjectId.' })
  @ApiOkResponse({ description: 'Hack or tip deleted.' })
  async remove(@Param('id') id: string) {
    return await this.hackOrTipService.remove(id);
  }
}
