import { Controller, Get, NotFoundException, Param, Res } from '@nestjs/common';
import type { Response } from 'express';
import {
  ApiTags,
  ApiOperation,
  ApiParam,
  ApiResponse,
} from '@nestjs/swagger';
import {
  APP_DEEP_LINK_PATHS,
  AppDeepLinkDestination,
  buildAppUniversalLink,
} from '../../common/email/app-deep-links';

const DESTINATION_SET = new Set<string>(Object.keys(APP_DEEP_LINK_PATHS));

@ApiTags('Deeplink')
@Controller('deeplink')
export class DeeplinkController {
  @Get(':destination')
  @ApiOperation({
    summary: 'Redirect to app universal link',
    description:
      'Public. Path `:destination` must be a known app destination (currently `inventory`). Responds 302 to the corresponding universal link (e.g. https://app.saveful.com/inventory). Used from emails via `/api/deeplink/:destination`. Unknown destinations return 404. Implemented with `@Res()`.',
  })
  @ApiParam({
    name: 'destination',
    description:
      'App destination key. Allowed values are the keys of APP_DEEP_LINK_PATHS (currently `inventory`).',
    example: 'inventory',
  })
  @ApiResponse({
    status: 302,
    description: 'Redirect to the app universal link for that destination. No JSON body.',
  })
  @ApiResponse({
    status: 404,
    description: 'Unknown deeplink destination.',
  })
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
