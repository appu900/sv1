import {
  Controller,
  Body,
  Get,
  Post,
  UseGuards,
  UseInterceptors,
  UploadedFiles,
} from '@nestjs/common';
import { StickerService } from './sticker.service';
import { CreateStickerDto } from './dto/create-sticker.dto';
import { JwtAuthGuard } from 'src/common/guards/jwt-auth.guard';
import { RolesGuard } from 'src/common/guards/roles.guard';
import { UserRole } from 'src/database/schemas/user.auth.schema';
import { Roles } from 'src/common/decorators/role.decorators';
import { FileFieldsInterceptor } from '@nestjs/platform-express';

@Controller('sticker')
export class StickerController {
  constructor(private readonly stickerService: StickerService) {}

  @Post('')
  @Roles(UserRole.ADMIN, UserRole.CHEF)
  @UseGuards(JwtAuthGuard, RolesGuard)
  @UseInterceptors(FileFieldsInterceptor([{ name: 'image', maxCount: 1 }]))
  async create(
    @Body() dto: CreateStickerDto,
    @UploadedFiles() files: { image: Express.Multer.File[] },
  ) {
    return this.stickerService.create(dto, files);
  }

  @Get('')
  @Roles(UserRole.ADMIN, UserRole.CHEF)
  @UseGuards(JwtAuthGuard, RolesGuard)
  async getAll() {
    return this.stickerService.fetchAllStickers();
  }
}
