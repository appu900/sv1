import {
  Controller,
  Body,
  Get,
  Put,
  Post,
  UseGuards,
  UseInterceptors,
  UploadedFiles,
} from '@nestjs/common';
import { SponsersService } from './sponsers.service';
import { Roles } from 'src/common/decorators/role.decorators';
import { UserRole } from 'src/database/schemas/user.auth.schema';
import { JwtAuthGuard } from 'src/common/guards/jwt-auth.guard';
import { RolesGuard } from 'src/common/guards/roles.guard';
import { CreateSponsers } from './dto/Create.sponsers.dto';
import { FileFieldsInterceptor } from '@nestjs/platform-express';

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
  async fetchAllSponsers() {
    return this.sponsersService.fetchAll();
  }
}
