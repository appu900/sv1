import { getModelToken } from '@nestjs/mongoose';
import { Test } from '@nestjs/testing';
import { ChefCommunityDaily } from '../../database/schemas/chef-community-daily.schema';
import { ChefImpactDaily } from '../../database/schemas/chef-impact-daily.schema';
import { ChefLeaderboardSnapshot } from '../../database/schemas/chef-leaderboard-snapshot.schema';
import { ChefProfile } from '../../database/schemas/chef-profile.schema';
import { FoodSavedEventLog } from '../../database/schemas/food-saved-event-log.schema';
import { RedisService } from '../../redis/redis.service';
import { ChefAnalyticsCronService } from './chef-analytics.cron';
import { ChefFavouriteService } from './chef-favourite.service';
import { ChefProfileSyncService } from './chef-profile-sync.service';
import { ChefService } from './chef.service';
import { CHEF_COMMUNITY_DIRTY_KEY } from './chef.constants';

async function build() {
  const redisStore = new Map<string, unknown>();
  let lockHeld = false;
  const redis = {
    set: jest.fn(async (key: string, value: unknown) => {
      redisStore.set(key, value);
    }),
    del: jest.fn(async (key: string) => {
      redisStore.delete(key);
    }),
    exists: jest.fn(async (key: string) => redisStore.has(key)),
    setIfAbsent: jest.fn(async () => !lockHeld),
    releaseLock: jest.fn(async () => true),
  };

  const communityAggregate = jest.fn(async () => [
    {
      mealsCooked: 2,
      moneySaved: 7.4,
      foodSavedInGrams: 600,
      co2SavedInGrams: 1380,
      moneyByCurrencyDocs: [{ AUD: 7.4 }],
    },
  ]);
  const snapshotUpdateOne = jest.fn(async () => ({}));

  const moduleRef = await Test.createTestingModule({
    providers: [
      ChefAnalyticsCronService,
      { provide: RedisService, useValue: redis },
      { provide: ChefService, useValue: {} },
      { provide: ChefFavouriteService, useValue: {} },
      { provide: ChefProfileSyncService, useValue: {} },
      {
        provide: getModelToken(ChefImpactDaily.name),
        useValue: { aggregate: jest.fn(async () => []) },
      },
      {
        provide: getModelToken(ChefCommunityDaily.name),
        useValue: { aggregate: communityAggregate },
      },
      {
        provide: getModelToken(ChefLeaderboardSnapshot.name),
        useValue: { updateOne: snapshotUpdateOne },
      },
      {
        provide: getModelToken(ChefProfile.name),
        useValue: {
          find: () => ({
            select: () => ({ lean: () => ({ exec: async () => [] }) }),
          }),
        },
      },
      { provide: getModelToken(FoodSavedEventLog.name), useValue: {} },
    ],
  }).compile();

  return {
    service: moduleRef.get(ChefAnalyticsCronService),
    redisStore,
    communityAggregate,
    snapshotUpdateOne,
    holdLock: (held: boolean) => {
      lockHeld = held;
    },
  };
}

describe('ChefAnalyticsCronService community refresh', () => {
  it('rebuilds the community snapshots immediately and clears the dirty flag', async () => {
    const { service, redisStore, communityAggregate, snapshotUpdateOne } =
      await build();

    await service.requestCommunityRefresh();

    expect(communityAggregate).toHaveBeenCalledTimes(3);
    expect(snapshotUpdateOne).toHaveBeenCalledWith(
      { key: 'community:month' },
      expect.objectContaining({
        $set: expect.objectContaining({
          payload: expect.objectContaining({ mealsCooked: 2 }),
        }),
      }),
      { upsert: true },
    );
    expect(redisStore.has(CHEF_COMMUNITY_DIRTY_KEY)).toBe(false);
  });

  it('leaves the flag set when another refresh holds the lock, then catches up', async () => {
    const { service, redisStore, communityAggregate, holdLock } = await build();

    holdLock(true);
    await service.requestCommunityRefresh();
    expect(communityAggregate).not.toHaveBeenCalled();
    expect(redisStore.has(CHEF_COMMUNITY_DIRTY_KEY)).toBe(true);

    holdLock(false);
    await service.refreshCommunityIfDirty();
    expect(communityAggregate).toHaveBeenCalledTimes(3);
    expect(redisStore.has(CHEF_COMMUNITY_DIRTY_KEY)).toBe(false);
  });

  it('skips the per-minute refresh when nothing has changed', async () => {
    const { service, communityAggregate } = await build();

    await service.refreshCommunityIfDirty();

    expect(communityAggregate).not.toHaveBeenCalled();
  });
});
