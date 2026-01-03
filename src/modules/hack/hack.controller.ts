import {
  Body,
  Get,
  Controller,
  Post,
  UploadedFiles,
  UseGuards,
  UseInterceptors,
  Param,
  Req,
  Res,
  Put,
  Delete,
} from '@nestjs/common';
import { CreateHackCategoryDto } from './dto/Create.hack.category.dto';
import { RolesGuard } from 'src/common/guards/roles.guard';
import { JwtAuthGuard } from 'src/common/guards/jwt-auth.guard';
import { Roles } from 'src/common/decorators/role.decorators';
import { UserRole } from 'src/database/schemas/user.auth.schema';
import {
  FileFieldsInterceptor,
  FileInterceptor,
} from '@nestjs/platform-express';
import { HackService } from './hack.service';
import { GetUser } from 'src/common/decorators/Get.user.decorator';
import { generate } from 'rxjs';
import { generateETag } from 'src/common/http/etag.utils';
import { Request, Response } from 'express';
import { CreateHackDto } from './dto/Create.hack.dto';
import { UpdateHackDto } from './dto/Update.hack.dto';

@Controller('hack')
export class HackController {
  constructor(private readonly hackService: HackService) {}
  @Post('category')
  @Roles('ADMIN', 'CHEF')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @UseInterceptors(FileFieldsInterceptor([
    { name: 'heroImage', maxCount: 1 },
    { name: 'iconImage', maxCount: 1 }
  ]))
  async createHackCategory(
    @Body() dto: CreateHackCategoryDto,
    @UploadedFiles() files: { heroImage: Express.Multer.File[]; iconImage: Express.Multer.File[] },
    @GetUser() user: any,
  ) {
    console.log(user);
    return this.hackService.createHackCategory(dto, files);
  }

  @Get('category')
  async getHackCategories() {
    return this.hackService.getAllCategory();
  }

  @Get('category/:id')
  async getALLHacksByCategoryId(
    @Param('id') categoryId: string,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    const data = await this.hackService.getHacksByCategoryId(categoryId);
    const etag = generateETag(data);
    const clientEtag = req.headers['if-none-match'];
    if (clientEtag == etag) {
      res.status(304).end();
    }
    res.setHeader('Etag', etag);
    res.setHeader('Cache-Control', 'private,must-revalidate');
    return res.json(data);
  }

  @Post('')
  @Roles(UserRole.ADMIN, UserRole.CHEF)
  @UseGuards(JwtAuthGuard, RolesGuard)
  @UseInterceptors(
    FileFieldsInterceptor([
      { name: 'thumbnailImage', maxCount: 1 },
      { name: 'heroImage', maxCount: 1 },
      { name: 'iconImage', maxCount: 1 },
    ]),
  )
  async createHack(
    @Body() dto: CreateHackDto,
    @UploadedFiles()
    files: {
      thumbnailImage?: Express.Multer.File[];
      heroImage?: Express.Multer.File[];
      iconImage?: Express.Multer.File[];
    },
  ) {
    return this.hackService.createHack(dto, files);
  }

  @Get(':id')
  async getHackById(@Param('id') hackId: string) {
    return this.hackService.getHackById(hackId);
  }

  @Put(':id')
  @Roles(UserRole.ADMIN, UserRole.CHEF)
  @UseGuards(JwtAuthGuard, RolesGuard)
  @UseInterceptors(
    FileFieldsInterceptor([
      { name: 'thumbnailImage', maxCount: 1 },
      { name: 'heroImage', maxCount: 1 },
      { name: 'iconImage', maxCount: 1 },
    ]),
  )
  async updateHack(
    @Param('id') hackId: string,
    @Body() dto: UpdateHackDto,
    @UploadedFiles()
    files?: {
      thumbnailImage?: Express.Multer.File[];
      heroImage?: Express.Multer.File[];
      iconImage?: Express.Multer.File[];
    },
  ) {
    return this.hackService.updateHack(hackId, dto, files);
  }

  @Delete(':id')
  @Roles(UserRole.ADMIN, UserRole.CHEF)
  @UseGuards(JwtAuthGuard, RolesGuard)
  async deleteHack(@Param('id') hackId: string) {
    return this.hackService.deleteHack(hackId);
  }

  @Get('/basir')
  async FetchBasir() {}
}
