import { Controller, Get, NotFoundException, Param, Res } from '@nestjs/common';
import type { Response } from 'express';
import {
  APP_DEEP_LINK_PATHS,
  AppDeepLinkDestination,
  buildAppUniversalLink,
} from '../../common/email/app-deep-links';

const DESTINATION_SET = new Set<string>(Object.keys(APP_DEEP_LINK_PATHS));

@Controller('deeplink')
export class DeeplinkController {
  @Get(':destination')
  open(
    @Param('destination') destination: string,
    @Res() res: Response,
  ): void {
    if (!DESTINATION_SET.has(destination)) {
      throw new NotFoundException('Unknown deeplink destination');
    }
    res.redirect(302, buildAppUniversalLink(destination as AppDeepLinkDestination));
  }
}
