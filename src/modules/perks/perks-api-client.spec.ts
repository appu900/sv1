import { ConfigService } from '@nestjs/config';
import { PerksApiClient } from './perks-api-client';

class RedisStub {
  private readonly values = new Map<string, unknown>();

  async get<T>(key: string): Promise<T | null> {
    return (this.values.get(key) as T | undefined) ?? null;
  }

  async set(key: string, value: unknown) {
    this.values.set(key, value);
  }

  async del(key: string) {
    this.values.delete(key);
  }

  async setIfAbsent(key: string, value: string) {
    if (this.values.has(key)) return false;
    this.values.set(key, value);
    return true;
  }

  async releaseLock(key: string, value: string) {
    if (this.values.get(key) === value) {
      this.values.delete(key);
      return true;
    }
    return false;
  }
}

function response(data: unknown, status = 200) {
  return Promise.resolve(
    new Response(JSON.stringify(data), {
      status,
      headers: { 'Content-Type': 'application/json' },
    }),
  );
}

describe('PerksApiClient', () => {
  let fetchMock: jest.Mock;
  let redis: RedisStub;
  let client: PerksApiClient;

  beforeEach(() => {
    fetchMock = jest.fn();
    global.fetch = fetchMock;
    redis = new RedisStub();
    const config = new ConfigService({
      WMAD_API_BASE_URL: 'https://api.wemad.test/v1/api',
      WMAD_API_EMAIL: 'merchant@example.com',
      WMAD_API_PASSWORD: 'secret',
      WMAD_CLIENT_ID: '178',
      WMAD_API_TIMEOUT_MS: 1000,
    });
    client = new PerksApiClient(config, redis as never);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('authenticates, caches the weekly token, and redacts it from results', async () => {
    fetchMock
      .mockImplementationOnce(() =>
        response({
          status: 200,
          message: 'Success',
          data: {
            token: 'merchant-token',
            expire: 7 * 24 * 60 * 60,
          },
        }),
      )
      .mockImplementationOnce(() =>
        response({ status: 200, message: 'Success', data: [] }),
      )
      .mockImplementationOnce(() =>
        response({ status: 200, message: 'Success', data: [] }),
      );

    await expect(client.getEcards()).resolves.toEqual([]);
    await expect(client.getEcards()).resolves.toEqual([]);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(fetchMock.mock.calls[1][1].headers.Authorization).toBe(
      'Bearer merchant-token',
    );

    const cached = await redis.get<{ token: string }>(
      'perks:wmad:merchant-token',
    );
    expect(cached?.token).toBe('merchant-token');
  });

  it('refreshes once when WMAD rejects a cached token', async () => {
    await redis.set('perks:wmad:merchant-token', {
      token: 'expired-token',
      expiresAt: Date.now() + 2 * 24 * 60 * 60 * 1000,
    });
    fetchMock
      .mockImplementationOnce(() =>
        response(
          { status: 401, message: 'Invalid token', code: 'INVALIDTOKEN' },
          401,
        ),
      )
      .mockImplementationOnce(() =>
        response({
          status: 200,
          data: {
            token: 'new-token',
            expire: Math.floor(Date.now() / 1000) + 7 * 24 * 60 * 60,
          },
        }),
      )
      .mockImplementationOnce(() =>
        response({ status: 200, data: [{ ecard_id: '1' }] }),
      );

    await expect(client.getEcards()).resolves.toEqual([{ ecard_id: '1' }]);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(fetchMock.mock.calls[2][1].headers.Authorization).toBe(
      'Bearer new-token',
    );
  });

  it('uses the documented live endpoint contracts', async () => {
    await redis.set('perks:wmad:merchant-token', {
      token: 'token',
      expiresAt: Date.now() + 2 * 24 * 60 * 60 * 1000,
    });
    fetchMock.mockImplementation(() => response({ status: 200, data: {} }));

    await client.registerUser({
      firstname: 'Saveful',
      lastname: 'Tester',
      email: 'tester@example.com',
      postcode: '5000',
      phone: '61412345678',
      gender: 1,
    });
    await client.getGiftOptions();
    await client.createOrder({ ecard_id: '242' });
    await client.getOrderDetail('123');
    await client.cancelOrder('123');
    await client.getTaxReceipt('123');
    await client.getWallet();
    await client.getGiftedWallet();

    expect(
      fetchMock.mock.calls.map(([url, init]) => [
        String(url).replace('https://api.wemad.test/v1/api', ''),
        init.method,
      ]),
    ).toEqual([
      ['/register', 'POST'],
      ['/order/sendgiftdetail', 'GET'],
      ['/order', 'POST'],
      ['/order/detail', 'POST'],
      ['/order/cancel', 'POST'],
      ['/order/taxreceipt', 'POST'],
      ['/ewallet', 'GET'],
      ['/ewallet/gifted', 'GET'],
    ]);
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({
      firstname: 'Saveful',
      lastname: 'Tester',
      email: 'tester@example.com',
      postcode: '5000',
      phone: '61412345678',
      gender: 1,
    });
  });

  it('treats a timed-out POST as ambiguous', async () => {
    await redis.set('perks:wmad:merchant-token', {
      token: 'token',
      expiresAt: Date.now() + 2 * 24 * 60 * 60 * 1000,
    });
    fetchMock.mockRejectedValue(
      Object.assign(new Error('aborted'), { name: 'AbortError' }),
    );

    await expect(client.createOrder({})).rejects.toMatchObject({
      code: 'UPSTREAM_TIMEOUT',
      ambiguous: true,
      retryable: true,
    });
  });
});
