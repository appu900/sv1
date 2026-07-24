import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import {
  ChefImpactDaily,
  ChefImpactDailyDocument,
} from '../../database/schemas/chef-impact-daily.schema';
import {
  ChefCommunityDaily,
  ChefCommunityDailyDocument,
} from '../../database/schemas/chef-community-daily.schema';
import {
  ChefProfile,
  ChefProfileDocument,
} from '../../database/schemas/chef-profile.schema';
import { ChefLookupService } from './chef-lookup.service';
import { currencyFromCountry, utcDayStart } from './chef.constants';

export interface FoodSavedPersistedEvent {
  logId: string;
  userId: string;
  frameworkId?: string | null;
  chefIds: string[];
  foodSavedInGrams: number;
  moneySaved: number;
  currency?: string | null;
  country?: string | null;
  co2SavedInGrams: number;
  createdAt: Date | string;
}

@Injectable()
export class ChefImpactListener {
  private readonly logger = new Logger(ChefImpactListener.name);

  constructor(
    @InjectModel(ChefImpactDaily.name)
    private readonly impactDailyModel: Model<ChefImpactDailyDocument>,
    @InjectModel(ChefCommunityDaily.name)
    private readonly communityDailyModel: Model<ChefCommunityDailyDocument>,
    @InjectModel(ChefProfile.name)
    private readonly chefProfileModel: Model<ChefProfileDocument>,
    private readonly chefLookup: ChefLookupService,
  ) {}

  @OnEvent('food.saved.persisted', { async: true })
  async onFoodSavedPersisted(event: FoodSavedPersistedEvent) {
    try {
      const userChefIds = (event.chefIds ?? [])
        .map((id) => {
          try {
            return new Types.ObjectId(String(id));
          } catch {
            return null;
          }
        })
        .filter((id): id is Types.ObjectId => id !== null);

      if (!userChefIds.length) return;

      const profileIds = await this.chefLookup.resolveProfileIds(userChefIds);
      if (!profileIds.length) return;

      const day = utcDayStart(
        event.createdAt ? new Date(event.createdAt) : new Date(),
      );
      const meals = 1;
      const food = Math.max(0, Math.floor(event.foodSavedInGrams || 0));
      const money = Math.max(0, Number(event.moneySaved) || 0);
      const co2 = Math.max(0, Math.floor(event.co2SavedInGrams || 0));
      const currency =
        event.currency || currencyFromCountry(event.country) || 'UNKNOWN';

      const currencyIncPath = `moneyByCurrency.${currency}`;

      const impactOps = profileIds.map((chefId) => ({
        updateOne: {
          filter: { chefId, day },
          update: {
            $inc: {
              mealsCooked: meals,
              moneySaved: money,
              foodSavedInGrams: food,
              co2SavedInGrams: co2,
              [currencyIncPath]: money,
            },
            $setOnInsert: { chefId, day },
          },
          upsert: true,
        },
      }));

      const lifetimeOps = profileIds.map((chefId) => ({
        updateOne: {
          filter: { _id: chefId },
          update: {
            $inc: {
              'lifetime.mealsCooked': meals,
              'lifetime.moneySaved': money,
              'lifetime.foodSavedInGrams': food,
              'lifetime.co2SavedInGrams': co2,
              [`lifetime.${currencyIncPath}`]: money,
            },
          },
        },
      }));

      await Promise.all([
        this.impactDailyModel.bulkWrite(impactOps, { ordered: false }),
        this.chefProfileModel.bulkWrite(lifetimeOps, { ordered: false }),
        this.communityDailyModel.updateOne(
          { day },
          {
            $inc: {
              mealsCooked: meals,
              moneySaved: money,
              foodSavedInGrams: food,
              co2SavedInGrams: co2,
              [currencyIncPath]: money,
            },
            $setOnInsert: { day },
          },
          { upsert: true },
        ),
      ]);
    } catch (err: any) {
      this.logger.warn(
        `Chef impact rollup failed for log=${event?.logId}: ${err?.message}`,
      );
    }
  }
}
