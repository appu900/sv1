import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Put,
  Query,
  UploadedFiles,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileFieldsInterceptor } from '@nestjs/platform-express';
import { ChefProfileService } from './chef-profile.service';
import { CreateChefProfileDto } from './dto/create-chef-profile.dto';
import { UpdateChefProfileDto } from './dto/update-chef-profile.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/role.decorators';
import { GetUser } from '../../common/decorators/Get.user.decorator';
import { UserRole } from '../../database/schemas/user.auth.schema';

@Controller('chef-profiles')
export class ChefProfilesController {
  constructor(private readonly chefProfileService: ChefProfileService) {}

  @Get()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  findAll() {
    return this.chefProfileService.findAllAdmin();
  }

  @Get('me')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.CHEF)
  getMe(@GetUser() user: any) {
    return this.chefProfileService.getOrCreateForUser(user.userId);
  }

  @Put('me')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.CHEF)
  @UseInterceptors(
    FileFieldsInterceptor([
      { name: 'avatar', maxCount: 1 },
      { name: 'hero', maxCount: 1 },
    ]),
  )
  updateMe(
    @GetUser() user: any,
    @Body() dto: UpdateChefProfileDto,
    @UploadedFiles()
    files?: { avatar?: Express.Multer.File[]; hero?: Express.Multer.File[] },
  ) {
    return this.chefProfileService.updateMe(user.userId, dto, files);
  }

  @Get(':id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  findOne(@Param('id') id: string) {
    return this.chefProfileService.findOneAdmin(id);
  }

  @Post()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @UseInterceptors(
    FileFieldsInterceptor([
      { name: 'avatar', maxCount: 1 },
      { name: 'hero', maxCount: 1 },
    ]),
  )
  async create(
    @Body() dto: CreateChefProfileDto,
    @UploadedFiles()
    files?: { avatar?: Express.Multer.File[]; hero?: Express.Multer.File[] },
  ) {
    const profile = await this.chefProfileService.create(dto, files);
    return { message: 'Chef profile created', profile };
  }

  @Put(':id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @UseInterceptors(
    FileFieldsInterceptor([
      { name: 'avatar', maxCount: 1 },
      { name: 'hero', maxCount: 1 },
    ]),
  )
  async update(
    @Param('id') id: string,
    @Body() dto: UpdateChefProfileDto,
    @UploadedFiles()
    files?: { avatar?: Express.Multer.File[]; hero?: Express.Multer.File[] },
  ) {
    const profile = await this.chefProfileService.update(id, dto, files);
    return { message: 'Chef profile updated', profile };
  }

  @Delete(':id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  remove(
    @Param('id') id: string,
    @Query('hard') hard?: string,
  ) {
    return this.chefProfileService.remove(id, hard === 'true');
  }

  @Post(':id/recompute')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  recompute(@Param('id') id: string) {
    return this.chefProfileService.recompute(id);
  }
}
