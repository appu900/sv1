import {
  HttpException,
  Injectable,
  Logger,
  ServiceUnavailableException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash, createHmac } from 'crypto';
import { Gender } from '../../../database/schemas/nutrition/health-profile.schema';
import { User } from '../../../database/schemas/user.auth.schema';
import { RedisService } from '../../../redis/redis.service';
import { cacheAttempt } from './cache';
import {
  CorpSession,
  PerksCorpApiClient,
  PerksCorpApiError,
} from './perks-corp-api.client';

export type PerksMissingField = 'name' | 'phone' | 'pincode' | 'gender';

interface CachedCorpToken {
  accessToken: string;
  wmadUserId: string;
}


@Injectable()
export class PerksCorpSessionService {
  private readonly logger = new Logger(PerksCorpSessionService.name);
  private readonly credentialSecret: string;
  private readonly tokenTtlSeconds: number;

  constructor(
    private readonly api: PerksCorpApiClient,
    private readonly redis: RedisService,
    private readonly config: ConfigService,
  ) {
    this.credentialSecret = this.config
      .get<string>('PERKS_CREDENTIAL_SECRET', '')
      .trim();
    this.tokenTtlSeconds = Number(
      this.config.get<number>('PERKS_CORP_TOKEN_TTL_SECONDS', 6 * 60 * 60),
    );
  }

 
  derivePassword(userId: string, credentialVersion = 1): string {
    if (!this.credentialSecret) {
      this.logger.error('PERKS_CREDENTIAL_SECRET is not configured');
      throw new UnprocessableEntityException({
        message: 'Perks is not configured. Please contact support.',
        code: 'PERKS_NOT_CONFIGURED',
      });
    }
    const digest = createHmac('sha256', this.credentialSecret)
      .update(`${userId}:${credentialVersion}`)
      .digest('hex');
    return `Sv${digest.slice(0, 16)}@1`;
  }

  missingProfileFields(
    user: Pick<User, 'name' | 'pincode' | 'gender' | 'phoneNumber'>,
    fallbackGender?: Gender | null,
  ): PerksMissingField[] {
    const missing: PerksMissingField[] = [];
    const nameParts = (user.name ?? '').trim().split(/\s+/).filter(Boolean);
    if (nameParts.length < 2) missing.push('name');
    if (!this.normalisePhone(user.phoneNumber)) missing.push('phone');
    if (!/^\d{4,}$/.test((user.pincode ?? '').trim())) missing.push('pincode');
    if (!user.gender && !fallbackGender) missing.push('gender');
    return missing;
  }

  async login(
    userId: string,
    user: User,
    options: { credentialVersion?: number; fallbackGender?: Gender | null } = {},
  ): Promise<CorpSession> {
    const { credentialVersion = 1, fallbackGender = null } = options;

    const missing = this.missingProfileFields(user, fallbackGender);
    if (missing.length > 0) {
      throw new UnprocessableEntityException({
        message: 'Complete your Saveful profile before using Perks',
        missingFields: missing,
      });
    }

    const nameParts = user.name.trim().split(/\s+/).filter(Boolean);
    const payload = {
      email: user.email.toLowerCase(),
      phone: this.normalisePhone(user.phoneNumber) as string,
      firstname: nameParts[0],
      lastname: nameParts.slice(1).join(' '),
      password: this.derivePassword(userId, credentialVersion),
      ...this.deviceFields(userId),
    };

    try {
      const session = await this.api.autologin(payload);
      await this.cacheToken(userId, session);
      return session;
    } catch (error) {
      throw this.explainLoginFailure(error, user, fallbackGender);
    }
  }

  /**
   * WeMAD asked us to send people to checkout through `POST /sso/login` with
   * `redirect_url` rather than the autologin `web_token`, which lands on their
   * dashboard/cart. Both tokens are single-use and short-lived, so this must be
   * called with a session minted for this checkout tap.
   *
   * Falls back to the `web_token` URL if `/sso/login` fails — a cart that is
   * already synced upstream is still completable from their cart page, and
   * losing checkout entirely would be worse than landing a page early.
   */
  async createCheckoutUrl(session: CorpSession, user: User): Promise<string> {
    const nameParts = (user.name ?? '').trim().split(/\s+/).filter(Boolean);
    try {
      return await this.api.createSsoUrl(session.accessToken, {
        first_name: nameParts[0] ?? '',
        last_name: nameParts.slice(1).join(' '),
        email: user.email.toLowerCase(),
        phone: this.normalisePhone(user.phoneNumber) as string,
        redirect_url: '/checkout',
      });
    } catch (error) {
      if (!session.webToken) throw error;
      this.logger.warn(
        `WeMAD /sso/login failed, falling back to the autologin web_token: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return this.api.buildCheckoutUrl(session.webToken);
    }
  }

  async getAccessToken(
    userId: string,
    user: User,
    options: { credentialVersion?: number; fallbackGender?: Gender | null } = {},
  ): Promise<string> {
    const cached = await this.readCachedToken(userId);
    if (cached?.accessToken) return cached.accessToken;
    const session = await this.login(userId, user, options);
    return session.accessToken;
  }

  async withAccessToken<T>(
    userId: string,
    user: User,
    run: (accessToken: string) => Promise<T>,
    options: { credentialVersion?: number; fallbackGender?: Gender | null } = {},
  ): Promise<T> {
    const token = await this.getAccessToken(userId, user, options);
    try {
      return await run(token);
    } catch (error) {
      if (!this.isUnauthorised(error)) throw error;
      await this.clearCachedToken(userId);
      const fresh = await this.login(userId, user, options);
      return run(fresh.accessToken);
    }
  }

  async clearCachedToken(userId: string): Promise<void> {
    await cacheAttempt(() => this.redis.del(this.tokenKey(userId)));
  }

  private async cacheToken(userId: string, session: CorpSession) {
    await cacheAttempt(() =>
      this.redis.set(
        this.tokenKey(userId),
        { accessToken: session.accessToken, wmadUserId: session.wmadUserId },
        this.tokenTtlSeconds,
      ),
    );
  }

  private async readCachedToken(userId: string): Promise<CachedCorpToken | null> {
    return cacheAttempt(() =>
      this.redis.get<CachedCorpToken>(this.tokenKey(userId)),
    );
  }

  private tokenKey(userId: string) {
    return `perks:corp:token:${userId}`;
  }

  /**
   * Also accepts an already-converted HttpException so the retry still works if
   * a caller wraps the upstream call in error translation — getting that
   * nesting wrong previously disabled token refresh silently.
   */
  private isUnauthorised(error: unknown) {
    if (error instanceof PerksCorpApiError) return error.statusCode === 401;
    if (error instanceof HttpException) return error.getStatus() === 401;
    return false;
  }

  /**
   * Device identity for WeMAD's tracking, required on every autologin.
   *
   * `device_id` is derived per Saveful user rather than being one shared
   * constant: their example value would have made every member of ours look
   * like the same handset, which is the pattern their security feature exists
   * to spot. It is a plain hash of the user id — stable, no secret involved,
   * and it tells them nothing they do not already know from the login itself.
   *
   * The rest describe our backend. Their API does not validate these values
   * (verified: `platform: 'server'` is accepted), and claiming to be a Samsung
   * would put junk in their analytics.
   */
  private deviceFields(userId: string) {
    return {
      device_id: `sv-${createHash('sha256').update(userId).digest('hex').slice(0, 24)}`,
      platform: this.config.get<string>('PERKS_CORP_PLATFORM', 'server'),
      device_type: this.config.get<string>('PERKS_CORP_DEVICE_TYPE', 'server'),
      device_name: this.config.get<string>('PERKS_CORP_DEVICE_NAME', 'Saveful'),
      device_model: this.config.get<string>(
        'PERKS_CORP_DEVICE_MODEL',
        'saveful-backend',
      ),
      os_version: this.config.get<string>('PERKS_CORP_OS_VERSION', 'n/a'),
      app_version: this.config.get<string>('PERKS_CORP_APP_VERSION', '1.0.0'),
      // We have no WeMAD push integration; a real token would be a fiction.
      push_token: this.config.get<string>('PERKS_CORP_PUSH_TOKEN', 'none'),
    };
  }

  private normalisePhone(value: unknown): string | null {
    const digits = String(value ?? '').replace(/\D+/g, '');
    return digits.length >= 8 && digits.length <= 11 ? digits : null;
  }

  private explainLoginFailure(
    error: unknown,
    user: User,
    fallbackGender?: Gender | null,
  ) {
    if (!(error instanceof PerksCorpApiError)) return error;

    // WeMAD fixed this in 2026-08: a phone already registered to another account
    // now returns a clean 400 instead of a 500. Match the message rather than
    // the status so the person is told the one thing they can act on.
    if (this.isDuplicatePhone(error)) {
      return new UnprocessableEntityException({
        message:
          'This phone number is already registered with another Saveful account. Use a different number to join My Perks.',
        missingFields: ['phone'] satisfies PerksMissingField[],
        code: 'PERKS_PHONE_ALREADY_REGISTERED',
        upstreamMessage: error.message,
      });
    }

    // A 5xx used to mean "duplicate phone", so it told people to check their
    // number. Since WeMAD started returning 400 for duplicates (2026-08), a 5xx
    // is just their server failing — blaming the phone sent people off editing
    // a profile that was never the problem, and offering no way forward.
    if (error.statusCode >= 500) {
      return new ServiceUnavailableException({
        message:
          'My Perks is temporarily unavailable — our partner is not responding. Nothing has been charged. Please try again shortly.',
        code: 'PERKS_UPSTREAM_UNAVAILABLE',
        upstreamMessage: error.message,
      });
    }

    // The WeMAD account exists but rejects the password we derive for this user.
    // Editing a Saveful profile cannot fix that — only WeMAD resetting the
    // account can — so say so plainly instead of sending them round the profile
    // modal forever. Seen after their crash left accounts behind (2026-08).
    if (this.isCredentialMismatch(error)) {
      return new UnprocessableEntityException({
        message:
          'We could not connect your Saveful account to My Perks. Please contact support so we can reset it.',
        code: 'PERKS_ACCOUNT_LINK_FAILED',
        upstreamMessage: error.message,
      });
    }

    if (error.statusCode === 400 || error.statusCode === 422) {
      // Only name, phone and email reach WeMAD — postcode and gender are
      // preconditions we enforce ourselves and are never in the autologin
      // payload. Naming them here sent people round the profile modal editing
      // fields WeMAD had not even seen; one test account failed five times in
      // a row that way. Blame only what we actually sent.
      const missing = this.missingProfileFields(user, fallbackGender).filter(
        (field) => field === 'name' || field === 'phone',
      );
      return new UnprocessableEntityException({
        message:
          'My Perks could not accept your details. Check your name and phone number are correct, then try again.',
        missingFields: missing.length
          ? missing
          : (['name', 'phone'] satisfies PerksMissingField[]),
        code: error.code,
        upstreamMessage: error.message,
      });
    }

    return error;
  }

  private isCredentialMismatch(error: PerksCorpApiError): boolean {
    return /invalid (email|credentials|email or password)/i.test(error.message);
  }

  private isDuplicatePhone(error: PerksCorpApiError): boolean {
    const message = error.message.toLowerCase();
    return (
      message.includes('phone') &&
      /already (registered|exists|taken|in use)/.test(message)
    );
  }
}
