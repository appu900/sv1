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
  PerksMembershipEvent,
  PerksMembershipEventSchema,
} from '../../database/schemas/perks-membership-event.schema';
import {
  PerksMembership,
  PerksMembershipSchema,
} from '../../database/schemas/perks-membership.schema';
import {
  PerksWalletMetadata,
  PerksWalletMetadataSchema,
} from '../../database/schemas/perks-wallet-metadata.schema';
import {
  HealthProfile,
  HealthProfileSchema,
} from '../../database/schemas/nutrition/health-profile.schema';
import { User, UserSchema } from '../../database/schemas/user.auth.schema';
import { PerksBillingController } from './billing/perks-billing.controller';
import { PerksBillingService } from './billing/perks-billing.service';
import { PerksStripeClient } from './billing/perks-stripe.client';
import { PerksCorpApiClient } from './corp/perks-corp-api.client';
import { PerksCorpSessionService } from './corp/perks-corp-session.service';
import { PerksController } from './perks.controller';
import { PerksService } from './perks.service';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: User.name, schema: UserSchema },
      { name: HealthProfile.name, schema: HealthProfileSchema },
      { name: PerksMembership.name, schema: PerksMembershipSchema },
      { name: PerksMembershipEvent.name, schema: PerksMembershipEventSchema },
      { name: PerksFavourite.name, schema: PerksFavouriteSchema },
      { name: PerksCart.name, schema: PerksCartSchema },
      { name: PerksWalletMetadata.name, schema: PerksWalletMetadataSchema },
      {
        name: PerksCalculatorProfile.name,
        schema: PerksCalculatorProfileSchema,
      },
    ]),
  ],
  controllers: [PerksController, PerksBillingController],
  providers: [
    PerksCorpApiClient,
    PerksCorpSessionService,
    PerksStripeClient,
    PerksBillingService,
    PerksService,
  ],
  exports: [PerksService],
})
export class PerksModule {}
