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
import { FileInterceptor } from '@nestjs/platform-express';
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
  @UseInterceptors(FileInterceptor('badgeImage'))
  async createBadge(
    @Body() dto: CreateBadgeDto,
    @UploadedFile() file?: Express.Multer.File,
  ) {
    // Upload image if provided
    if (file) {
      const imageUrl = await this.imageUploadService.uploadFile(
        file,
        'saveful/badges',
      );
      dto.imageUrl = imageUrl;
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
  @UseInterceptors(FileInterceptor('badgeImage'))
  async updateBadge(
    @Param('badgeId') badgeId: string,
    @Body() dto: UpdateBadgeDto,
    @UploadedFile() file?: Express.Multer.File,
  ) {
    // Upload new image if provided
    if (file) {
      const imageUrl = await this.imageUploadService.uploadFile(
        file,
        'saveful/badges',
      );
      dto.imageUrl = imageUrl;
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

  @Post('user/check-milestones')
  @UseGuards(JwtAuthGuard)
  async checkMyMilestones(@GetUser() user: any) {
    const userId = user.userId;
    const newBadges = await this.badgesService.checkAndAwardMilestoneBadges(userId);
    
    const populatedBadges = await Promise.all(
      newBadges.map(async (userBadge) => {
        const badge = await this.badgesService.getBadgeById(userBadge.badgeId.toString());
        const plainUserBadge = (userBadge as any).toObject ? (userBadge as any).toObject() : userBadge;
        return {
          ...plainUserBadge,
          badge,
        };
      })
    );
    
    return {
      message: `Checked milestones`,
      newBadgesAwarded: newBadges.length,
      badges: populatedBadges,
    };
  }
}
