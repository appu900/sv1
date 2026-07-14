import { PerksController } from './perks.controller';
import { PerksSpendFrequency } from './dto/perks.dto';

describe('PerksController', () => {
  const service = {
    getMembershipStatus: jest.fn(),
    ensureMembership: jest.fn(),
    getEcards: jest.fn(),
    getCatalogue: jest.fn(),
    getCatalogueCard: jest.fn(),
    getGiftOptions: jest.fn(),
    getFavourites: jest.fn(),
    addFavourite: jest.fn(),
    removeFavourite: jest.fn(),
    getDashboard: jest.fn(),
    getCart: jest.fn(),
    addCartItem: jest.fn(),
    updateCartItem: jest.fn(),
    deleteCartItem: jest.fn(),
    quoteCart: jest.fn(),
    quote: jest.fn(),
    checkoutCart: jest.fn(),
    createOrder: jest.fn(),
    listOrders: jest.fn(),
    getOrder: jest.fn(),
    cancelOrder: jest.fn(),
    getTaxReceipt: jest.fn(),
    getWallet: jest.fn(),
    getWalletCard: jest.fn(),
    setWalletArchived: jest.fn(),
    hideWalletCard: jest.fn(),
    getCalculatorCategories: jest.fn(),
    getLatestCalculation: jest.fn(),
    calculate: jest.fn(),
    calculateAndSave: jest.fn(),
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

  it('exposes the authoritative card quote route without a user mutation', async () => {
    const dto = { ecardId: '340', ecardValue: 19.99, quantity: 2 };
    service.quote.mockResolvedValue({
      currency: 'AUD',
      items: [{ itemId: 'preview', totalCents: 3800 }],
    });

    await expect(controller.quote(dto)).resolves.toEqual({
      success: true,
      data: {
        currency: 'AUD',
        items: [{ itemId: 'preview', totalCents: 3800 }],
      },
    });
    expect(service.quote).toHaveBeenCalledWith(dto);
  });

  it('passes checkout idempotency and payment-required results through', async () => {
    service.checkoutCart.mockResolvedValue({
      status: 'payment_required',
      issuanceEnabled: false,
      quote: { currency: 'AUD' },
    });

    await expect(
      controller.checkoutCart(user, 'checkout_123'),
    ).resolves.toMatchObject({
      success: true,
      data: {
        status: 'payment_required',
        issuanceEnabled: false,
      },
    });
    expect(service.checkoutCart).toHaveBeenCalledWith(
      user.userId,
      'checkout_123',
    );
  });

  it('persists calculator results for the authenticated user', async () => {
    const dto = {
      items: [
        {
          category: 'groceries',
          amount: 100,
          frequency: PerksSpendFrequency.WEEKLY,
        },
      ],
    };
    service.calculateAndSave.mockResolvedValue({ totals: { annual: 234 } });

    await expect(controller.calculate(user, dto)).resolves.toEqual({
      success: true,
      data: { totals: { annual: 234 } },
    });
  });
});
