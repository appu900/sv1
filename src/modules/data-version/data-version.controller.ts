import { Controller, Get, Req, Res } from '@nestjs/common';
import { Request, Response } from 'express';
import {
  ApiTags,
  ApiOperation,
  ApiHeader,
  ApiOkResponse,
  ApiResponse,
} from '@nestjs/swagger';
import { generateETag } from '../../common/http/etag.utils';
import { DataVersionService } from './data-version.service';

/**
 * Roughly 100 bytes. Clients poll this on foreground and screen focus, then
 * refetch only the collections whose version differs from the one on disk.
 */
@ApiTags('Data Version')
@Controller('data-version')
export class DataVersionController {
  constructor(private readonly dataVersionService: DataVersionService) {}

  @Get()
  @ApiOperation({
    summary: 'Get collection version manifest',
    description:
      'Public. Returns a small JSON manifest of version counters for recipes, ingredients, frameworkCategories, stickers, chefs, and promoCards. Clients poll on foreground/focus and refetch only collections whose version changed. Sends an ETag; if the request includes `If-None-Match` matching that ETag, responds 304 with no body. Implemented with `@Res()` so headers are set directly.',
  })
  @ApiHeader({
    name: 'If-None-Match',
    required: false,
    description:
      'Previous ETag from this endpoint. When it matches the current manifest ETag, the server returns 304 Not Modified.',
  })
  @ApiOkResponse({
    description:
      'JSON manifest `{ recipes, ingredients, frameworkCategories, stickers, chefs, promoCards }` plus `ETag` and `Cache-Control: no-cache`.',
  })
  @ApiResponse({
    status: 304,
    description: 'Not Modified — `If-None-Match` matched the current ETag. Empty body; ETag is still set.',
  })
  async getDataVersion(@Req() req: Request, @Res() res: Response) {
    const manifest = await this.dataVersionService.getManifest();
    const etag = generateETag(manifest);

    if (req.headers['if-none-match'] === etag) {
      res.setHeader('ETag', etag);
      res.setHeader('Cache-Control', 'no-cache');
      return res.status(304).end();
    }

    res.setHeader('ETag', etag);
    res.setHeader('Cache-Control', 'no-cache');
    return res.json(manifest);
  }
}
