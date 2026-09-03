import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors,
  BadRequestException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiBody,
  ApiConsumes,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger';
import { Request, Response } from 'express';
import { PromoService } from './promo.service';
import { CreatePromoDto } from './dto/create-promo.dto';
import { UpdatePromoDto } from './dto/update-promo.dto';
import { PromoQueryDto } from './dto/promo-query.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { OptionalJwtAuthGuard } from '../../common/guards/optional-jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/role.decorators';
import { GetUser } from '../../common/decorators/Get.user.decorator';
import { UserRole } from '../../database/schemas/user.auth.schema';
import { generateETag } from '../../common/http/etag.utils';
import { PromoPlatform } from '../../database/schemas/promo-card.schema';
import { ApiJwtRoles, ApiOptionalJwt } from '../../common/swagger/api-auth.decorators';

// Global prefix is `api`, so these resolve to `/api/promos/...`. Do not add an
// `api/` segment here — a few older controllers did and are served at /api/api.
@ApiTags('Promos')
@Controller('promos')
export class PromoController {
  constructor(private readonly promoService: PromoService) {}

  /**
   * Every card the caller qualifies for, across all placements, in one call.
   * Slots live on a dozen screens, so a per-screen fetch would add a request to
   * every navigation; the app caches this and each `<PromoSlot>` picks its own.
   *
   * Declared before `:id` so "active" is not captured as an id.
   */
  @Get('active')
  @UseGuards(OptionalJwtAuthGuard)
  @ApiOptionalJwt()
  @ApiOperation({
    summary: 'Active promo cards for the viewer',
    description:
      'Returns every promo card the caller qualifies for across all placements. Optional JWT personalises by membership, plan, and country (anonymous callers still get public cards). Filter with `platform` (ios|android) and `appVersion`. Response is private-cacheable with ETag / If-None-Match (304 when unchanged). Declared before `:id` so `active` is not treated as an id.',
  })
  @ApiQuery({
    name: 'platform',
    required: false,
    enum: PromoPlatform,
    description: 'Client platform used for audience matching (`ios` or `android`).',
  })
  @ApiQuery({
    name: 'appVersion',
    required: false,
    description: 'App version string used against min/max audience version rules.',
  })
  @ApiQuery({
    name: 'v',
    required: false,
    description: 'Data-version pin for the immutable cache path.',
  })
  @ApiOkResponse({
    description: 'Qualified promo cards, or 304 Not Modified when If-None-Match matches.',
  })
  async getActive(
    @Req() req: Request,
    @Res() res: Response,
    @Query() query: PromoQueryDto,
    @GetUser() user: { userId: string } | null,
  ) {
    const cards = await this.promoService.findForViewer(
      user?.userId ?? null,
      query.platform ?? null,
      query.appVersion ?? null,
    );

    // Personalised by membership, plan and country, so this must never land in
    // a shared cache — `private` here rather than the `public` that
    // sendCacheableJson emits for the anonymous collection endpoints.
    const etag = generateETag(cards);
    res.setHeader('ETag', etag);
    res.setHeader('Cache-Control', 'private, no-cache');
    res.vary('Authorization');

    if (req.headers['if-none-match'] === etag) {
      return res.status(304).end();
    }
    return res.json(cards);
  }

  // ---------------------------------------------------------------- admin

  @Get()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @ApiJwtRoles()
  @ApiOperation({
    summary: 'List all promo cards',
    description:
      'Admin catalogue of every promo card (active and inactive). Requires JWT and role `admin`.',
  })
  @ApiOkResponse({ description: 'All promo cards.' })
  async findAll() {
    return this.promoService.findAll();
  }

  @Get(':id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @ApiJwtRoles()
  @ApiOperation({
    summary: 'Get promo card by id',
    description:
      'Admin fetch of a single promo card. Requires JWT and role `admin`.',
  })
  @ApiParam({ name: 'id', description: 'Promo card Mongo ObjectId.' })
  @ApiOkResponse({ description: 'Promo card document.' })
  async findById(@Param('id') id: string) {
    return this.promoService.findById(id);
  }

  /**
   * Separate from the card body so create/update stay pure JSON: nested DTOs do
   * not survive multipart encoding without hand-rolled parsing. Returns the
   * HeroImage descriptor, which the admin echoes back in `content.image`.
   */
  @Post('image')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @UseInterceptors(FileInterceptor('image'))
  @ApiJwtRoles()
  @ApiConsumes('multipart/form-data')
  @ApiOperation({
    summary: 'Upload promo image',
    description:
      'Admin uploads a promo hero image separately from card JSON. Field name must be `image`. Returns a HeroImage descriptor to echo back in `content.image` on create/update. Requires JWT and role `admin`.',
  })
  @ApiBody({
    schema: {
      type: 'object',
      required: ['image'],
      properties: {
        image: {
          type: 'string',
          format: 'binary',
          description: 'Promo image file (field name `image`).',
        },
      },
    },
  })
  @ApiCreatedResponse({ description: 'Image uploaded; HeroImage descriptor in `result`.' })
  async uploadImage(@UploadedFile() file: Express.Multer.File) {
    if (!file) throw new BadRequestException('No image file provided');
    const result = await this.promoService.uploadImage(file);
    return { message: 'Image uploaded', result };
  }

  @Post()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @ApiJwtRoles()
  @ApiOperation({
    summary: 'Create a promo card',
    description:
      'Admin creates a promo card (placement, audience, schedule, content, style, behaviour). Upload images via POST /promos/image first, then pass the returned descriptor in `content.image`. Requires JWT and role `admin`.',
  })
  @ApiBody({ type: CreatePromoDto })
  @ApiCreatedResponse({ description: 'Promo card created.' })
  async create(@Body() dto: CreatePromoDto) {
    const result = await this.promoService.create(dto);
    return { message: 'Promo card created', result };
  }

  @Patch(':id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @ApiJwtRoles()
  @ApiOperation({
    summary: 'Update a promo card',
    description:
      'Admin partial update of a promo card. Requires JWT and role `admin`.',
  })
  @ApiParam({ name: 'id', description: 'Promo card Mongo ObjectId.' })
  @ApiBody({ type: UpdatePromoDto })
  @ApiOkResponse({ description: 'Promo card updated.' })
  async update(@Param('id') id: string, @Body() dto: UpdatePromoDto) {
    const result = await this.promoService.update(id, dto);
    return { message: 'Promo card updated', result };
  }

  @Patch(':id/toggle-active')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @ApiJwtRoles()
  @ApiOperation({
    summary: 'Toggle promo active flag',
    description:
      'Admin flips `isActive` on a promo card without sending the rest of the body. Requires JWT and role `admin`.',
  })
  @ApiParam({ name: 'id', description: 'Promo card Mongo ObjectId.' })
  @ApiOkResponse({ description: 'Promo card active flag toggled.' })
  async toggleActive(@Param('id') id: string) {
    const result = await this.promoService.toggleActive(id);
    return { message: 'Promo card updated', result };
  }

  @Delete(':id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @ApiJwtRoles()
  @ApiOperation({
    summary: 'Delete a promo card',
    description:
      'Admin deletes a promo card. Requires JWT and role `admin`.',
  })
  @ApiParam({ name: 'id', description: 'Promo card Mongo ObjectId.' })
  @ApiOkResponse({ description: 'Promo card deleted.' })
  async remove(@Param('id') id: string) {
    const result = await this.promoService.remove(id);
    return { message: 'Promo card deleted', result };
  }
}
