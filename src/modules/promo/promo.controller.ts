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

// Global prefix is `api`, so these resolve to `/api/promos/...`. Do not add an
// `api/` segment here — a few older controllers did and are served at /api/api.
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
  async findAll() {
    return this.promoService.findAll();
  }

  @Get(':id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
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
  async uploadImage(@UploadedFile() file: Express.Multer.File) {
    if (!file) throw new BadRequestException('No image file provided');
    const result = await this.promoService.uploadImage(file);
    return { message: 'Image uploaded', result };
  }

  @Post()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  async create(@Body() dto: CreatePromoDto) {
    const result = await this.promoService.create(dto);
    return { message: 'Promo card created', result };
  }

  @Patch(':id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  async update(@Param('id') id: string, @Body() dto: UpdatePromoDto) {
    const result = await this.promoService.update(id, dto);
    return { message: 'Promo card updated', result };
  }

  @Patch(':id/toggle-active')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  async toggleActive(@Param('id') id: string) {
    const result = await this.promoService.toggleActive(id);
    return { message: 'Promo card updated', result };
  }

  @Delete(':id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  async remove(@Param('id') id: string) {
    const result = await this.promoService.remove(id);
    return { message: 'Promo card deleted', result };
  }
}
