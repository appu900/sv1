import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import {
  PerksCalculatorProfile,
  PerksCalculatorProfileSchema,
} from '../../database/schemas/perks-calculator-profile.schema';
import {
  PerksCart,
  PerksCartSchema,
} from '../../database/schemas/perks-cart.schema';
import {
  PerksFavourite,
  PerksFavouriteSchema,
} from '../../database/schemas/perks-favourite.schema';
import {
  PerksMembership,
  PerksMembershipSchema,
} from '../../database/schemas/perks-membership.schema';
import {
  PerksOrder,
  PerksOrderSchema,
} from '../../database/schemas/perks-order.schema';
import {
  PerksWalletMetadata,
  PerksWalletMetadataSchema,
} from '../../database/schemas/perks-wallet-metadata.schema';
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
      { name: PerksFavourite.name, schema: PerksFavouriteSchema },
      { name: PerksCart.name, schema: PerksCartSchema },
      { name: PerksWalletMetadata.name, schema: PerksWalletMetadataSchema },
      {
        name: PerksCalculatorProfile.name,
        schema: PerksCalculatorProfileSchema,
      },
    ]),
  ],
  controllers: [PerksController],
  providers: [PerksApiClient, PerksService],
  exports: [PerksService],
})
export class PerksModule {}
