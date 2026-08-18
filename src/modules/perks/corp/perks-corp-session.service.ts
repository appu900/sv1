import {
  HttpException,
  Injectable,
  Logger,
  UnprocessableEntityException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac } from 'crypto';
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

    // Kept for the pre-fix behaviour and any other upstream fault: a 5xx during
    // signup was, in practice, almost always the duplicate phone.
    if (error.statusCode >= 500) {
      return new UnprocessableEntityException({
        message:
          'WeMAD could not create your Perks account. This usually means your phone number is already registered — please check it and try again.',
        missingFields: ['phone'] satisfies PerksMissingField[],
        code: error.code,
        upstreamMessage: error.message,
      });
    }

    if (error.statusCode === 400 || error.statusCode === 422) {
      const missing = this.missingProfileFields(user, fallbackGender);
      return new UnprocessableEntityException({
        message:
          'WeMAD could not verify your Perks account. Confirm your name, phone number, postcode and gender, then try again.',
        missingFields: missing.length
          ? missing
          : (['name', 'phone', 'pincode', 'gender'] satisfies PerksMissingField[]),
        code: error.code,
        upstreamMessage: error.message,
      });
    }

    return error;
  }

  private isDuplicatePhone(error: PerksCorpApiError): boolean {
    const message = error.message.toLowerCase();
    return (
      message.includes('phone') &&
      /already (registered|exists|taken|in use)/.test(message)
    );
  }
}
