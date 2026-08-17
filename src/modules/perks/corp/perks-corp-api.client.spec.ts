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
