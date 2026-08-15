import { Injectable, Logger, UnprocessableEntityException } from '@nestjs/common';
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

/**
 * Owns the Saveful-user ↔ Wemad-user relationship: derives the per-user
 * credentials, performs autologin, and caches the resulting access token.
 */
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

  /**
   * Deterministic per-user password. WeMAD checks this on every autologin, so
   * it must be reproducible for the lifetime of the membership — but we never
   * persist it, which keeps sv1 free of reversible secret storage.
   *
   * Shape satisfies WeMAD's complexity rules (upper + lower + digit + symbol).
   */
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

  /**
   * Fields WeMAD requires that the Saveful profile may not have yet. The app
   * renders these as chips in the registration modal, so the names here are a
   * contract with the frontend (PerksMissingField in the app's types.ts).
   */
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

  /**
   * Logs the user into WeMAD, creating the account on first call.
   * Always returns a FRESH web token — it is single-use, so it is never cached.
   */
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
   * Access token for API calls. Reuses the cached token when present; falls
   * back to a full login. Use `login()` directly when you need a web token.
   */
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

  /**
   * Runs an authenticated call, transparently re-logging-in once if the cached
   * token has been revoked upstream.
   */
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
    // A failure here is harmless — the token expires on its own TTL.
    await cacheAttempt(() => this.redis.del(this.tokenKey(userId)));
  }

  private async cacheToken(userId: string, session: CorpSession) {
    // Redis is optional here; a cache write failure must not fail the login.
    await cacheAttempt(() =>
      this.redis.set(
        this.tokenKey(userId),
        { accessToken: session.accessToken, wmadUserId: session.wmadUserId },
        this.tokenTtlSeconds,
      ),
    );
  }

  private async readCachedToken(userId: string): Promise<CachedCorpToken | null> {
    // Bounded: an unreachable Redis must cost one login, not a hung request.
    return cacheAttempt(() =>
      this.redis.get<CachedCorpToken>(this.tokenKey(userId)),
    );
  }

  private tokenKey(userId: string) {
    return `perks:corp:token:${userId}`;
  }

  private isUnauthorised(error: unknown) {
    return error instanceof PerksCorpApiError && error.statusCode === 401;
  }

  private normalisePhone(value: unknown): string | null {
    const digits = String(value ?? '').replace(/\D+/g, '');
    return digits.length >= 8 && digits.length <= 11 ? digits : null;
  }

  /**
   * WeMAD returns an unhandled 500 when a phone number is already attached to a
   * different account, and a 400 when the password does not match an existing
   * account. Both are dead ends for the user unless we say which field to fix.
   */
  private explainLoginFailure(
    error: unknown,
    user: User,
    fallbackGender?: Gender | null,
  ) {
    if (!(error instanceof PerksCorpApiError)) return error;

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
}
