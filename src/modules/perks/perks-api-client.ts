import {
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'crypto';
import { RedisService } from '../../redis/redis.service';

interface CachedWmadToken {
  token: string;
  expiresAt: number;
}

interface WmadEnvelope<T> {
  status: number;
  message?: string;
  code?: string;
  data: T;
}

export interface WmadRegistration {
  user_id: number | string;
}

export type WmadGenderCode = 0 | 1 | 2;

export interface WmadOrderResult {
  order_number: number | string;
  order_status: number | string;
  order_reference: string;
  cardurl?: string;
}

export class PerksApiError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number,
    public readonly code: string,
    public readonly retryable: boolean,
    public readonly ambiguous: boolean,
  ) {
    super(message);
    this.name = 'PerksApiError';
  }
}

@Injectable()
export class PerksApiClient {
  private readonly logger = new Logger(PerksApiClient.name);
  private readonly baseUrl: string;
  private readonly email: string;
  private readonly password: string;
  private readonly clientId: string;
  private readonly timeoutMs: number;
  private readonly tokenKey = 'perks:wmad:merchant-token';
  private readonly tokenLockKey = 'perks:wmad:merchant-token:lock';

  constructor(
    private readonly config: ConfigService,
    private readonly redis: RedisService,
  ) {
    this.baseUrl = this.config
      .get<string>('WMAD_API_BASE_URL', 'https://api.wemad.com.au/v1/api')
      .replace(/\/+$/, '');
    this.email = this.config.get<string>('WMAD_API_EMAIL', '').trim();
    this.password = this.config.get<string>('WMAD_API_PASSWORD', '');
    this.clientId = this.config.get<string>('WMAD_CLIENT_ID', '').trim();
    this.timeoutMs = this.config.get<number>('WMAD_API_TIMEOUT_MS', 12_000);
  }

  async registerUser(payload: {
    firstname: string;
    lastname: string;
    email: string;
    postcode: string;
    phone?: string;
    gender?: WmadGenderCode;
  }): Promise<WmadRegistration> {
    return this.request<WmadRegistration>('/register', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  }

  async getEcards(): Promise<Record<string, unknown>[]> {
    return this.request<Record<string, unknown>[]>('/ecard', {
      method: 'GET',
    });
  }

  async getGiftOptions(): Promise<Record<string, unknown>> {
    return this.request<Record<string, unknown>>('/order/sendgiftdetail', {
      method: 'GET',
    });
  }

  async createOrder(
    payload: Record<string, unknown>,
  ): Promise<WmadOrderResult> {
    return this.request<WmadOrderResult>('/order', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  }

  async getOrderDetail(
    orderNumber: string,
    orderReference?: string,
  ): Promise<Record<string, unknown>> {
    return this.request<Record<string, unknown>>('/order/detail', {
      method: 'POST',
      body: JSON.stringify({
        order_number: orderNumber,
        ...(orderReference ? { order_reference: orderReference } : {}),
      }),
    });
  }

  async cancelOrder(orderNumber: string): Promise<Record<string, unknown>> {
    return this.request<Record<string, unknown>>('/order/cancel', {
      method: 'POST',
      body: JSON.stringify({ order_number: orderNumber }),
    });
  }

  async getTaxReceipt(orderNumber: string): Promise<Record<string, unknown>> {
    return this.request<Record<string, unknown>>('/order/taxreceipt', {
      method: 'POST',
      body: JSON.stringify({ order_number: orderNumber }),
    });
  }

  async getWallet(): Promise<Record<string, unknown>[]> {
    return this.request<Record<string, unknown>[]>('/ewallet', {
      method: 'GET',
    });
  }

  async getGiftedWallet(): Promise<Record<string, unknown>[]> {
    return this.request<Record<string, unknown>[]>('/ewallet/gifted', {
      method: 'GET',
    });
  }

  async verifyConnection(): Promise<{
    authenticated: true;
    expiresAt: string;
  }> {
    const token = await this.getToken();
    return {
      authenticated: true,
      expiresAt: new Date(token.expiresAt).toISOString(),
    };
  }

  private async request<T>(
    path: string,
    init: RequestInit,
    refreshed = false,
  ): Promise<T> {
    const token = await this.getToken();
    const response = await this.fetchJson<WmadEnvelope<T>>(path, {
      ...init,
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        Authorization: `Bearer ${token.token}`,
      },
    });

    if (
      !refreshed &&
      (response.httpStatus === 401 || response.body?.status === 401)
    ) {
      await this.redis.del(this.tokenKey);
      return this.request<T>(path, init, true);
    }

    return this.unwrap(path, response.httpStatus, response.body);
  }

  private async getToken(): Promise<CachedWmadToken> {
    const cached = await this.redis.get<CachedWmadToken>(this.tokenKey);
    if (cached && cached.expiresAt - Date.now() > 12 * 60 * 60 * 1000) {
      return cached;
    }

    const lockId = randomUUID();
    const acquired = await this.redis.setIfAbsent(
      this.tokenLockKey,
      lockId,
      15,
    );
    if (!acquired) {
      for (let attempt = 0; attempt < 20; attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, 250));
        const refreshed = await this.redis.get<CachedWmadToken>(this.tokenKey);
        if (
          refreshed &&
          refreshed.expiresAt - Date.now() > 12 * 60 * 60 * 1000
        ) {
          return refreshed;
        }
      }
      throw new ServiceUnavailableException(
        'WMAD authentication is temporarily unavailable',
      );
    }

    try {
      const current = await this.redis.get<CachedWmadToken>(this.tokenKey);
      if (current && current.expiresAt - Date.now() > 12 * 60 * 60 * 1000) {
        return current;
      }
      return await this.login();
    } finally {
      await this.redis.releaseLock(this.tokenLockKey, lockId);
    }
  }

  private async login(): Promise<CachedWmadToken> {
    if (!this.email || !this.password || !this.clientId) {
      this.logger.error('WMAD API credentials are not configured');
      throw new ServiceUnavailableException(
        'Perks integration is not configured',
      );
    }

    const response = await this.fetchJson<
      WmadEnvelope<{ token: string; expire?: number | string }>
    >(
      '/login',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify({
          email: this.email,
          password: this.password,
          client_id: this.clientId,
        }),
      },
      false,
    );
    const data = this.unwrap('/login', response.httpStatus, response.body);
    if (!data.token) {
      throw new PerksApiError(
        'WMAD login did not return a token',
        502,
        'INVALID_AUTH_RESPONSE',
        false,
        false,
      );
    }

    const expiresAt = this.resolveExpiry(data.expire);
    const token = { token: data.token, expiresAt };
    const ttlSeconds = Math.max(
      60,
      Math.floor((expiresAt - Date.now()) / 1000),
    );
    await this.redis.set(this.tokenKey, token, ttlSeconds);
    this.logger.log('WMAD merchant token refreshed');
    return token;
  }

  private resolveExpiry(value: number | string | undefined): number {
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      return Date.now() + 7 * 24 * 60 * 60 * 1000;
    }
    if (parsed > 1_000_000_000_000) {
      return parsed;
    }
    const nowSeconds = Math.floor(Date.now() / 1000);
    if (parsed > nowSeconds) {
      return parsed * 1000;
    }
    return Date.now() + parsed * 1000;
  }

  private async fetchJson<T>(
    path: string,
    init: RequestInit,
    ambiguousOnFailure = init.method === 'POST',
  ): Promise<{ httpStatus: number; body: T | null }> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await fetch(`${this.baseUrl}${path}`, {
        ...init,
        signal: controller.signal,
      });
      const text = await response.text();
      let body: T | null = null;
      if (text) {
        try {
          body = JSON.parse(text) as T;
        } catch {
          throw new PerksApiError(
            'WMAD returned malformed JSON',
            502,
            'INVALID_RESPONSE',
            false,
            ambiguousOnFailure,
          );
        }
      }
      return { httpStatus: response.status, body };
    } catch (error) {
      if (error instanceof PerksApiError) {
        throw error;
      }
      const timedOut = error instanceof Error && error.name === 'AbortError';
      throw new PerksApiError(
        timedOut ? 'WMAD request timed out' : 'WMAD request failed',
        503,
        timedOut ? 'UPSTREAM_TIMEOUT' : 'UPSTREAM_UNAVAILABLE',
        true,
        ambiguousOnFailure,
      );
    } finally {
      clearTimeout(timer);
    }
  }

  private unwrap<T>(
    path: string,
    httpStatus: number,
    body: WmadEnvelope<T> | null,
  ): T {
    const status = Number(body?.status ?? httpStatus);
    if (
      httpStatus >= 200 &&
      httpStatus < 300 &&
      status >= 200 &&
      status < 300
    ) {
      return body?.data as T;
    }

    const code = body?.code ?? `WMAD_${status || httpStatus}`;
    const rawMessage = body?.message as unknown;
    let message = 'WMAD rejected the request';
    if (typeof rawMessage === 'string' && rawMessage.trim()) {
      message = rawMessage.trim();
    } else if (Array.isArray(rawMessage)) {
      const parts = rawMessage.filter(
        (part): part is string => typeof part === 'string' && part.trim().length > 0,
      );
      if (parts.length) {
        message = parts.join(', ');
      }
    } else if (
      rawMessage &&
      typeof rawMessage === 'object' &&
      typeof (rawMessage as { message?: unknown }).message === 'string'
    ) {
      const nested = String((rawMessage as { message: string }).message).trim();
      if (nested) {
        message = nested;
      }
    }
    this.logger.warn(
      `WMAD request rejected path=${path} status=${status || httpStatus} code=${code} message=${message}`,
    );
    throw new PerksApiError(
      message,
      status || httpStatus || 502,
      code,
      status === 429 || status >= 500,
      false,
    );
  }
}
