import {
  Controller,
  Body,
  Get,
  Post,
  Patch,
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
import { StickerService } from './sticker.service';
import { CreateStickerDto } from './dto/create-sticker.dto';
import { JwtAuthGuard } from 'src/common/guards/jwt-auth.guard';
import { RolesGuard } from 'src/common/guards/roles.guard';
import { UserRole } from 'src/database/schemas/user.auth.schema';
import { Roles } from 'src/common/decorators/role.decorators';
import { FileFieldsInterceptor } from '@nestjs/platform-express';
import { ApiJwtRoles } from 'src/common/swagger/api-auth.decorators';

@ApiTags('Stickers')
@Controller('sticker')
export class StickerController {
  constructor(private readonly stickerService: StickerService) {}

  @Post('')
  @Roles(UserRole.ADMIN, UserRole.CHEF)
  @UseGuards(JwtAuthGuard, RolesGuard)
  @UseInterceptors(FileFieldsInterceptor([{ name: 'image', maxCount: 1 }]))
  @ApiJwtRoles('Requires admin or chef role.')
  @ApiConsumes('multipart/form-data')
  @ApiOperation({
    summary: 'Create a sticker',
    description:
      'Creates a sticker asset with title, optional description, and an image file. Requires admin or chef.',
  })
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'Sticker title.' },
        description: { type: 'string', description: 'Optional sticker description.' },
        image: {
          type: 'string',
          format: 'binary',
          description: 'Sticker image file.',
        },
      },
    },
  })
  @ApiCreatedResponse({ description: 'Sticker created.' })
  async create(
    @Body() dto: CreateStickerDto,
    @UploadedFiles() files: { image: Express.Multer.File[] },
  ) {
    return this.stickerService.create(dto, files);
  }

  @Get('')
  @Roles(UserRole.ADMIN, UserRole.CHEF)
  @UseGuards(JwtAuthGuard, RolesGuard)
  @ApiJwtRoles('Requires admin or chef role.')
  @ApiOperation({
    summary: 'List stickers',
    description:
      'Returns all sticker assets. Requires admin or chef (not a public catalogue).',
  })
  @ApiOkResponse({ description: 'Array of stickers.' })
  async getAll() {
    return this.stickerService.fetchAllStickers();
  }

  @Patch(':id')
  @Roles(UserRole.ADMIN, UserRole.CHEF)
  @UseGuards(JwtAuthGuard, RolesGuard)
  @UseInterceptors(FileFieldsInterceptor([{ name: 'image', maxCount: 1 }]))
  @ApiJwtRoles('Requires admin or chef role.')
  @ApiConsumes('multipart/form-data')
  @ApiOperation({
    summary: 'Update a sticker',
    description:
      'Updates sticker title/description and optionally replaces the image. Requires admin or chef.',
  })
  @ApiParam({ name: 'id', description: 'Sticker ObjectId.' })
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'Sticker title.' },
        description: { type: 'string', description: 'Optional sticker description.' },
        image: {
          type: 'string',
          format: 'binary',
          description: 'Replacement sticker image file.',
        },
      },
    },
  })
  @ApiOkResponse({ description: 'Updated sticker.' })
  async update(
    @Param('id') id: string,
    @Body() dto: CreateStickerDto,
    @UploadedFiles() files: { image: Express.Multer.File[] },
  ) {
    return this.stickerService.update(id, dto, files);
  }

  @Delete(':id')
  @Roles(UserRole.ADMIN, UserRole.CHEF)
  @UseGuards(JwtAuthGuard, RolesGuard)
  @ApiJwtRoles('Requires admin or chef role.')
  @ApiOperation({
    summary: 'Delete a sticker',
    description: 'Deletes a sticker by id. Requires admin or chef.',
  })
  @ApiParam({ name: 'id', description: 'Sticker ObjectId.' })
  @ApiOkResponse({ description: 'Sticker deleted.' })
  async delete(@Param('id') id: string) {
    return this.stickerService.delete(id);
  }
}
