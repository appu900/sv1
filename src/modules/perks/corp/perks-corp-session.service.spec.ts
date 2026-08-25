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
    createSsoUrl: jest
      .fn()
      .mockResolvedValue('https://sandbox.wemad.com.au/frontend/sso/login?token=sso-1'),
    buildCheckoutUrl: jest.fn(
      (token: string) =>
        `https://sandbox.wemad.com.au/frontend/sso/login?token=${token}`,
    ),
    changeMembership: jest.fn().mockResolvedValue(undefined),
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

    // WeMAD wants the Australian national number and nothing else: their
    // production API answers anything but nine digits with
    // 422 "The phone field must be 9 digits". We used to forward 8-11 digits
    // untouched, so every real Australian mobile went with its leading zero
    // and no member could ever complete sign-up.
    it('reduces every way of writing an Australian mobile to nine digits', () => {
      const { service, api } = createService();
      const forms = [
        '0412 228 301',
        '+61 412 228 301',
        '61412228301',
        '0061412228301',
        '412228301',
      ];

      for (const phoneNumber of forms) {
        expect(
          service.missingProfileFields({
            ...(validUser as object),
            phoneNumber,
          } as never),
        ).not.toContain('phone');
      }

      return Promise.all(
        forms.map(async (phoneNumber) => {
          api.autologin.mockClear();
          await service.login(USER_ID, {
            ...(validUser as object),
            phoneNumber,
          } as never);
          expect(api.autologin.mock.calls[0][0].phone).toBe('412228301');
        }),
      );
    });

    it('accepts a long number by keeping its last nine digits', () => {
      // WeMAD takes nine digits and nothing else, so rather than turning a
      // member away over formatting we keep the subscriber number.
      const { service } = createService();
      expect(
        service.missingProfileFields({
          ...(validUser as object),
          phoneNumber: '8260951404',
        } as never),
      ).not.toContain('phone');
    });

    it('still flags a number too short to use', () => {
      const { service } = createService();
      expect(
        service.missingProfileFields({
          ...(validUser as object),
          phoneNumber: '12345',
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

  describe('applyMembershipTier', () => {
  // Off unless configured: WeMAD's /change-membership answers 500 for every id
  // (their own `Unknown column 'site_id'`), and a member with no upgrade
  // already receives the advertised discount. Retrying a broken endpoint on
  // every visit would buy nothing.
  it('does nothing when no tier is configured', async () => {
    const { service, api } = createService({
      config: { get: jest.fn((_key: string, fallback: unknown) => fallback) },
    });

    await expect(service.applyMembershipTier('access-1')).resolves.toBeNull();
    expect(api.changeMembership).not.toHaveBeenCalled();
  });

  it('upgrades and reports the tier once one is configured', async () => {
    const { service, api } = createService({
      config: {
        get: jest.fn((key: string, fallback: unknown) =>
          key === 'WMAD_CORP_MEMBERSHIP_ID' ? '3' : fallback,
        ),
      },
    });

    await expect(service.applyMembershipTier('access-1')).resolves.toBe('3');
    expect(api.changeMembership).toHaveBeenCalledWith('access-1', '3');
  });

  it('reports null rather than throwing when WeMAD rejects it', async () => {
    // Registration must survive this: a member on the wrong tier can still
    // shop, one whose sign-up blew up cannot.
    const { service } = createService({
      config: {
        get: jest.fn((key: string, fallback: unknown) =>
          key === 'WMAD_CORP_MEMBERSHIP_ID' ? '3' : fallback,
        ),
      },
      api: {
        changeMembership: jest
          .fn()
          .mockRejectedValue(new Error('SQLSTATE[42S22]: Unknown column')),
      },
    });

    await expect(service.applyMembershipTier('access-1')).resolves.toBeNull();
  });
});

describe('login', () => {
    it('sends a normalised payload and returns the session', async () => {
      const { service, api } = createService();
      const session = await service.login(USER_ID, validUser);

      expect(api.autologin).toHaveBeenCalledWith(
        expect.objectContaining({
          email: 'tester@saveful.com',
          // Nine digits, no country code, no trunk zero.
          phone: '400000000',
          firstname: 'Saveful',
          lastname: 'Tester',
        }),
      );
      expect(session.webToken).toBe('web-1');
    });

    it('sends the device fields WeMAD now requires, one identity per user', async () => {
      // Mandatory since 2026-08; missing any one returns 422. Their sample used
      // a single hard-coded device_id, which would make every Saveful member
      // look like one handset to the tracking this was added for.
      const { service, api } = createService();
      await service.login(USER_ID, validUser);

      const payload = api.autologin.mock.calls[0][0];
      for (const field of [
        'device_id',
        'platform',
        'device_type',
        'device_name',
        'device_model',
        'os_version',
        'app_version',
        'push_token',
      ]) {
        expect(String(payload[field] ?? '')).not.toHaveLength(0);
      }

      const other = createService();
      await other.service.login('507f1f77bcf86cd799439012', validUser);
      expect(other.api.autologin.mock.calls[0][0].device_id).not.toBe(
        payload.device_id,
      );
    });

    it('keeps a user on the same device_id across logins', async () => {
      const { service, api } = createService();
      await service.login(USER_ID, validUser);
      await service.login(USER_ID, validUser);
      expect(api.autologin.mock.calls[0][0].device_id).toBe(
        api.autologin.mock.calls[1][0].device_id,
      );
    });

    it('refuses to call WeMAD when the profile is incomplete', async () => {
      const { service, api } = createService();
      await expect(
        service.login(USER_ID, { ...(validUser as object), pincode: '' } as never),
      ).rejects.toBeInstanceOf(UnprocessableEntityException);
      expect(api.autologin).not.toHaveBeenCalled();
    });

    it('surfaces an upstream 500 as a temporary outage', async () => {
      const { service } = createService({
        api: {
          autologin: jest
            .fn()
            .mockRejectedValue(
              new PerksCorpApiError('boom', 500, 'WMAD_CORP_500', true, true),
            ),
        },
      });

      const error = await service.login(USER_ID, validUser).catch((e) => e);
      expect(error.getStatus()).toBe(503);
      expect(error.getResponse()).toMatchObject({
        code: 'PERKS_UPSTREAM_UNAVAILABLE',
      });
    });

    it('tells the user to contact support when the upstream account rejects our password', async () => {
      // Editing a Saveful profile cannot fix a password mismatch on WeMAD's
      // side, so this must not be dressed up as a profile gap.
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

      const error = await service.login(USER_ID, validUser).catch((e) => e);
      expect(error).toBeInstanceOf(UnprocessableEntityException);
      expect(error.getResponse()).toMatchObject({
        code: 'PERKS_ACCOUNT_LINK_FAILED',
      });
      expect(error.getResponse().missingFields).toBeUndefined();
    });
  });

  describe('createCheckoutUrl', () => {
    const session = {
      accessToken: 'access-1',
      webToken: 'web-1',
      wmadUserId: '119',
    };

    it('asks WeMAD for a checkout URL rather than reusing the web token', async () => {
      const { service, api } = createService();

      await expect(service.createCheckoutUrl(session, validUser)).resolves.toBe(
        'https://sandbox.wemad.com.au/frontend/sso/login?token=sso-1',
      );
      expect(api.createSsoUrl).toHaveBeenCalledWith('access-1', {
        first_name: 'Saveful',
        last_name: 'Tester',
        email: 'tester@saveful.com',
        phone: '400000000',
        redirect_url: '/checkout',
      });
      expect(api.buildCheckoutUrl).not.toHaveBeenCalled();
    });

    it('falls back to the web token when /sso/login fails', async () => {
      const { service } = createService({
        api: {
          createSsoUrl: jest
            .fn()
            .mockRejectedValue(
              new PerksCorpApiError('down', 502, 'UPSTREAM', true, false),
            ),
        },
      });

      await expect(service.createCheckoutUrl(session, validUser)).resolves.toContain(
        'token=web-1',
      );
    });

    it('rethrows when there is no web token to fall back to', async () => {
      const { service } = createService({
        api: {
          createSsoUrl: jest
            .fn()
            .mockRejectedValue(
              new PerksCorpApiError('down', 502, 'UPSTREAM', true, false),
            ),
        },
      });

      await expect(
        service.createCheckoutUrl({ ...session, webToken: '' }, validUser),
      ).rejects.toBeInstanceOf(PerksCorpApiError);
    });
  });

  describe('duplicate phone (WeMAD fixed this to a 400 in 2026-08)', () => {
    it('tells the user the phone is taken, using their live wording', async () => {
      const { service } = createService({
        api: {
          autologin: jest.fn().mockRejectedValue(
            new PerksCorpApiError(
              // Verbatim from the sandbox after their fix.
              'This phone number is already registered in different account.',
              400,
              'WMAD_CORP_400',
              false,
              false,
            ),
          ),
        },
      });

      await expect(service.login(USER_ID, validUser)).rejects.toMatchObject({
        response: {
          code: 'PERKS_PHONE_ALREADY_REGISTERED',
          missingFields: ['phone'],
        },
      });
    });

    it('reports an upstream outage as an outage, not a phone problem', async () => {
      // Live on 2026-08-18: every autologin returned a PHP TypeError from
      // UserDeviceService. Telling those users their phone was taken sent them
      // to edit a profile that was fine.
      const { service } = createService({
        api: {
          autologin: jest.fn().mockRejectedValue(
            new PerksCorpApiError(
              'App\\Services\\UserDeviceService::save(): Argument #1 must be of type UserResource',
              500,
              'WMAD_CORP_500',
              true,
              false,
            ),
          ),
        },
      });

      const error = await service.login(USER_ID, validUser).catch((e) => e);
      expect(error.getStatus()).toBe(503);
      expect(error.getResponse()).toMatchObject({
        code: 'PERKS_UPSTREAM_UNAVAILABLE',
      });
      // No missingFields: nothing about their profile needs changing.
      expect(error.getResponse().missingFields).toBeUndefined();
    });

    it('does not mistake an ordinary validation failure for a taken phone', async () => {
      const { service } = createService({
        api: {
          autologin: jest.fn().mockRejectedValue(
            new PerksCorpApiError(
              'The first name field is required.',
              422,
              'WMAD_CORP_422',
              false,
              false,
            ),
          ),
        },
      });

      await expect(service.login(USER_ID, validUser)).rejects.toMatchObject({
        response: { code: 'WMAD_CORP_422' },
      });
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
      const cached = JSON.stringify(Array.from(cache.values()));
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
