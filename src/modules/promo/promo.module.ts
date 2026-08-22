import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { PromoController } from './promo.controller';
import { PromoService } from './promo.service';
import {
  PromoCard,
  PromoCardSchema,
} from '../../database/schemas/promo-card.schema';
import {
  PerksMembership,
  PerksMembershipSchema,
} from '../../database/schemas/perks-membership.schema';
import { User, UserSchema } from '../../database/schemas/user.auth.schema';
import { ImageUploadModule } from '../image-upload/image-upload.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: PromoCard.name, schema: PromoCardSchema },
      { name: PerksMembership.name, schema: PerksMembershipSchema },
      { name: User.name, schema: UserSchema },
    ]),
    ImageUploadModule,
  ],
  controllers: [PromoController],
  providers: [PromoService],
  exports: [PromoService],
})
export class PromoModule {}
