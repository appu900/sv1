import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Types } from 'mongoose';
import {
  cleanSaviVisits,
  MAX_STORED_KEYS,
  parseSaviIncrements,
} from './savi-visits';
import { UserService } from './user.service';

const userId = new Types.ObjectId().toString();

describe('parseSaviIncrements', () => {
  it('accepts screen keys with whole-number increments', () => {
    expect(parseSaviIncrements({ kitchen_home: 2, kitchen_receipt: 1 })).toEqual({
      kitchen_home: 2,
      kitchen_receipt: 1,
    });
  });

  it.each([
    [null],
    [[]],
    [{}],
    [{ 'uiState.x': 1 }],
    [{ $set: 1 }],
    [{ Kitchen: 1 }],
    [{ kitchen_home: 0 }],
    [{ kitchen_home: 51 }],
    [{ kitchen_home: 1.5 }],
    [{ kitchen_home: '1' }],
  ])('rejects %j', input => {
    expect(() => parseSaviIncrements(input)).toThrow(BadRequestException);
  });

  it('rejects more than 32 keys in one request', () => {
    const many = Object.fromEntries(
      Array.from({ length: 33 }, (_, i) => [`screen_${i}`, 1]),
    );
    expect(() => parseSaviIncrements(many)).toThrow(BadRequestException);
  });
});

describe('cleanSaviVisits', () => {
  it('keeps only well-formed counts', () => {
    expect(
      cleanSaviVisits({ kitchen_home: 3.9, bad_value: 'x', 'Bad-Key': 2, zero: 0 }),
    ).toEqual({ kitchen_home: 3 });
    expect(cleanSaviVisits(undefined)).toEqual({});
  });
});

function buildService(stored?: Record<string, number> | null) {
  const lean = (value: unknown) => ({ lean: jest.fn().mockResolvedValue(value) });
  const userModel = {
    findById: jest.fn(() => ({
      select: jest.fn(() =>
        lean(stored === null ? null : { uiState: stored ? { saviVisits: stored } : undefined }),
      ),
    })),
    findOneAndUpdate: jest.fn((_filter, update) => {
      const next = { ...(stored ?? {}) };
      for (const [path, n] of Object.entries(update.$inc as Record<string, number>)) {
        const key = path.replace('uiState.saviVisits.', '');
        next[key] = (next[key] ?? 0) + n;
      }
      return lean({ uiState: { saviVisits: next } });
    }),
    updateOne: jest.fn().mockResolvedValue({ matchedCount: 1 }),
  };
  const service = new UserService(userModel as any, {} as any);
  return { service, userModel };
}

describe('UserService Savi visits', () => {
  it('increments atomically with dotted $inc paths and returns totals', async () => {
    const { service, userModel } = buildService({ kitchen_home: 4 });
    const result = await service.incrementSaviVisits(userId, {
      kitchen_home: 2,
      kitchen_receipt: 1,
    });

    expect(userModel.findOneAndUpdate).toHaveBeenCalledWith(
      { _id: new Types.ObjectId(userId) },
      {
        $inc: {
          'uiState.saviVisits.kitchen_home': 2,
          'uiState.saviVisits.kitchen_receipt': 1,
        },
      },
      expect.objectContaining({ new: true }),
    );
    expect(result).toEqual({ saviVisits: { kitchen_home: 6, kitchen_receipt: 1 } });
  });

  it('works for a user with no visits yet', async () => {
    const { service } = buildService(undefined);
    await expect(
      service.incrementSaviVisits(userId, { kitchen_home: 1 }),
    ).resolves.toEqual({ saviVisits: { kitchen_home: 1 } });
  });

  it('refuses to store more than the key limit', async () => {
    const full = Object.fromEntries(
      Array.from({ length: MAX_STORED_KEYS }, (_, i) => [`screen_${i}`, 1]),
    );
    const { service, userModel } = buildService(full);

    await expect(
      service.incrementSaviVisits(userId, { brand_new: 1 }),
    ).rejects.toThrow(BadRequestException);
    expect(userModel.findOneAndUpdate).not.toHaveBeenCalled();

    // Existing keys can still be incremented at the limit.
    await expect(
      service.incrementSaviVisits(userId, { screen_0: 1 }),
    ).resolves.toBeDefined();
  });

  it('rejects a bad user id or a missing user', async () => {
    await expect(
      buildService().service.incrementSaviVisits('nope', { kitchen_home: 1 }),
    ).rejects.toThrow(BadRequestException);
    await expect(
      buildService(null).service.incrementSaviVisits(userId, { kitchen_home: 1 }),
    ).rejects.toThrow(NotFoundException);
  });

  it('resets the counts', async () => {
    const { service, userModel } = buildService({ kitchen_home: 9 });
    await expect(service.resetSaviVisits(userId)).resolves.toEqual({ saviVisits: {} });
    expect(userModel.updateOne).toHaveBeenCalledWith(
      { _id: new Types.ObjectId(userId) },
      { $unset: { 'uiState.saviVisits': 1 } },
    );
  });
});
