import {
  Controller,
  Body,
  Get,
  Put,
  Post,
  Delete,
  Param,
  UseGuards,
  UseInterceptors,
  UploadedFiles,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiParam,
  ApiBody,
  ApiConsumes,
  ApiOkResponse,
  ApiCreatedResponse,
} from '@nestjs/swagger';
import { SponsersService } from './sponsers.service';
import { Roles } from 'src/common/decorators/role.decorators';
import { UserRole } from 'src/database/schemas/user.auth.schema';
import { JwtAuthGuard } from 'src/common/guards/jwt-auth.guard';
import { RolesGuard } from 'src/common/guards/roles.guard';
import { CreateSponsers } from './dto/Create.sponsers.dto';
import { FileFieldsInterceptor } from '@nestjs/platform-express';
import { ApiJwtRoles } from 'src/common/swagger/api-auth.decorators';

const SPONSOR_MULTIPART_PROPERTIES = {
  title: { type: 'string', description: 'Sponsor display name.' },
  broughtToYouBy: { type: 'string', description: 'Optional “brought to you by” line.' },
  tagline: { type: 'string', description: 'Optional sponsor tagline.' },
  logo: {
    type: 'string',
    format: 'binary',
    description: 'Colour sponsor logo file.',
  },
  logoBlackAndWhite: {
    type: 'string',
    format: 'binary',
    description: 'Black-and-white sponsor logo file.',
  },
};

@ApiTags('Sponsors')
@Controller('sponsers')
export class SponsersController {
  constructor(private readonly sponsersService: SponsersService) {}

  @Post('')
  @Roles(UserRole.ADMIN, UserRole.CHEF)
  @UseGuards(JwtAuthGuard, RolesGuard)
  @UseInterceptors(
    FileFieldsInterceptor([
      { name: 'logo', maxCount: 1 },
      { name: 'logoBlackAndWhite', maxCount: 1 },
    ]),
  )
  @ApiJwtRoles('Requires admin or chef role.')
  @ApiConsumes('multipart/form-data')
  @ApiOperation({
    summary: 'Create a sponsor',
    description:
      'Creates a sponsor record with title, optional copy, and colour / black-and-white logos. Requires admin or chef.',
  })
  @ApiBody({
    schema: { type: 'object', properties: SPONSOR_MULTIPART_PROPERTIES },
  })
  @ApiCreatedResponse({ description: 'Sponsor created.' })
  async create(
    @Body() dto: CreateSponsers,
    @UploadedFiles()
    files: {
      logo: Express.Multer.File[];
      logoBlackAndWhite: Express.Multer.File[];
    },
  ) {
    return this.sponsersService.create(dto, files);
  }

  @Get('')
  @ApiOperation({
    summary: 'List sponsors',
    description: 'Returns all sponsor records. Public; no auth required.',
  })
  @ApiOkResponse({ description: 'Array of sponsors.' })
  async fetchAllSponsers() {
    return this.sponsersService.fetchAll();
  }

  @Get(':id')
  @ApiOperation({
    summary: 'Get sponsor by id',
    description: 'Returns a single sponsor by Mongo ObjectId.',
  })
  @ApiParam({ name: 'id', description: 'Sponsor ObjectId.' })
  @ApiOkResponse({ description: 'Sponsor document.' })
  async fetchSponserById(@Param('id') id: string) {
    return this.sponsersService.fetchById(id);
  }

  @Put(':id')
  @Roles(UserRole.ADMIN, UserRole.CHEF)
  @UseGuards(JwtAuthGuard, RolesGuard)
  @UseInterceptors(
    FileFieldsInterceptor([
      { name: 'logo', maxCount: 1 },
      { name: 'logoBlackAndWhite', maxCount: 1 },
    ]),
  )
  @ApiJwtRoles('Requires admin or chef role.')
  @ApiConsumes('multipart/form-data')
  @ApiOperation({
    summary: 'Update a sponsor',
    description:
      'Updates sponsor copy and optionally replaces `logo` and/or `logoBlackAndWhite`. Requires admin or chef.',
  })
  @ApiParam({ name: 'id', description: 'Sponsor ObjectId.' })
  @ApiBody({
    schema: { type: 'object', properties: SPONSOR_MULTIPART_PROPERTIES },
  })
  @ApiOkResponse({ description: 'Updated sponsor.' })
  async update(
    @Param('id') id: string,
    @Body() dto: CreateSponsers,
    @UploadedFiles()
    files: {
      logo?: Express.Multer.File[];
      logoBlackAndWhite?: Express.Multer.File[];
    },
  ) {
    return this.sponsersService.update(id, dto, files);
  }

  @Delete(':id')
  @Roles(UserRole.ADMIN, UserRole.CHEF)
  @UseGuards(JwtAuthGuard, RolesGuard)
  @ApiJwtRoles('Requires admin or chef role.')
  @ApiOperation({
    summary: 'Delete a sponsor',
    description: 'Deletes a sponsor by id. Requires admin or chef.',
  })
  @ApiParam({ name: 'id', description: 'Sponsor ObjectId.' })
  @ApiOkResponse({ description: 'Sponsor deleted.' })
  async remove(@Param('id') id: string) {
    return this.sponsersService.remove(id);
  }
}
