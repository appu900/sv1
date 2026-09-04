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
    /** WeMAD's real envelope, confirmed by them 2026-09-04. */
    const ordersPage = (rows: number[], lastPage: number) => ({
      success: true,
      data: {
        orders: {
          data: rows.map((id) => ({ id })),
          current_page: 1,
          last_page: lastPage,
          per_page: 10,
          total: 6,
        },
        totalOrders: 6,
        totalAmount: '524.76',
        pendingOrders: 0,
        completedOrders: 2,
      },
    });

    it('fetches one page and keeps WeMAD\'s paging envelope', async () => {
      // We used to discard everything but the rows, walk every page and slice.
      // That was up to twenty sequential requests each time a member opened
      // their history; `total` and `per_page` are what let us stop at one.
      const fetchMock = jest.fn().mockImplementation(async () => ({
        status: 200,
        text: async () => JSON.stringify(ordersPage([1, 2, 3], 3)),
      }));
      global.fetch = fetchMock as never;

      const page = await createClient().listOrdersPage('access-1', 2);

      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(String(fetchMock.mock.calls[0][0])).toContain('page=2');
      expect(page.rows).toHaveLength(3);
      expect(page).toMatchObject({ perPage: 10, total: 6, lastPage: 3 });
      expect(page.summary).toMatchObject({
        totalOrders: 6,
        totalAmount: 524.76,
        completedOrders: 2,
      });
    });

    it('survives a response with no pagination block', async () => {
      global.fetch = jest.fn().mockImplementation(async () => ({
        status: 200,
        text: async () => JSON.stringify({ success: true, data: {} }),
      })) as never;

      const page = await createClient().listOrdersPage('access-1');
      expect(page.rows).toEqual([]);
      expect(page.total).toBe(0);
    });

    it('walks the whole catalogue, not just the first page', async () => {
      // Live: 634 cards over 7 pages. Reading page 1 only hid 534 of them.
      const card = (id: number) => ({ id });
      const pages = [
        { success: true, data: Array.from({ length: 100 }, (_, i) => card(i)) },
        { success: true, data: Array.from({ length: 100 }, (_, i) => card(100 + i)) },
        { success: true, data: Array.from({ length: 34 }, (_, i) => card(200 + i)) },
        { success: true, data: [] },
      ];
      let call = 0;
      global.fetch = jest.fn().mockImplementation(async () => ({
        status: 200,
        text: async () => JSON.stringify(pages[Math.min(call++, pages.length - 1)]),
      })) as never;

      const cards = await createClient().listAllGiftCards({
        pageSize: 100,
        batchSize: 4,
      });

      // A short page ends the walk; ids are de-duplicated across pages.
      expect(cards).toHaveLength(234);
    });

    it('stops at the page cap rather than looping forever', async () => {
      global.fetch = jest.fn().mockImplementation(async () => ({
        status: 200,
        text: async () =>
          JSON.stringify({
            success: true,
            // Always a full page: without a cap this would never end.
            data: Array.from({ length: 10 }, (_, i) => ({ id: Math.random() + i })),
          }),
      })) as never;

      const cards = await createClient().listAllGiftCards({
        pageSize: 10,
        maxPages: 6,
        batchSize: 3,
      });
      expect(cards.length).toBeLessThanOrEqual(60);
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
