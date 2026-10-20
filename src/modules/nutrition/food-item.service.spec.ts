/// <reference types="jest" />

import { FoodSource } from '../../database/schemas/nutrition/food-item.schema';
import { FoodItemService } from './food-item.service';

function mockQueryResult<T>(value: T) {
  return {
    sort: jest.fn().mockReturnThis(),
    lean: jest.fn().mockReturnThis(),
    exec: jest.fn().mockResolvedValue(value),
  };
}

describe('FoodItemService', () => {
  let foodModel: any;
  let service: FoodItemService;

  beforeEach(() => {
    foodModel = {
      findOne: jest.fn().mockReturnValue(mockQueryResult(null)),
      findOneAndUpdate: jest.fn().mockReturnValue(mockQueryResult({ _id: 'new' })),
      bulkWrite: jest.fn().mockResolvedValue({}),
      find: jest.fn().mockReturnValue(mockQueryResult([])),
    };
    service = new FoodItemService(foodModel);
  });

  // A second explicit `barcode: null` hits the unique sparse index (E11000),
  // which made every barcode-less product photo scan return a 500.
  it('does not write a null barcode when upserting a photo-analysed product', async () => {
    await service.upsert({
      canonicalName: 'blueberry bread pudding',
      displayName: 'Blueberry Bread Pudding',
      brand: null,
      barcode: null,
      source: FoodSource.AI,
      locale: 'in',
    });

    const [filter, update] = foodModel.findOneAndUpdate.mock.calls[0];
    expect(filter).toEqual({
      canonicalName: 'blueberry bread pudding',
      brand: null,
      locale: 'in',
      source: FoodSource.AI,
    });
    expect(update.$set).not.toHaveProperty('barcode');
    expect(update.$set.displayName).toBe('Blueberry Bread Pudding');
  });

  it('keeps a real barcode', async () => {
    await service.upsert({ canonicalName: 'oat milk', barcode: '9300601000000' });

    const [filter, update] = foodModel.findOneAndUpdate.mock.calls[0];
    expect(filter).toEqual({ barcode: '9300601000000' });
    expect(update.$set.barcode).toBe('9300601000000');
  });

  it('does not write empty barcodes in bulk upserts', async () => {
    await service.bulkUpsert([
      { canonicalName: 'a', barcode: null },
      { canonicalName: 'b', barcode: '' },
      { canonicalName: 'c', barcode: '123456' },
    ]);

    const ops = foodModel.bulkWrite.mock.calls[0][0];
    expect(ops[0].updateOne.update.$set).not.toHaveProperty('barcode');
    expect(ops[1].updateOne.update.$set).not.toHaveProperty('barcode');
    expect(ops[2].updateOne.update.$set.barcode).toBe('123456');
  });
});
