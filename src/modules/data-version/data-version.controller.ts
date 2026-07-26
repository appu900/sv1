import { Controller, Get, Req, Res } from '@nestjs/common';
import { Request, Response } from 'express';
import { generateETag } from '../../common/http/etag.utils';
import { DataVersionService } from './data-version.service';

/**
 * Roughly 100 bytes. Clients poll this on foreground and screen focus, then
 * refetch only the collections whose version differs from the one on disk.
 */
@Controller('data-version')
export class DataVersionController {
  constructor(private readonly dataVersionService: DataVersionService) {}

  @Get()
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
