import { UnprocessableEntityException } from '@nestjs/common';
import { PerksCorpApiError } from './perks-corp-api.client';
import { PerksCorpSessionService } from './perks-corp-session.service';

const USER_ID = '507f1f77bcf86cd799439011';

const validUser = {
  name: 'Saveful Tester',
  email: 'Tester@Saveful.com',
  pincode: '5000',
  phoneNumber: '+61 400 000 000',
  gender: 'male',
} as never;

function createService(overrides: Record<string, unknown> = {}) {
  const api = {
    autologin: jest.fn().mockResolvedValue({
      accessToken: 'access-1',
      webToken: 'web-1',
      wmadUserId: '119',
    }),
    ...(overrides.api as object),
  };
  const cache = new Map<string, unknown>();
  const redis = {
    get: jest.fn(async (key: string) => cache.get(key) ?? null),
    set: jest.fn(async (key: string, value: unknown) => {
      cache.set(key, value);
    }),
    del: jest.fn(async (key: string) => {
      cache.delete(key);
    }),
    ...(overrides.redis as object),
  };
  const config = {
    get: jest.fn((key: string, fallback: unknown) =>
      key === 'PERKS_CREDENTIAL_SECRET' ? 'test-secret' : fallback,
    ),
    ...(overrides.config as object),
  };

  return {
    service: new PerksCorpSessionService(
      api as never,
      redis as never,
      config as never,
    ),
    api,
    redis,
    cache,
  };
}

describe('PerksCorpSessionService', () => {
  describe('derivePassword', () => {
    it('is stable for the same user — WeMAD checks it on every login', () => {
      const { service } = createService();
      expect(service.derivePassword(USER_ID)).toBe(
        service.derivePassword(USER_ID),
      );
    });

    it('differs per user', () => {
      const { service } = createService();
      expect(service.derivePassword(USER_ID)).not.toBe(
        service.derivePassword('507f1f77bcf86cd799439012'),
      );
    });

    it('changes when the credential version is bumped, enabling rotation', () => {
      const { service } = createService();
      expect(service.derivePassword(USER_ID, 1)).not.toBe(
        service.derivePassword(USER_ID, 2),
      );
    });

    it('satisfies WeMAD complexity rules', () => {
      const { service } = createService();
      const password = service.derivePassword(USER_ID);
      expect(password).toMatch(/[A-Z]/);
      expect(password).toMatch(/[a-z]/);
      expect(password).toMatch(/[0-9]/);
      expect(password).toMatch(/[^A-Za-z0-9]/);
      expect(password.length).toBeGreaterThanOrEqual(12);
    });

    it('refuses to derive when the secret is unset rather than using a weak default', () => {
      const { service } = createService({
        config: { get: jest.fn((_key: string, fallback: unknown) => fallback) },
      });
      expect(() => service.derivePassword(USER_ID)).toThrow(
        UnprocessableEntityException,
      );
    });
  });

  describe('missingProfileFields', () => {
    it('accepts a complete profile', () => {
      const { service } = createService();
      expect(service.missingProfileFields(validUser)).toEqual([]);
    });

    it('flags a single-word name', () => {
      const { service } = createService();
      expect(
        service.missingProfileFields({ ...(validUser as object), name: 'Cher' } as never),
      ).toContain('name');
    });

    it('flags an unusable phone number', () => {
      const { service } = createService();
      expect(
        service.missingProfileFields({
          ...(validUser as object),
          phoneNumber: '123',
        } as never),
      ).toContain('phone');
    });

    it('accepts gender supplied by the health profile fallback', () => {
      const { service } = createService();
      const withoutGender = { ...(validUser as object), gender: undefined } as never;
      expect(service.missingProfileFields(withoutGender)).toContain('gender');
      expect(
        service.missingProfileFields(withoutGender, 'female' as never),
      ).not.toContain('gender');
    });
  });

  describe('login', () => {
    it('sends a normalised payload and returns the session', async () => {
      const { service, api } = createService();
      const session = await service.login(USER_ID, validUser);

      expect(api.autologin).toHaveBeenCalledWith(
        expect.objectContaining({
          email: 'tester@saveful.com',
          phone: '61400000000',
          firstname: 'Saveful',
          lastname: 'Tester',
        }),
      );
      expect(session.webToken).toBe('web-1');
    });

    it('refuses to call WeMAD when the profile is incomplete', async () => {
      const { service, api } = createService();
      await expect(
        service.login(USER_ID, { ...(validUser as object), pincode: '' } as never),
      ).rejects.toBeInstanceOf(UnprocessableEntityException);
      expect(api.autologin).not.toHaveBeenCalled();
    });

    it('turns the duplicate-phone 500 into actionable guidance', async () => {
      const { service } = createService({
        api: {
          autologin: jest
            .fn()
            .mockRejectedValue(
              new PerksCorpApiError('boom', 500, 'WMAD_CORP_500', true, true),
            ),
        },
      });

      await expect(service.login(USER_ID, validUser)).rejects.toMatchObject({
        response: { missingFields: ['phone'] },
      });
    });

    it('surfaces a rejected password as a profile problem, not a crash', async () => {
      const { service } = createService({
        api: {
          autologin: jest
            .fn()
            .mockRejectedValue(
              new PerksCorpApiError(
                'Invalid email or password.',
                400,
                'WMAD_CORP_400',
                false,
                false,
              ),
            ),
        },
      });
      await expect(service.login(USER_ID, validUser)).rejects.toBeInstanceOf(
        UnprocessableEntityException,
      );
    });
  });

  describe('token caching', () => {
    it('reuses a cached token instead of logging in again', async () => {
      const { service, api } = createService();
      await service.login(USER_ID, validUser);
      const token = await service.getAccessToken(USER_ID, validUser);

      expect(token).toBe('access-1');
      expect(api.autologin).toHaveBeenCalledTimes(1);
    });

    it('never caches the single-use web token', async () => {
      const { service, cache } = createService();
      await service.login(USER_ID, validUser);
      const cached = JSON.stringify([...cache.values()]);
      expect(cached).toContain('access-1');
      expect(cached).not.toContain('web-1');
    });

    it('re-logs in once when the cached token has been revoked upstream', async () => {
      const { service, api } = createService();
      await service.login(USER_ID, validUser);
      api.autologin.mockResolvedValue({
        accessToken: 'access-2',
        webToken: 'web-2',
        wmadUserId: '119',
      });

      const run = jest
        .fn()
        .mockRejectedValueOnce(
          new PerksCorpApiError('nope', 401, 'WMAD_CORP_401', false, false),
        )
        .mockResolvedValueOnce('ok');

      await expect(
        service.withAccessToken(USER_ID, validUser, run),
      ).resolves.toBe('ok');
      expect(run).toHaveBeenNthCalledWith(1, 'access-1');
      expect(run).toHaveBeenNthCalledWith(2, 'access-2');
    });

    it('does not retry non-auth failures', async () => {
      const { service } = createService();
      await service.login(USER_ID, validUser);
      const run = jest
        .fn()
        .mockRejectedValue(
          new PerksCorpApiError('down', 503, 'UPSTREAM', true, false),
        );

      await expect(
        service.withAccessToken(USER_ID, validUser, run),
      ).rejects.toBeInstanceOf(PerksCorpApiError);
      expect(run).toHaveBeenCalledTimes(1);
    });

    it('clears the cached token on request', async () => {
      const { service, api } = createService();
      await service.login(USER_ID, validUser);
      await service.clearCachedToken(USER_ID);
      await service.getAccessToken(USER_ID, validUser);
      expect(api.autologin).toHaveBeenCalledTimes(2);
    });
  });
});
