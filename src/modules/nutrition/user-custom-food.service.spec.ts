/// <reference types="jest" />

import { Types } from 'mongoose';
import { UserCustomFoodService } from './user-custom-food.service';

describe('UserCustomFoodService.createFromPhotoAnalysis', () => {
  const userId = new Types.ObjectId().toHexString();
  const input = {
    name: 'Toast',
    servingLabel: '1 slice',
    servingGrams: 40,
    perServing: { kcal: 100, protein_g: 3, carbs_g: 18, fat_g: 1, fiber_g: 1, sugar_g: 1, sodium_mg: 150 },
  };

  let holders: Record<string, any>;
  let customFoodModel: any;
  let service: UserCustomFoodService;

  beforeEach(() => {
    holders = {};
    customFoodModel = {
      findOne: jest.fn((filter: { normalizedName: string }) => ({
        exec: jest.fn().mockResolvedValue(holders[filter.normalizedName] ?? null),
      })),
      create: jest.fn(async (payload: any) => ({ toObject: () => payload })),
    };
    service = new UserCustomFoodService(customFoodModel);
  });

  it('creates the food under its own name when the name is free', async () => {
    const created = await service.createFromPhotoAnalysis(userId, input);
    expect(created.normalizedName).toBe('toast');
    expect(customFoodModel.create).toHaveBeenCalledTimes(1);
  });

  // The (userId, normalizedName) index is unique across soft-deleted rows, so
  // creating a new row here used to fail with E11000 (HTTP 500).
  it('revives a soft-deleted food with the same name instead of inserting', async () => {
    const deleted = { isActive: false, set: jest.fn(), save: jest.fn(), toObject: () => ({ revived: true }) };
    holders['toast'] = deleted;

    const result = await service.createFromPhotoAnalysis(userId, input);

    expect(deleted.set).toHaveBeenCalledWith(expect.objectContaining({ isActive: true, normalizedName: 'toast' }));
    expect(deleted.save).toHaveBeenCalled();
    expect(customFoodModel.create).not.toHaveBeenCalled();
    expect(result).toEqual({ revived: true });
  });

  it('picks the next free dated name when earlier ones are taken by active foods', async () => {
    const dateLabel = new Date().toLocaleDateString('en-IN', { day: '2-digit', month: 'short' });
    holders['toast'] = { isActive: true };
    holders[`toast (${dateLabel})`.toLowerCase()] = { isActive: true };

    const created = await service.createFromPhotoAnalysis(userId, input);

    expect(created.name).toBe(`Toast (${dateLabel} 2)`);
    expect(created.normalizedName).toBe(`toast (${dateLabel} 2)`.toLowerCase());
  });
});
