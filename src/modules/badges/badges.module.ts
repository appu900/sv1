import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { BadgesService } from './badges.service';
import { BadgesController } from './badges.controller';
import { Badge, BadgeSchema } from '../../database/schemas/badge.schema';
import { UserBadge, UserBadgeSchema } from '../../database/schemas/user-badge.schema';
import { UserFoodAnalyticsProfile, UserFoodAnalyticalProfileSchema } from '../../database/schemas/user.food.analyticsProfile.schema';
import { ImageUploadService } from '../image-upload/image-upload.service';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Badge.name, schema: BadgeSchema },
      { name: UserBadge.name, schema: UserBadgeSchema },
      { name: UserFoodAnalyticsProfile.name, schema: UserFoodAnalyticalProfileSchema },
    ]),
  ],
  controllers: [BadgesController],
  providers: [BadgesService, ImageUploadService],
  exports: [BadgesService],
})
export class BadgesModule {}
