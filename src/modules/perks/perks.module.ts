import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import {
  PerksMembership,
  PerksMembershipSchema,
} from '../../database/schemas/perks-membership.schema';
import {
  PerksOrder,
  PerksOrderSchema,
} from '../../database/schemas/perks-order.schema';
import { User, UserSchema } from '../../database/schemas/user.auth.schema';
import { PerksApiClient } from './perks-api-client';
import { PerksController } from './perks.controller';
import { PerksService } from './perks.service';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: User.name, schema: UserSchema },
      { name: PerksMembership.name, schema: PerksMembershipSchema },
      { name: PerksOrder.name, schema: PerksOrderSchema },
    ]),
  ],
  controllers: [PerksController],
  providers: [PerksApiClient, PerksService],
  exports: [PerksService],
})
export class PerksModule {}
