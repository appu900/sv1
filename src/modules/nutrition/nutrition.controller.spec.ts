import { NotFoundException } from '@nestjs/common';
import { NutritionController } from './nutrition.controller';

function createUserModel(country = 'IN') {
  return {
    findById: jest.fn().mockReturnValue({
      select: jest.fn().mockReturnValue({
        lean: jest.fn().mockReturnValue({
          exec: jest.fn().mockResolvedValue({ country }),
        }),
      }),
    }),
  };
}

function createController() {
  const barcodeLookup = {
    lookupForCountry: jest.fn(),
  };
  const subscriptionService = {
    incrementUsage: jest.fn().mockResolvedValue(1),
    refundUsage: jest.fn().mockResolvedValue(undefined),
  };
  const userModel = createUserModel();
  const controller = new NutritionController(
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    barcodeLookup as any,
    {} as any,
    {} as any,
    subscriptionService as any,
    userModel as any,
  );

  return { controller, barcodeLookup, subscriptionService, userModel };
}

describe('NutritionController barcode usage', () => {
  const userId = '69594e88ba30cbe0824fff04';
  const req = { user: { _id: userId } };

  it('records kitchen scan usage when barcode lookup succeeds', async () => {
    const { controller, barcodeLookup, subscriptionService } = createController();
    const result = { source: 'catalog', item: { id: 'food-1' } };
    barcodeLookup.lookupForCountry.mockResolvedValue(result);

    await expect(
      controller.lookupBarcode(req, { barcode: '8901234567890' }),
    ).resolves.toBe(result);

    expect(subscriptionService.incrementUsage).toHaveBeenCalledWith(
      userId,
      'kitchenScansUsed',
    );
    expect(barcodeLookup.lookupForCountry).toHaveBeenCalledWith(
      '8901234567890',
      'IN',
    );
    expect(subscriptionService.refundUsage).not.toHaveBeenCalled();
  });

  it('refunds kitchen scan usage when barcode lookup finds no product', async () => {
    const { controller, barcodeLookup, subscriptionService } = createController();
    barcodeLookup.lookupForCountry.mockResolvedValue(null);

    await expect(
      controller.lookupBarcode(req, { barcode: '8901234567890' }),
    ).rejects.toBeInstanceOf(NotFoundException);

    expect(subscriptionService.incrementUsage).toHaveBeenCalledWith(
      userId,
      'kitchenScansUsed',
    );
    expect(subscriptionService.refundUsage).toHaveBeenCalledWith(
      userId,
      'kitchenScansUsed',
    );
  });

  it('does not lookup barcode or refund when usage reservation is denied', async () => {
    const { controller, barcodeLookup, subscriptionService } = createController();
    const limitError = new Error('limit reached');
    subscriptionService.incrementUsage.mockRejectedValue(limitError);

    await expect(
      controller.lookupBarcode(req, { barcode: '8901234567890' }),
    ).rejects.toBe(limitError);

    expect(barcodeLookup.lookupForCountry).not.toHaveBeenCalled();
    expect(subscriptionService.refundUsage).not.toHaveBeenCalled();
  });
});
