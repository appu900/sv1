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
  async getAllBadges(@Query('includeInactive') includeInactive?: string) {
    const badges = await this.badgesService.getAllBadges(includeInactive === 'true');
    return { badges };
  }

  @Get('category/:category')
  @UseGuards(JwtAuthGuard)
  async getBadgesByCategory(@Param('category') category: string) {
    const badges = await this.badgesService.getBadgesByCategory(category as any);
    return { badges };
  }

  @Get('sponsor')
  @UseGuards(JwtAuthGuard)
  async getSponsorBadges(@Query('country') country?: string) {
    const badges = await this.badgesService.getSponsorBadges(country);
    return { badges };
  }

  @Get('stats')
  @Roles(UserRole.ADMIN)
  @UseGuards(JwtAuthGuard, RolesGuard)
  async getBadgeStats() {
    return this.badgesService.getBadgeStats();
  }

  @Get('leaderboard')
  @UseGuards(JwtAuthGuard)
  async getBadgeLeaderboard(@Query('limit') limit?: string) {
    const limitNum = limit ? parseInt(limit, 10) : 10;
    return this.badgesService.getBadgeLeaderboard(limitNum);
  }

  @Get(':badgeId')
  @UseGuards(JwtAuthGuard)
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
  async deleteBadge(@Param('badgeId') badgeId: string) {
    return this.badgesService.deleteBadge(badgeId);
  }

  @Post('award')
  @Roles(UserRole.ADMIN)
  @UseGuards(JwtAuthGuard, RolesGuard)
  async awardBadge(@Body() dto: AwardBadgeDto) {
    return this.badgesService.awardBadge(dto);
  }

  @Post('award/bulk')
  @Roles(UserRole.ADMIN)
  @UseGuards(JwtAuthGuard, RolesGuard)
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
  async getMyBadges(@GetUser() user: any) {
    const userId = user.userId;
    return this.badgesService.getUserBadges(userId);
  }

  @Get('user/my-stats')
  @UseGuards(JwtAuthGuard)
  async getMyBadgeStats(@GetUser() user: any) {
    const userId = user.userId;
    return this.badgesService.getUserBadgeStats(userId);
  }

  @Get('user/:userId')
  @UseGuards(JwtAuthGuard)
  async getUserBadges(@Param('userId') userId: string) {
    return this.badgesService.getUserBadges(userId);
  }

  @Get('user/:userId/stats')
  @UseGuards(JwtAuthGuard)
  async getUserBadgeStats(@Param('userId') userId: string) {
    return this.badgesService.getUserBadgeStats(userId);
  }

  @Get('user/:userId/progress')
  @UseGuards(JwtAuthGuard)
  async getUserBadgeProgress(@Param('userId') userId: string) {
    const progress = await this.badgesService.getUserBadgeProgress(userId);
    return { progress };
  }

  @Post('user/mark-viewed/:badgeId')
  @UseGuards(JwtAuthGuard)
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
  async revokeBadge(
    @Param('userId') userId: string,
    @Param('badgeId') badgeId: string,
  ) {
    return this.badgesService.revokeBadge(userId, badgeId);
  }

  @Post('user/check-milestones')
  @UseGuards(JwtAuthGuard)
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
