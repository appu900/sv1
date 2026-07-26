import { getModelToken } from '@nestjs/mongoose';
import { Test } from '@nestjs/testing';
import { DataVersion } from '../../database/schemas/data-version.schema';
import { RedisService } from '../../redis/redis.service';
import {
  DATA_VERSION_REDIS_PREFIX,
  DataVersionService,
} from './data-version.service';

type Mocked = {
  redis: {
    mGet: jest.Mock;
    setRaw: jest.Mock;
    incr: jest.Mock;
  };
  model: {
    find: jest.Mock;
    updateOne: jest.Mock;
    findOneAndUpdate: jest.Mock;
  };
};

async function build(): Promise<{ service: DataVersionService } & Mocked> {
  const redis = {
    mGet: jest.fn().mockResolvedValue([null, null, null, null]),
    setRaw: jest.fn().mockResolvedValue(undefined),
    incr: jest.fn(),
  };
  const model = {
    find: jest.fn().mockReturnValue({
      select: jest.fn().mockReturnValue({ lean: jest.fn().mockResolvedValue([]) }),
    }),
    updateOne: jest.fn().mockResolvedValue({}),
    findOneAndUpdate: jest.fn(),
  };

  const moduleRef = await Test.createTestingModule({
    providers: [
      DataVersionService,
      { provide: RedisService, useValue: redis },
      { provide: getModelToken(DataVersion.name), useValue: model },
    ],
  }).compile();

  return {
    service: moduleRef.get(DataVersionService),
    redis,
    model,
  };
}

describe('DataVersionService', () => {
  it('serves the manifest from a single Redis MGET when every key is warm', async () => {
    const { service, redis, model } = await build();
    redis.mGet.mockResolvedValue(['42', '17', '5', '3']);

    await expect(service.getManifest()).resolves.toEqual({
      recipes: 42,
      ingredients: 17,
      frameworkCategories: 5,
      stickers: 3,
    });

    expect(redis.mGet).toHaveBeenCalledWith([
      'dataversion:recipes',
      'dataversion:ingredients',
      'dataversion:frameworkCategories',
      'dataversion:stickers',
    ]);
    expect(model.find).not.toHaveBeenCalled();
  });

  it('reseeds Redis from the durable Mongo floor after a flush', async () => {
    const { service, redis, model } = await build();
    redis.mGet.mockResolvedValue(['42', null, null, null]);
    model.find.mockReturnValue({
      select: jest.fn().mockReturnValue({
        lean: jest
          .fn()
          .mockResolvedValue([{ collectionKey: 'ingredients', version: 17 }]),
      }),
    });

    await expect(service.getManifest()).resolves.toEqual({
      recipes: 42,
      ingredients: 17,
      frameworkCategories: 0,
      stickers: 0,
    });

    expect(redis.setRaw).toHaveBeenCalledWith(
      'dataversion:ingredients',
      '17',
    );
  });

  it('still answers when Redis is down entirely', async () => {
    const { service, redis } = await build();
    redis.mGet.mockRejectedValue(new Error('ECONNREFUSED'));

    await expect(service.getManifest()).resolves.toEqual({
      recipes: 0,
      ingredients: 0,
      frameworkCategories: 0,
      stickers: 0,
    });
  });

  it('bumps in Redis and records the result as a Mongo floor', async () => {
    const { service, redis, model } = await build();
    redis.incr.mockResolvedValue(43);

    await expect(service.bump('recipes')).resolves.toBe(43);

    expect(redis.incr).toHaveBeenCalledWith(
      `${DATA_VERSION_REDIS_PREFIX}recipes`,
    );
    // `$max` rather than `$set` so a concurrent higher bump is never rolled back.
    expect(model.updateOne).toHaveBeenCalledWith(
      { collectionKey: 'recipes' },
      { $max: { version: 43 } },
      { upsert: true },
    );
  });

  it('falls back to Mongo when Redis rejects the bump', async () => {
    const { service, redis, model } = await build();
    redis.incr.mockRejectedValue(new Error('READONLY'));
    model.findOneAndUpdate.mockResolvedValue({ version: 44 });

    await expect(service.bump('recipes')).resolves.toBe(44);
    expect(model.findOneAndUpdate).toHaveBeenCalledWith(
      { collectionKey: 'recipes' },
      { $inc: { version: 1 } },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    );
  });

  it('never throws out of a bump, so a mutation cannot fail on versioning', async () => {
    const { service, redis, model } = await build();
    redis.incr.mockRejectedValue(new Error('READONLY'));
    model.findOneAndUpdate.mockRejectedValue(new Error('not primary'));

    await expect(service.bump('recipes')).resolves.toBeNull();
  });
});
