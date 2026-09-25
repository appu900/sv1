import { getModelToken } from '@nestjs/mongoose';
import { Test } from '@nestjs/testing';
import { Types } from 'mongoose';
import { ChefProfile } from '../../database/schemas/chef-profile.schema';
import { Recipe } from '../../database/schemas/recipe.schema';
import { RedisService } from '../../redis/redis.service';
import { ChefLookupService } from './chef-lookup.service';
import { CHEF_CACHE_KEYS } from './chef.constants';

type ProfileDoc = {
  _id: Types.ObjectId;
  userId: Types.ObjectId;
  slug: string;
  displayName: string;
  avatarImageUrl?: string;
  heroImageUrl?: string;
};

async function build(profiles: ProfileDoc[]) {
  const redisStore = new Map<string, unknown>();
  const redis = {
    get: jest.fn(async (key: string) => redisStore.get(key) ?? null),
    set: jest.fn(async (key: string, value: unknown) => {
      redisStore.set(key, value);
    }),
  };

  // Only published profiles are passed in, mirroring PUBLIC_CHEF_FILTER.
  const findOne = jest.fn((filter: { userId: Types.ObjectId }) => ({
    select: () => ({
      lean: () => ({
        exec: async () =>
          profiles.find((p) => String(p.userId) === String(filter.userId)) ??
          null,
      }),
    }),
  }));

  const moduleRef = await Test.createTestingModule({
    providers: [
      ChefLookupService,
      { provide: RedisService, useValue: redis },
      { provide: getModelToken(Recipe.name), useValue: {} },
      { provide: getModelToken(ChefProfile.name), useValue: { findOne } },
    ],
  }).compile();

  return { service: moduleRef.get(ChefLookupService), redis, findOne };
}

describe('ChefLookupService.getPublicChefForRecipe', () => {
  const unpublishedUser = new Types.ObjectId();
  const chefUser = new Types.ObjectId();
  const chefProfile: ProfileDoc = {
    _id: new Types.ObjectId(),
    userId: chefUser,
    slug: 'matt-moran',
    displayName: 'Matt Moran',
    avatarImageUrl: 'https://cdn.example/matt.jpg',
  };

  it('returns null for Saveful recipes with no chef attribution', async () => {
    const { service, findOne } = await build([chefProfile]);

    await expect(service.getPublicChefForRecipe([])).resolves.toBeNull();
    await expect(service.getPublicChefForRecipe(undefined)).resolves.toBeNull();
    expect(findOne).not.toHaveBeenCalled();
  });

  it('skips unpublished chefs and returns the first published one', async () => {
    const { service } = await build([chefProfile]);

    // chefIds arrive populated ({ _id, name, email, role }) from the recipe query.
    const chef = await service.getPublicChefForRecipe([
      { _id: unpublishedUser },
      { _id: chefUser },
    ]);

    expect(chef).toEqual({
      id: String(chefProfile._id),
      slug: 'matt-moran',
      displayName: 'Matt Moran',
      avatarImageUrl: 'https://cdn.example/matt.jpg',
    });
  });

  it('falls back to the hero image when the chef has no avatar', async () => {
    const { service } = await build([
      {
        ...chefProfile,
        avatarImageUrl: undefined,
        heroImageUrl: 'https://cdn.example/hero.jpg',
      },
    ]);

    const chef = await service.getPublicChefForRecipe([String(chefUser)]);
    expect(chef?.avatarImageUrl).toBe('https://cdn.example/hero.jpg');
  });

  it('caches both hits and misses per chef user', async () => {
    const { service, redis, findOne } = await build([chefProfile]);

    await service.getPublicChefForRecipe([unpublishedUser, chefUser]);
    await service.getPublicChefForRecipe([unpublishedUser, chefUser]);

    expect(findOne).toHaveBeenCalledTimes(2);
    expect(redis.set).toHaveBeenCalledWith(
      CHEF_CACHE_KEYS.publicCardByUser(String(unpublishedUser)),
      { chef: null },
      expect.any(Number),
    );
  });
});
