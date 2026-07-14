import { PerksController } from './perks.controller';
import { PerksSpendFrequency } from './dto/perks.dto';

describe('PerksController', () => {
  const service = {
    ensureMembership: jest.fn(),
    getEcards: jest.fn(),
    getGiftOptions: jest.fn(),
    createOrder: jest.fn(),
    getOrder: jest.fn(),
    cancelOrder: jest.fn(),
    getTaxReceipt: jest.fn(),
    getWallet: jest.fn(),
    getCalculatorCategories: jest.fn(),
    calculate: jest.fn(),
  };
  const controller = new PerksController(service as never);
  const user = { userId: '507f1f77bcf86cd799439011' };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('wraps authenticated catalogue results in the Saveful envelope', async () => {
    service.getEcards.mockResolvedValue([{ id: '340' }]);

    await expect(controller.getEcards(user)).resolves.toEqual({
      success: true,
      data: [{ id: '340' }],
    });
    expect(service.getEcards).toHaveBeenCalledWith(user.userId);
  });

  it('passes the idempotency key to order creation', async () => {
    const dto = { ecardId: '340', ecardValue: 50, quantity: 1 };
    service.createOrder.mockResolvedValue({ orderNumber: '123' });

    await controller.createOrder(user, 'checkout_123', dto);

    expect(service.createOrder).toHaveBeenCalledWith(
      user.userId,
      'checkout_123',
      dto,
    );
  });

  it('exposes stateless calculator results', () => {
    const dto = {
      items: [
        {
          category: 'groceries',
          amount: 100,
          frequency: PerksSpendFrequency.WEEKLY,
        },
      ],
    };
    service.calculate.mockReturnValue({ totals: { annual: 234 } });

    expect(controller.calculate(dto)).toEqual({
      success: true,
      data: { totals: { annual: 234 } },
    });
  });
});
