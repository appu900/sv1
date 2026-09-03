import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  UseGuards,
  UseInterceptors,
  UploadedFile,
  UploadedFiles,
  Query,
} from '@nestjs/common';
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
import { BadgesService } from './badges.service';
import { CreateBadgeDto } from './dto/create-badge.dto';
import { UpdateBadgeDto } from './dto/update-badge.dto';
import { AwardBadgeDto } from './dto/award-badge.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/role.decorators';
import { UserRole } from '../../database/schemas/user.auth.schema';
import { GetUser } from '../../common/decorators/Get.user.decorator';
import { FileInterceptor, FilesInterceptor, FileFieldsInterceptor } from '@nestjs/platform-express';
import { ImageUploadService } from '../image-upload/image-upload.service';
import { ApiJwtAuth, ApiJwtRoles } from '../../common/swagger/api-auth.decorators';

const badgeFileProperties = {
  badgeImage: {
    type: 'string',
    format: 'binary',
    description: 'Badge artwork (field name `badgeImage`). Uploaded to saveful/badges and stored as imageUrl.',
  },
  sponsorLogo: {
    type: 'string',
    format: 'binary',
    description: 'Sponsor logo (field name `sponsorLogo`). Uploaded to saveful/badges/sponsors and stored as sponsorLogoUrl.',
  },
};

const badgeFormProperties = {
  name: { type: 'string' },
  description: { type: 'string' },
  imageUrl: { type: 'string', description: 'Existing image URL if not uploading badgeImage.' },
  category: {
    type: 'string',
    enum: [
      'ONBOARDING',
      'USAGE',
      'COOKING',
      'MONEY_SAVED',
      'FOOD_SAVED',
      'PLANNING',
      'BONUS',
      'SPONSOR',
      'CHALLENGE_WINNER',
      'SPECIAL',
    ],
  },
  milestoneType: { type: 'string' },
  milestoneThreshold: { type: 'number' },
  metricType: { type: 'string' },
  rarityScore: { type: 'number' },
  iconColor: { type: 'string' },
  challengeId: { type: 'string' },
  isActive: { type: 'boolean' },
  isSponsorBadge: { type: 'boolean' },
  sponsorName: { type: 'string' },
  sponsorLogoUrl: { type: 'string' },
  sponsorCountries: {
    type: 'string',
    description: 'JSON array of ISO country codes, e.g. ["AU","IN"].',
  },
  sponsorValidFrom: { type: 'string', format: 'date-time' },
  sponsorValidUntil: { type: 'string', format: 'date-time' },
  sponsorMetadata: { type: 'string', description: 'JSON object of sponsor campaign metadata.' },
  ...badgeFileProperties,
};

@ApiTags('Badges')
@Controller('badges')
export class BadgesController {
  constructor(
    private readonly badgesService: BadgesService,
    private readonly imageUploadService: ImageUploadService,
  ) {}


  @Post()
  @Roles(UserRole.ADMIN)
  @UseGuards(JwtAuthGuard, RolesGuard)
  @UseInterceptors(FileFieldsInterceptor([
    { name: 'badgeImage', maxCount: 1 },
    { name: 'sponsorLogo', maxCount: 1 },
  ]))
  @ApiJwtRoles()
  @ApiConsumes('multipart/form-data')
  @ApiOperation({
    summary: 'Create a badge',
    description:
      'Admin creates a catalogue badge. Send `multipart/form-data` so optional `badgeImage` and `sponsorLogo` files can be uploaded (stored as imageUrl / sponsorLogoUrl). Requires JWT and role `admin`.',
  })
  @ApiBody({
    schema: {
      type: 'object',
      required: ['name', 'description', 'category'],
      properties: badgeFormProperties,
    },
  })
  @ApiCreatedResponse({ description: 'Badge created.' })
  async createBadge(
    @Body() dto: CreateBadgeDto,
    @UploadedFiles() files?: { badgeImage?: Express.Multer.File[], sponsorLogo?: Express.Multer.File[] },
  ) {
    if (files?.badgeImage?.[0]) {
      const imageUrl = await this.imageUploadService.uploadFile(
        files.badgeImage[0],
        'saveful/badges',
      );
      dto.imageUrl = imageUrl;
    }

    if (files?.sponsorLogo?.[0]) {
      const logoUrl = await this.imageUploadService.uploadFile(
        files.sponsorLogo[0],
        'saveful/badges/sponsors',
      );
      dto.sponsorLogoUrl = logoUrl;
    }

    const badge = await this.badgesService.createBadge(dto);
    return { badge };
  }

  @Get()
  @UseGuards(JwtAuthGuard)
  @ApiJwtAuth()
  @ApiOperation({
    summary: 'Badge catalogue',
    description:
      'Lists catalogue badges. By default inactive badges are hidden; pass `includeInactive=true` to include them. Requires JWT.',
  })
  @ApiQuery({
    name: 'includeInactive',
    required: false,
    description: 'Set to `true` to include inactive badges.',
  })
  @ApiOkResponse({ description: 'Badge catalogue.' })
  async getAllBadges(@Query('includeInactive') includeInactive?: string) {
    const badges = await this.badgesService.getAllBadges(includeInactive === 'true');
    return { badges };
  }

  @Get('category/:category')
  @UseGuards(JwtAuthGuard)
  @ApiJwtAuth()
  @ApiOperation({
    summary: 'Badges by category',
    description:
      'Filters the catalogue by BadgeCategory (ONBOARDING, USAGE, COOKING, MONEY_SAVED, FOOD_SAVED, PLANNING, BONUS, SPONSOR, CHALLENGE_WINNER, SPECIAL). Requires JWT.',
  })
  @ApiParam({
    name: 'category',
    description: 'BadgeCategory enum value.',
    enum: [
      'ONBOARDING',
      'USAGE',
      'COOKING',
      'MONEY_SAVED',
      'FOOD_SAVED',
      'PLANNING',
      'BONUS',
      'SPONSOR',
      'CHALLENGE_WINNER',
      'SPECIAL',
    ],
  })
  @ApiOkResponse({ description: 'Badges in the requested category.' })
  async getBadgesByCategory(@Param('category') category: string) {
    const badges = await this.badgesService.getBadgesByCategory(category as any);
    return { badges };
  }

  @Get('sponsor')
  @UseGuards(JwtAuthGuard)
  @ApiJwtAuth()
  @ApiOperation({
    summary: 'Sponsor badges',
    description:
      'Returns active sponsor badges, optionally filtered to a country ISO code. Requires JWT.',
  })
  @ApiQuery({
    name: 'country',
    required: false,
    description: 'ISO country code (e.g. AU, IN) to filter sponsor eligibility.',
  })
  @ApiOkResponse({ description: 'Sponsor badges for the requested country (or all).' })
  async getSponsorBadges(@Query('country') country?: string) {
    const badges = await this.badgesService.getSponsorBadges(country);
    return { badges };
  }

  @Get('stats')
  @Roles(UserRole.ADMIN)
  @UseGuards(JwtAuthGuard, RolesGuard)
  @ApiJwtRoles()
  @ApiOperation({
    summary: 'Badge catalogue stats',
    description:
      'Admin aggregate counts across the badge catalogue and awards. Requires JWT and role `admin`.',
  })
  @ApiOkResponse({ description: 'Badge catalogue and award statistics.' })
  async getBadgeStats() {
    return this.badgesService.getBadgeStats();
  }

  @Get('leaderboard')
  @UseGuards(JwtAuthGuard)
  @ApiJwtAuth()
  @ApiOperation({
    summary: 'Badge leaderboard',
    description:
      'Users ranked by badges earned. `limit` defaults to 10. Requires JWT.',
  })
  @ApiQuery({
    name: 'limit',
    required: false,
    description: 'Maximum number of leaderboard rows. Defaults to 10.',
  })
  @ApiOkResponse({ description: 'Top users by badge count.' })
  async getBadgeLeaderboard(@Query('limit') limit?: string) {
    const limitNum = limit ? parseInt(limit, 10) : 10;
    return this.badgesService.getBadgeLeaderboard(limitNum);
  }

  @Get(':badgeId')
  @UseGuards(JwtAuthGuard)
  @ApiJwtAuth()
  @ApiOperation({
    summary: 'Get badge by id',
    description:
      'Fetches a single catalogue badge. Static routes (category, sponsor, stats, leaderboard, user/…) are registered around this param route. Requires JWT.',
  })
  @ApiParam({ name: 'badgeId', description: 'Badge Mongo ObjectId.' })
  @ApiOkResponse({ description: 'Badge document.' })
  async getBadgeById(@Param('badgeId') badgeId: string) {
    const badge = await this.badgesService.getBadgeById(badgeId);
    return { badge };
  }

  @Patch(':badgeId')
  @Roles(UserRole.ADMIN)
  @UseGuards(JwtAuthGuard, RolesGuard)
  @UseInterceptors(FileFieldsInterceptor([
    { name: 'badgeImage', maxCount: 1 },
    { name: 'sponsorLogo', maxCount: 1 },
  ]))
  @ApiJwtRoles()
  @ApiConsumes('multipart/form-data')
  @ApiOperation({
    summary: 'Update a badge',
    description:
      'Admin partial update. Send `multipart/form-data` to optionally replace `badgeImage` and/or `sponsorLogo`. Requires JWT and role `admin`.',
  })
  @ApiParam({ name: 'badgeId', description: 'Badge Mongo ObjectId.' })
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        ...badgeFormProperties,
        isDeleted: { type: 'boolean' },
      },
    },
  })
  @ApiOkResponse({ description: 'Badge updated.' })
  async updateBadge(
    @Param('badgeId') badgeId: string,
    @Body() dto: UpdateBadgeDto,
    @UploadedFiles() files?: { badgeImage?: Express.Multer.File[], sponsorLogo?: Express.Multer.File[] },
  ) {
    // Upload new badge image if provided
    if (files?.badgeImage?.[0]) {
      const imageUrl = await this.imageUploadService.uploadFile(
        files.badgeImage[0],
        'saveful/badges',
      );
      dto.imageUrl = imageUrl;
    }

    // Upload new sponsor logo if provided
    if (files?.sponsorLogo?.[0]) {
      const logoUrl = await this.imageUploadService.uploadFile(
        files.sponsorLogo[0],
        'saveful/badges/sponsors',
      );
      dto.sponsorLogoUrl = logoUrl;
    }

    const badge = await this.badgesService.updateBadge(badgeId, dto);
    return { badge };
  }

  @Delete(':badgeId')
  @Roles(UserRole.ADMIN)
  @UseGuards(JwtAuthGuard, RolesGuard)
  @ApiJwtRoles()
  @ApiOperation({
    summary: 'Delete a badge',
    description:
      'Admin deletes (or soft-deletes) a catalogue badge. Requires JWT and role `admin`.',
  })
  @ApiParam({ name: 'badgeId', description: 'Badge Mongo ObjectId.' })
  @ApiOkResponse({ description: 'Badge deleted.' })
  async deleteBadge(@Param('badgeId') badgeId: string) {
    return this.badgesService.deleteBadge(badgeId);
  }

  @Post('award')
  @Roles(UserRole.ADMIN)
  @UseGuards(JwtAuthGuard, RolesGuard)
  @ApiJwtRoles()
  @ApiOperation({
    summary: 'Award a badge to a user',
    description:
      'Admin grants a badge to one user, optionally with `achievedValue` and metadata (challenge, rank, period). Requires JWT and role `admin`.',
  })
  @ApiBody({ type: AwardBadgeDto })
  @ApiCreatedResponse({ description: 'Badge awarded to the user.' })
  async awardBadge(@Body() dto: AwardBadgeDto) {
    return this.badgesService.awardBadge(dto);
  }

  @Post('award/bulk')
  @Roles(UserRole.ADMIN)
  @UseGuards(JwtAuthGuard, RolesGuard)
  @ApiJwtRoles()
  @ApiOperation({
    summary: 'Award a badge to many users',
    description:
      'Admin grants the same badge to a list of user ids with optional shared metadata. Requires JWT and role `admin`.',
  })
  @ApiBody({
    schema: {
      type: 'object',
      required: ['userIds', 'badgeId'],
      properties: {
        userIds: {
          type: 'array',
          items: { type: 'string' },
          description: 'User Mongo ObjectIds to award.',
        },
        badgeId: { type: 'string', description: 'Badge Mongo ObjectId.' },
        metadata: { type: 'object', additionalProperties: true },
      },
    },
  })
  @ApiCreatedResponse({ description: 'Badge awarded to each listed user.' })
  async awardBadgeToMultipleUsers(
    @Body()
    dto: {
      userIds: string[];
      badgeId: string;
      metadata?: any;
    },
  ) {
    return this.badgesService.awardBadgeToMultipleUsers(
      dto.userIds,
      dto.badgeId,
      dto.metadata,
    );
  }


  @Get('user/my-badges')
  @UseGuards(JwtAuthGuard)
  @ApiJwtAuth()
  @ApiOperation({
    summary: 'My earned badges',
    description:
      'Returns badges awarded to the authenticated user. Requires JWT.',
  })
  @ApiOkResponse({ description: 'Badges earned by the caller.' })
  async getMyBadges(@GetUser() user: any) {
    const userId = user.userId;
    return this.badgesService.getUserBadges(userId);
  }

  @Get('user/my-stats')
  @UseGuards(JwtAuthGuard)
  @ApiJwtAuth()
  @ApiOperation({
    summary: 'My badge stats',
    description:
      'Returns the authenticated user’s badge counts, categories, and related stats. Requires JWT.',
  })
  @ApiOkResponse({ description: 'Badge statistics for the caller.' })
  async getMyBadgeStats(@GetUser() user: any) {
    const userId = user.userId;
    return this.badgesService.getUserBadgeStats(userId);
  }

  @Get('user/:userId')
  @UseGuards(JwtAuthGuard)
  @ApiJwtAuth()
  @ApiOperation({
    summary: 'User earned badges',
    description:
      'Returns badges awarded to the given user. Requires JWT.',
  })
  @ApiParam({ name: 'userId', description: 'User Mongo ObjectId.' })
  @ApiOkResponse({ description: 'Badges earned by the user.' })
  async getUserBadges(@Param('userId') userId: string) {
    return this.badgesService.getUserBadges(userId);
  }

  @Get('user/:userId/stats')
  @UseGuards(JwtAuthGuard)
  @ApiJwtAuth()
  @ApiOperation({
    summary: 'User badge stats',
    description:
      'Returns badge counts and category breakdown for the given user. Requires JWT.',
  })
  @ApiParam({ name: 'userId', description: 'User Mongo ObjectId.' })
  @ApiOkResponse({ description: 'Badge statistics for the user.' })
  async getUserBadgeStats(@Param('userId') userId: string) {
    return this.badgesService.getUserBadgeStats(userId);
  }

  @Get('user/:userId/progress')
  @UseGuards(JwtAuthGuard)
  @ApiJwtAuth()
  @ApiOperation({
    summary: 'User badge progress',
    description:
      'Returns milestone progress toward unearned badges for the given user. Requires JWT.',
  })
  @ApiParam({ name: 'userId', description: 'User Mongo ObjectId.' })
  @ApiOkResponse({ description: 'Progress toward remaining badges.' })
  async getUserBadgeProgress(@Param('userId') userId: string) {
    const progress = await this.badgesService.getUserBadgeProgress(userId);
    return { progress };
  }

  @Post('user/mark-viewed/:badgeId')
  @UseGuards(JwtAuthGuard)
  @ApiJwtAuth()
  @ApiOperation({
    summary: 'Mark badge as viewed',
    description:
      'Marks one of the caller’s awarded badges as viewed (clears “new” state in the app). Requires JWT.',
  })
  @ApiParam({ name: 'badgeId', description: 'Badge Mongo ObjectId that was viewed.' })
  @ApiOkResponse({ description: 'Badge marked as viewed for the caller.' })
  async markBadgeAsViewed(
    @Param('badgeId') badgeId: string,
    @GetUser() user: any,
  ) {
    const userId = user.userId;
    await this.badgesService.markBadgeAsViewed(userId, badgeId);
    return { message: 'Badge marked as viewed' };
  }

  @Post('check-and-award')
  @UseGuards(JwtAuthGuard)
  @ApiJwtAuth()
  @ApiOperation({
    summary: 'Check milestones and award badges',
    description:
      'Evaluates milestone rules for `userId` (optional `userCountry` for sponsor badges) and awards any newly earned badges. Requires JWT.',
  })
  @ApiBody({
    schema: {
      type: 'object',
      required: ['userId'],
      properties: {
        userId: { type: 'string', description: 'User Mongo ObjectId to evaluate.' },
        userCountry: { type: 'string', description: 'ISO country code for sponsor-badge eligibility.' },
      },
    },
  })
  @ApiOkResponse({ description: 'Newly awarded badges and count.' })
  async checkAndAwardBadges(
    @Body() dto: { userId: string; userCountry?: string },
  ) {
    const newBadges = await this.badgesService.checkAndAwardBadges(
      dto.userId,
      dto.userCountry,
    );
    return { newBadges, count: newBadges.length };
  }

  @Delete('revoke/:userId/:badgeId')
  @Roles(UserRole.ADMIN)
  @UseGuards(JwtAuthGuard, RolesGuard)
  @ApiJwtRoles()
  @ApiOperation({
    summary: 'Revoke a user’s badge',
    description:
      'Admin removes an awarded badge from a user. Requires JWT and role `admin`.',
  })
  @ApiParam({ name: 'userId', description: 'User Mongo ObjectId.' })
  @ApiParam({ name: 'badgeId', description: 'Badge Mongo ObjectId to revoke.' })
  @ApiOkResponse({ description: 'Badge revoked from the user.' })
  async revokeBadge(
    @Param('userId') userId: string,
    @Param('badgeId') badgeId: string,
  ) {
    return this.badgesService.revokeBadge(userId, badgeId);
  }

  @Post('user/check-milestones')
  @UseGuards(JwtAuthGuard)
  @ApiJwtAuth()
  @ApiOperation({
    summary: 'Check my milestones',
    description:
      'Evaluates milestone rules for the authenticated user and awards any newly earned badges. Requires JWT.',
  })
  @ApiOkResponse({ description: 'Newly awarded badges for the caller.' })
  async checkMyMilestones(@GetUser() user: any) {
    const userId = user.userId;
    const newBadges = await this.badgesService.checkAndAwardBadges(userId);
    
    return {
      message: `Checked milestones`,
      newBadgesAwarded: newBadges.length,
      badges: newBadges,
    };
  }
}
