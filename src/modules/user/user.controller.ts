import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Patch,
  Post,
  Put,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiOkResponse, ApiBody } from '@nestjs/swagger';
import { UserService } from './user.service';
import { GetUser } from 'src/common/decorators/Get.user.decorator';
import { JwtAuthGuard } from 'src/common/guards/jwt-auth.guard';
import { UserProfileDto } from './dto/user.profile.dto';
import { AuthGuard } from '@nestjs/passport';
import { ApiJwtAuth } from 'src/common/swagger/api-auth.decorators';

@ApiTags('User')
@ApiJwtAuth()
@Controller('user')
export class UserController {
  constructor(private readonly userService: UserService) {}

  @Get('me')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({
    summary: 'Get current user document',
    description:
      'Authenticated user (JWT). Returns the raw user record for the caller (findById). Prefer GET /auth/me when the client needs the flattened dietary/profile shape used by the app.',
  })
  @ApiOkResponse({ description: 'User document for the authenticated userId.' })
  async getme(@GetUser() user: any) {
    return this.userService.findById(user.userId);
  }

  @Put('profile')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({
    summary: 'Update dietary profile',
    description:
      'Authenticated user (JWT). Body: UserProfileDto (vegType, allergy flags, country, timezone, household counts, pincode). Same persistence as PUT /auth/dietary-profile. Returns the updated user document. 401 if the JWT has no userId.',
  })
  @ApiOkResponse({ description: 'Updated user document including dietaryProfile.' })
  async updateProfile(@Body() dto: UserProfileDto, @GetUser() user: any) {
    const userId = user.userId;
    if (!userId) throw new UnauthorizedException();
    return this.userService.updateProfile(dto, userId);
  }

  @Post('timezone')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Update IANA timezone',
    description:
      'Authenticated user (JWT). Body: `{ timezone }` (e.g. Australia/Sydney). Stores the timezone on the user for local-time notifications and usage periods. Returns `{ ok: true }`.',
  })
  @ApiBody({
    schema: {
      type: 'object',
      required: ['timezone'],
      properties: {
        timezone: {
          type: 'string',
          description: 'IANA timezone, e.g. Australia/Sydney or Asia/Kolkata.',
        },
      },
    },
  })
  @ApiOkResponse({ description: '`{ ok: true }` after timezone is saved.' })
  async updateTimezone(
    @Body() body: { timezone: string },
    @GetUser() user: any,
  ) {
    const userId = user.userId;
    if (!userId) throw new UnauthorizedException();
    return this.userService.updateTimezone(userId, body.timezone);
  }

  @Patch('email-marketing')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Update email marketing opt-in',
    description:
      'Authenticated user (JWT). Body: `{ isUserSubscribed }` (boolean). Sets whether the user receives Saveful marketing emails. Returns `{ ok: true }`.',
  })
  @ApiBody({
    schema: {
      type: 'object',
      required: ['isUserSubscribed'],
      properties: {
        isUserSubscribed: {
          type: 'boolean',
          description: 'Whether the user opts in to Saveful marketing emails.',
        },
      },
    },
  })
  @ApiOkResponse({ description: '`{ ok: true }` after the marketing flag is saved.' })
  async updateEmailMarketing(
    @Body() body: { isUserSubscribed: boolean },
    @GetUser() user: any,
  ) {
    const userId = user.userId;
    if (!userId) throw new UnauthorizedException();
    return this.userService.updateEmailMarketing(userId, body.isUserSubscribed);
  }
}
