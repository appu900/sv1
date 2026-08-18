import { Types } from 'mongoose';
import { RecipeService } from './recipe.service';

function createQuery(result: unknown | Promise<unknown>) {
  const query: Record<string, jest.Mock> = {};
  for (const method of ['select', 'populate', 'sort', 'lean']) {
    query[method] = jest.fn(() => query);
  }
  query.exec = jest.fn(() => Promise.resolve(result));
  return query;
}

function createService(overrides: Record<string, any> = {}) {
  const cache = new Map<string, unknown>();
  const locks = new Map<string, string>();
  const query = overrides.query ?? createQuery([]);
  const recipeModel = {
    find: jest.fn(() => query),
    updateMany: jest.fn(),
    ...overrides.recipeModel,
  };
  const redis = {
    get: jest.fn(async (key: string) => cache.get(key) ?? null),
    set: jest.fn(async (key: string, value: unknown) => {
      cache.set(key, value);
    }),
    incr: jest.fn(async (key: string) => {
      const next = Number(cache.get(key) || 0) + 1;
      cache.set(key, next);
      return next;
    }),
    setIfAbsent: jest.fn(async (key: string, value: string) => {
      if (locks.has(key)) return false;
      locks.set(key, value);
      return true;
    }),
    releaseLock: jest.fn(async (key: string, value: string) => {
      if (locks.get(key) !== value) return false;
      locks.delete(key);
      return true;
    }),
    del: jest.fn(),
    delByPattern: jest.fn(),
    ...overrides.redis,
  };
  const imageUpload = {
    uploadFile: jest.fn(),
    deleteFile: jest.fn(),
    ...overrides.imageUpload,
  };
  const dataVersion =
    overrides.dataVersion === null
      ? undefined
      : {
          bump: jest.fn().mockResolvedValue(1),
          getVersion: jest.fn().mockResolvedValue(1),
          ...overrides.dataVersion,
        };
  const service = new RecipeService(
    recipeModel as never,
    {} as never,
    {} as never,
    {} as never,
    redis as never,
    imageUpload as never,
    undefined,
    undefined,
    dataVersion as never,
  );
  return { service, recipeModel, redis, query, dataVersion };
}

const rawRecipe = {
  _id: 'recipe-1',
  title: 'Fast Pasta',
  heroImageUrl: 'https://images.example/pasta.jpg',
  order: 4,
  frameworkCategories: ['category-1', { _id: 'category-2' }],
  stickerId: {
    _id: 'sticker-1',
    imageUrl: 'https://images.example/sticker.png',
  },
  components: [
    {
      variantTags: ['Classic', 'Quick', 'Classic'],
      component: [
        {
          requiredIngredients: [
            {
              recommendedIngredient: 'allergen-1',
              alternativeIngredients: [],
            },
            {
              recommendedIngredient: 'replaceable-1',
              alternativeIngredients: [{ ingredient: 'alternative-1' }],
            },
          ],
        },
      ],
    },
  ],
};

describe('RecipeService summary id mapping', () => {
  it('maps real ObjectId values to hex strings', async () => {
    const recipeId = new Types.ObjectId();
    const categoryId = new Types.ObjectId();
    const cuisineId = new Types.ObjectId();
    const stickerId = new Types.ObjectId();
    const requiredId = new Types.ObjectId();

    const { service } = createService({
      query: createQuery([
        {
          _id: recipeId,
          title: 'Objectid Pasta',
          order: 1,
          frameworkCategories: [categoryId],
          cuisines: [cuisineId],
          stickerId: { _id: stickerId, imageUrl: 'https://cdn/sticker.png' },
          components: [
            {
              variantTags: ['Classic'],
              component: [
                {
                  requiredIngredients: [
                    {
                      recommendedIngredient: requiredId,
                      alternativeIngredients: [],
                    },
                  ],
                },
              ],
            },
          ],
        },
      ]),
    });

    const [summary] = await service.findSummaries();

    expect(summary._id).toBe(recipeId.toHexString());
    expect(summary.frameworkCategoryIds).toEqual([categoryId.toHexString()]);
    expect(summary.cuisineIds).toEqual([cuisineId.toHexString()]);
    expect(summary.sticker?.id).toBe(stickerId.toHexString());
    expect(summary.unsubstitutableIngredientIds).toEqual([
      requiredId.toHexString(),
    ]);
  });

  it('does not overflow the stack on self-referential id shapes', async () => {
    const { service } = createService({
      query: createQuery([
        {
          _id: new Types.ObjectId(),
          title: 'Self Referential',
          order: 0,
          frameworkCategories: [],
          components: [],
        },
      ]),
    });

    await expect(service.findSummaries()).resolves.toHaveLength(1);
  });
});

describe('RecipeService summary caching', () => {
  it('returns a lean mapped summary and caches it by country', async () => {
    const { service, recipeModel, redis, query } = createService({
      query: createQuery([rawRecipe]),
    });

    const result = await service.findSummaries('AU');
    expect(result).toEqual([
      {
        _id: 'recipe-1',
        title: 'Fast Pasta',
        heroImageUrl: 'https://images.example/pasta.jpg',
        order: 4,
        frameworkCategoryIds: ['category-1', 'category-2'],
        cuisineIds: [],
        variantTags: ['Classic', 'Quick'],
        sticker: {
          id: 'sticker-1',
          imageUrl: 'https://images.example/sticker.png',
        },
        unsubstitutableIngredientIds: ['allergen-1'],
      },
    ]);
    expect(recipeModel.find).toHaveBeenCalledWith({
      isActive: true,
      countries: 'Australia',
    });
    expect(query.select).toHaveBeenCalledWith(
      expect.not.stringContaining('componentSteps'),
    );
    expect(query.populate).toHaveBeenCalledTimes(1);
    expect(redis.set).toHaveBeenCalledWith(
      'recipes:summaries:v2:country:australia',
      result,
      1200,
    );

    await service.findSummaries('AU');
    expect(recipeModel.find).toHaveBeenCalledTimes(1);
  });

  it('keeps country caches separate', async () => {
    const { service, recipeModel, redis } = createService({
      query: createQuery([rawRecipe]),
    });
    await service.findSummaries('IN');
    await service.findSummaries('AU');

    expect(recipeModel.find).toHaveBeenCalledTimes(2);
    expect(redis.set.mock.calls.map(call => call[0])).toEqual([
      'recipes:summaries:v2:country:india',
      'recipes:summaries:v2:country:australia',
    ]);
  });

  it('coalesces concurrent misses into one database query', async () => {
    let resolveRecipes!: (value: unknown[]) => void;
    const pending = new Promise<unknown[]>(resolve => {
      resolveRecipes = resolve;
    });
    const query = createQuery([]);
    query.exec.mockImplementation(() => pending);
    const { service, recipeModel } = createService({ query });

    const first = service.findSummaries('AU');
    const second = service.findSummaries('AU');
    resolveRecipes([rawRecipe]);

    await expect(Promise.all([first, second])).resolves.toHaveLength(2);
    expect(recipeModel.find).toHaveBeenCalledTimes(1);
  });

  it('waits for another instance to populate the shared cache', async () => {
    const cached = [
      {
        _id: 'recipe-1',
        title: 'Cached',
        order: 0,
        frameworkCategoryIds: [],
        variantTags: [],
        unsubstitutableIngredientIds: [],
      },
    ];
    const { service, recipeModel, redis } = createService({
      redis: {
        get: jest
          .fn()
          .mockResolvedValueOnce(null)
          .mockResolvedValueOnce(cached),
        setIfAbsent: jest.fn().mockResolvedValue(false),
      },
    });
    jest.spyOn(service as any, 'delay').mockResolvedValue(undefined);

    await expect(service.findSummaries()).resolves.toEqual(cached);
    expect(recipeModel.find).not.toHaveBeenCalled();
    expect(redis.releaseLock).not.toHaveBeenCalled();
  });

  it('falls back to the database when Redis is unavailable', async () => {
    const { service, recipeModel } = createService({
      query: createQuery([rawRecipe]),
      redis: {
        get: jest.fn().mockRejectedValue(new Error('Redis unavailable')),
        setIfAbsent: jest
          .fn()
          .mockRejectedValue(new Error('Redis unavailable')),
        set: jest.fn().mockRejectedValue(new Error('Redis unavailable')),
      },
    });

    await expect(service.findSummaries()).resolves.toHaveLength(1);
    expect(recipeModel.find).toHaveBeenCalledTimes(1);
  });

  it('releases the distributed lock when the database query fails', async () => {
    const query = createQuery([]);
    query.exec.mockRejectedValue(new Error('Mongo unavailable'));
    const { service, redis } = createService({ query });

    await expect(service.findSummaries()).rejects.toBeDefined();
    expect(redis.releaseLock).toHaveBeenCalledTimes(1);
  });

  it('invalidates every country summary cache after a mutation', async () => {
    const { service, redis } = createService();
    await (service as any).invalidateRecipeSummaryCaches();
    expect(redis.delByPattern).toHaveBeenCalledWith(
      'recipes:summaries:v2*',
    );
  });

  it('flushes recipes and dietary caches and bumps generation on mutate', async () => {
    const { service, redis } = createService();
    await (service as any).invalidateRecipeCaches({ recipeId: 'abc' });
    expect(redis.incr).toHaveBeenCalledWith('cache:gen:recipes');
    expect(redis.delByPattern).toHaveBeenCalledWith('recipes:*');
    expect(redis.delByPattern).toHaveBeenCalledWith('dietary:*');
  });

  it('bumps the recipes data version so clients learn about the edit', async () => {
    const { service, dataVersion } = createService();
    await (service as any).invalidateRecipeCaches({ recipeId: 'abc' });
    expect(dataVersion.bump).toHaveBeenCalledWith('recipes');
  });

  it('still purges Redis when data versioning is not wired up', async () => {
    const { service, redis } = createService({ dataVersion: null });
    await (service as any).invalidateRecipeCaches({ recipeId: 'abc' });
    expect(redis.delByPattern).toHaveBeenCalledWith('recipes:*');
  });

  it('does not rewrite summary cache after generation bumps', async () => {
    const { service, redis } = createService({
      query: createQuery([rawRecipe]),
    });

    redis.get.mockResolvedValueOnce(2);

    await (service as any).setRecipeCacheIfCurrent(
      'recipes:summaries:v2',
      [{ _id: 'stale' }],
      1,
    );

    expect(redis.set).not.toHaveBeenCalled();
  });
});
