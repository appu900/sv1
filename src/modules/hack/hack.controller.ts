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
import {
  ApiTags,
  ApiOperation,
  ApiParam,
  ApiBody,
  ApiConsumes,
  ApiOkResponse,
  ApiCreatedResponse,
} from '@nestjs/swagger';
import { CreateHackCategoryDto } from './dto/Create.hack.category.dto';
import { RolesGuard } from 'src/common/guards/roles.guard';
import { JwtAuthGuard } from 'src/common/guards/jwt-auth.guard';
import { Roles } from 'src/common/decorators/role.decorators';
import { UserRole } from 'src/database/schemas/user.auth.schema';
import {
  FileFieldsInterceptor,
  FileInterceptor,
  AnyFilesInterceptor,
} from '@nestjs/platform-express';
import { HackService } from './hack.service';
import { GetUser } from 'src/common/decorators/Get.user.decorator';
import { generate } from 'rxjs';
import { generateETag } from 'src/common/http/etag.utils';
import { Request, Response } from 'express';
import { CreateHackDto } from './dto/Create.hack.dto';
import { UpdateHackDto } from './dto/Update.hack.dto';
import { ApiJwtRoles } from 'src/common/swagger/api-auth.decorators';

const HACK_CATEGORY_MULTIPART_PROPERTIES = {
  name: { type: 'string', description: 'Hack category display name.' },
  heroImage: {
    type: 'string',
    format: 'binary',
    description: 'Category hero image file.',
  },
  iconImage: {
    type: 'string',
    format: 'binary',
    description: 'Category icon image file.',
  },
};

const HACK_ARTICLE_MULTIPART_PROPERTIES = {
  title: { type: 'string', description: 'Hack article title.' },
  shortDescription: { type: 'string', description: 'Short card blurb.' },
  categoryId: { type: 'string', description: 'Hack category ObjectId.' },
  sponsorId: { type: 'string', description: 'Optional sponsor ObjectId.' },
  leadText: { type: 'string', description: 'Lead / intro text.' },
  description: { type: 'string', description: 'Long-form description.' },
  articleBlocks: {
    type: 'string',
    description: 'JSON array of article blocks (text, image, video, list, accordion, etc.).',
  },
  thumbnailImage: {
    type: 'string',
    format: 'binary',
    description: 'Hack thumbnail image file.',
  },
  heroImage: {
    type: 'string',
    format: 'binary',
    description: 'Hack hero image file.',
  },
  iconImage: {
    type: 'string',
    format: 'binary',
    description: 'Hack icon image file.',
  },
};

@ApiTags('Hacks')
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
  @ApiJwtRoles('Requires admin or chef role.')
  @ApiConsumes('multipart/form-data')
  @ApiOperation({
    summary: 'Create a hack category',
    description:
      'Creates a kitchen-hack category with a name plus optional hero and icon images. Requires admin or chef.',
  })
  @ApiBody({
    schema: { type: 'object', properties: HACK_CATEGORY_MULTIPART_PROPERTIES },
  })
  @ApiCreatedResponse({ description: 'Hack category created.' })
  async createHackCategory(
    @Body() dto: CreateHackCategoryDto,
    @UploadedFiles() files: { heroImage: Express.Multer.File[]; iconImage: Express.Multer.File[] },
    @GetUser() user: any,
  ) {
    console.log(user);
    return this.hackService.createHackCategory(dto, files);
  }

  @Get('category')
  @ApiOperation({
    summary: 'List hack categories',
    description: 'Returns all kitchen-hack categories. Public; no auth required.',
  })
  @ApiOkResponse({ description: 'Array of hack categories.' })
  async getHackCategories() {
    return this.hackService.getAllCategory();
  }

  @Get('category/:id')
  @ApiOperation({
    summary: 'List hacks in a category',
    description:
      'Returns hack articles for the given category. Responds with `ETag` / `Cache-Control` and `304 Not Modified` when `If-None-Match` matches.',
  })
  @ApiParam({ name: 'id', description: 'Hack category ObjectId.' })
  @ApiOkResponse({ description: 'Hacks in the category (or 304 when ETag matches).' })
  async getALLHacksByCategoryId(
    @Param('id') categoryId: string,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    const data = await this.hackService.getHacksByCategoryId(categoryId);
    const etag = generateETag(data);
    const clientEtag = req.headers['if-none-match'];
    if (clientEtag == etag) {
      return res.status(304).end();
    }
    res.setHeader('Etag', etag);
    res.setHeader('Cache-Control', 'private,must-revalidate');
    return res.json(data);
  }

  @Delete('category/:id')
  @Roles(UserRole.ADMIN, UserRole.CHEF)
  @UseGuards(JwtAuthGuard, RolesGuard)
  @ApiJwtRoles('Requires admin or chef role.')
  @ApiOperation({
    summary: 'Delete a hack category',
    description: 'Deletes a hack category by id. Requires admin or chef.',
  })
  @ApiParam({ name: 'id', description: 'Hack category ObjectId.' })
  @ApiOkResponse({ description: 'Hack category deleted.' })
  async deleteHackCategory(@Param('id') categoryId: string) {
    return this.hackService.deleteCategory(categoryId);
  }

  @Put('category/:id')
  @Roles(UserRole.ADMIN, UserRole.CHEF)
  @UseGuards(JwtAuthGuard, RolesGuard)
  @UseInterceptors(FileFieldsInterceptor([
    { name: 'heroImage', maxCount: 1 },
    { name: 'iconImage', maxCount: 1 }
  ]))
  @ApiJwtRoles('Requires admin or chef role.')
  @ApiConsumes('multipart/form-data')
  @ApiOperation({
    summary: 'Update a hack category',
    description:
      'Updates a hack category name and/or images. Optional new `heroImage` / `iconImage` replace stored assets. Requires admin or chef.',
  })
  @ApiParam({ name: 'id', description: 'Hack category ObjectId.' })
  @ApiBody({
    schema: { type: 'object', properties: HACK_CATEGORY_MULTIPART_PROPERTIES },
  })
  @ApiOkResponse({ description: 'Updated hack category.' })
  async updateHackCategory(
    @Param('id') categoryId: string,
    @Body() dto: CreateHackCategoryDto,
    @UploadedFiles() files?: { heroImage?: Express.Multer.File[]; iconImage?: Express.Multer.File[] },
  ) {
    return this.hackService.updateCategory(categoryId, dto, files);
  }

  @Post('')
  @Roles(UserRole.ADMIN, UserRole.CHEF)
  @UseGuards(JwtAuthGuard, RolesGuard)
  @UseInterceptors(AnyFilesInterceptor())
  @ApiJwtRoles('Requires admin or chef role.')
  @ApiConsumes('multipart/form-data')
  @ApiOperation({
    summary: 'Create a hack article',
    description:
      'Creates a kitchen-hack article with article blocks. Accepts any files; the service reads `thumbnailImage`, `heroImage`, and `iconImage` by field name, plus extra files used as article-block thumbnails. `articleBlocks` may be a JSON string. Requires admin or chef.',
  })
  @ApiBody({
    schema: { type: 'object', properties: HACK_ARTICLE_MULTIPART_PROPERTIES },
  })
  @ApiCreatedResponse({ description: 'Hack created successfully.' })
  async createHack(
    @Body() dto: CreateHackDto,
    @UploadedFiles() files: Express.Multer.File[],
  ) {
    return this.hackService.createHack(dto, files);
  }

  @Get(':id')
  @ApiOperation({
    summary: 'Get hack by id',
    description: 'Returns a single hack article by Mongo ObjectId.',
  })
  @ApiParam({ name: 'id', description: 'Hack article ObjectId.' })
  @ApiOkResponse({ description: 'Hack article document.' })
  async getHackById(@Param('id') hackId: string) {
    return this.hackService.getHackById(hackId);
  }

  @Put(':id')
  @Roles(UserRole.ADMIN, UserRole.CHEF)
  @UseGuards(JwtAuthGuard, RolesGuard)
  @UseInterceptors(AnyFilesInterceptor())
  @ApiJwtRoles('Requires admin or chef role.')
  @ApiConsumes('multipart/form-data')
  @ApiOperation({
    summary: 'Update a hack article',
    description:
      'Partial update of a hack article. Accepts any files; the service reads `thumbnailImage`, `heroImage`, and `iconImage` by field name. Requires admin or chef.',
  })
  @ApiParam({ name: 'id', description: 'Hack article ObjectId.' })
  @ApiBody({
    schema: { type: 'object', properties: HACK_ARTICLE_MULTIPART_PROPERTIES },
  })
  @ApiOkResponse({ description: 'Updated hack article.' })
  async updateHack(
    @Param('id') hackId: string,
    @Body() dto: UpdateHackDto,
    @UploadedFiles() files: Express.Multer.File[],
  ) {
    return this.hackService.updateHack(hackId, dto, files);
  }

  @Delete(':id')
  @Roles(UserRole.ADMIN, UserRole.CHEF)
  @UseGuards(JwtAuthGuard, RolesGuard)
  @ApiJwtRoles('Requires admin or chef role.')
  @ApiOperation({
    summary: 'Delete a hack article',
    description: 'Deletes a hack article by id. Requires admin or chef.',
  })
  @ApiParam({ name: 'id', description: 'Hack article ObjectId.' })
  @ApiOkResponse({ description: 'Hack article deleted.' })
  async deleteHack(@Param('id') hackId: string) {
    return this.hackService.deleteHack(hackId);
  }

  @Get('/basir')
  @ApiOperation({
    summary: 'Fetch Basir placeholder',
    description:
      'Empty placeholder handler (`FetchBasir`). Currently returns an empty 200 with no body. Declared after `GET /hack/:id`, so a live request to `/hack/basir` is typically handled by `getHackById` with `id=basir` rather than this method.',
  })
  @ApiOkResponse({ description: 'Empty response (handler has no implementation).' })
  async FetchBasir() {}
}
