import { PerksCorpApiClient, PerksCorpApiError } from './perks-corp-api.client';

const FRONTEND = 'https://sandbox.wemad.com.au/frontend';

function createClient() {
  const config = {
    get: jest.fn((key: string, fallback: unknown) => {
      if (key === 'WMAD_CORP_FRONTEND_URL') return FRONTEND;
      if (key === 'WMAD_CORP_CLIENT_SECRET') return 'test-secret';
      return fallback;
    }),
  };
  return new PerksCorpApiClient(config as never);
}

function mockJson(body: unknown, status = 200) {
  return jest.fn().mockResolvedValue({
    status,
    text: async () => JSON.stringify(body),
  } as never);
}

describe('PerksCorpApiClient', () => {
  const realFetch = global.fetch;
  afterEach(() => {
    global.fetch = realFetch;
  });

  describe('pagination', () => {
    // WeMAD fixes per_page at 10 and ignores per_page/limit/paginate (verified
    // live), so anything past the first page is only reachable by walking.
    const ordersPage = (rows: number[], lastPage: number) => ({
      success: true,
      data: {
        orders: { data: rows.map((id) => ({ id })), last_page: lastPage },
      },
    });

    it('walks every page of orders rather than stopping at the first 10', async () => {
      const pages = [
        ordersPage([1, 2, 3], 3),
        ordersPage([4, 5, 6], 3),
        ordersPage([7], 3),
      ];
      let call = 0;
      const fetchMock = jest.fn().mockImplementation(async () => ({
        status: 200,
        text: async () => JSON.stringify(pages[call++]),
      }));
      global.fetch = fetchMock as never;

      const orders = await createClient().listOrders('access-1');

      expect(orders).toHaveLength(7);
      expect(fetchMock).toHaveBeenCalledTimes(3);
      expect(String(fetchMock.mock.calls[1][0])).toContain('page=2');
    });

    it('stops on an empty page even when last_page over-reports', async () => {
      const pages = [ordersPage([1], 99), ordersPage([], 99)];
      let call = 0;
      global.fetch = jest.fn().mockImplementation(async () => ({
        status: 200,
        text: async () => JSON.stringify(pages[Math.min(call++, 1)]),
      })) as never;

      await expect(createClient().listOrders('access-1')).resolves.toHaveLength(1);
    });

    it('reads the wallet from the paginated items shape', async () => {
      const page = (items: number[], lastPage: number) => ({
        success: true,
        data: {
          items: items.map((id) => ({ id })),
          pagination: { current_page: 1, last_page: lastPage, total: 3 },
        },
      });
      const pages = [page([1, 2], 2), page([3], 2)];
      let call = 0;
      global.fetch = jest.fn().mockImplementation(async () => ({
        status: 200,
        text: async () => JSON.stringify(pages[Math.min(call++, 1)]),
      })) as never;

      await expect(
        createClient().listMyGiftCards('access-1'),
      ).resolves.toHaveLength(3);
    });

    it('still handles a plain array wallet response', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        status: 200,
        text: async () => JSON.stringify({ success: true, data: [{ id: 1 }] }),
      }) as never;

      await expect(
        createClient().listMyGiftCards('access-1'),
      ).resolves.toHaveLength(1);
    });
  });

  describe('createSsoUrl', () => {
    const payload = {
      first_name: 'Saveful',
      last_name: 'Tester',
      email: 'tester@saveful.com',
      phone: '61400000000',
      redirect_url: '/checkout',
    };

    it('returns the URL WeMAD minted and signs the call with the user token', async () => {
      const fetchMock = mockJson({
        success: true,
        data: {
          login_url: `${FRONTEND}/sso/login?token=abc123`,
          expires_in: 300,
        },
      });
      global.fetch = fetchMock as never;

      await expect(createClient().createSsoUrl('access-1', payload)).resolves.toBe(
        `${FRONTEND}/sso/login?token=abc123`,
      );

      const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(url).toContain('/sso/login');
      expect(init.method).toBe('POST');
      expect(JSON.parse(String(init.body))).toMatchObject({
        redirect_url: '/checkout',
      });
      const headers = init.headers as Record<string, string>;
      expect(headers.Authorization).toBe('Bearer access-1');
      expect(headers['X-SIGNATURE']).toMatch(/^[a-f0-9]{64}$/);
    });

    it('repoints a LAN host at the configured frontend — phones cannot reach theirs', async () => {
      global.fetch = mockJson({
        success: true,
        data: { login_url: 'http://192.168.1.14:8000/frontend/sso/login?token=abc' },
      }) as never;

      await expect(createClient().createSsoUrl('access-1', payload)).resolves.toBe(
        `${FRONTEND}/sso/login?token=abc`,
      );
    });

    it('leaves any other public host untouched', async () => {
      global.fetch = mockJson({
        success: true,
        data: { login_url: 'https://www.wemad.com.au/frontend/sso/login?token=abc' },
      }) as never;

      await expect(createClient().createSsoUrl('access-1', payload)).resolves.toBe(
        'https://www.wemad.com.au/frontend/sso/login?token=abc',
      );
    });

    it('fails loudly when no URL comes back rather than sending users nowhere', async () => {
      global.fetch = mockJson({ success: true, data: {} }) as never;

      await expect(
        createClient().createSsoUrl('access-1', payload),
      ).rejects.toBeInstanceOf(PerksCorpApiError);
    });
  });
});
