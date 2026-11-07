import {
  Body,
  Controller,
  Get,
  Headers,
  Put,
  UseGuards,
} from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { GetUser } from '../../common/decorators/Get.user.decorator';
import { Roles } from '../../common/decorators/role.decorators';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { OptionalJwtAuthGuard } from '../../common/guards/optional-jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { getClientVersion } from '../../common/http/client-version';
import {
  ApiJwtRoles,
  ApiOptionalJwt,
} from '../../common/swagger/api-auth.decorators';
import { UserRole } from '../../database/schemas/user.auth.schema';
import { AppConfigService } from './app-config.service';

@ApiTags('App config')
@Controller('app-config')
export class AppConfigController {
  constructor(private readonly appConfigService: AppConfigService) {}

  @Get()
  @UseGuards(OptionalJwtAuthGuard)
  @ApiOptionalJwt()
  @ApiOperation({
    summary: 'Switches for this app',
    description:
      'Which redesigned areas this viewer should see, as booleans: `{ version, redesign: { entry, plans, home, kitchen, shopping, cookbook, make, tips, track } }`. Uses the optional JWT (for percentage rollout and allow lists) and the `X-App-Version` header (for minimum versions). Before sign-in only `entry` and `plans` can be on, and only at 100%. Anything missing is off.',
  })
  @ApiOkResponse({ description: '`{ version, redesign }`.' })
  async getConfig(
    @GetUser() user: { userId?: string } | null,
    @Headers() headers: Record<string, string | string[] | undefined>,
  ) {
    return this.appConfigService.getFlags({
      userId: user?.userId ?? null,
      appVersion: getClientVersion(headers),
    });
  }

  @Get('rules')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @ApiJwtRoles()
  @ApiOperation({
    summary: 'Redesign rollout rules (admin)',
    description:
      'Per area: `{ enabled, percent (0–100), allowUserIds, minAppVersion }`. Requires JWT and role `admin`.',
  })
  async getRules() {
    return this.appConfigService.getRules();
  }

  @Put('rules')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @ApiJwtRoles()
  @ApiOperation({
    summary: 'Update redesign rollout rules (admin)',
    description:
      'Replaces the rules. Body: area → `{ enabled, percent, allowUserIds, minAppVersion }`. Bad values are cleaned (percent clamped to 0–100, unknown areas dropped). Takes effect within 30 seconds; apps pick it up on their next cold start. Requires JWT and role `admin`.',
  })
  async updateRules(
    @Body() body: Record<string, unknown>,
    @GetUser() user: { userId?: string } | null,
  ) {
    return this.appConfigService.updateRules(body?.rules ?? body, user?.userId);
  }
}
