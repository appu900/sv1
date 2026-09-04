import {
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac } from 'crypto';


interface CorpEnvelope<T> {
  success: boolean;
  message?: unknown;
  errors?: unknown;
  data: T;
}

export interface CorpSession {
  accessToken: string;
  webToken: string;
  wmadUserId: string;
}

export interface CorpAutologinPayload {
  email: string;
  phone: string;
  firstname: string;
  lastname: string;
  password: string;
  /**
   * WeMAD's device-tracking fields, mandatory since 2026-08. All eight must be
   * present and non-empty or autologin returns 422. We are a server-to-server
   * caller with no handset — autologin also runs from the Stripe webhook, where
   * no user request exists — so these describe our backend honestly rather than
   * impersonating a phone.
   */
  device_id: string;
  platform: string;
  device_type: string;
  device_name: string;
  device_model: string;
  os_version: string;
  app_version: string;
  push_token: string;
}

export interface CorpSsoPayload {
  first_name: string;
  last_name: string;
  email: string;
  phone: string;
  redirect_url?: string;
}

export interface CorpCartLine {
  gift_card_id: number | string;
  amount: number;
  purchase_type: 'self' | 'gift';
  recipient_name?: string;
  recipient_email?: string;
  recipient_phone?: string;
  message?: string;
  gift_template_id?: number | string;
  gift_template_design_id?: number | string;
}

const num = (value: unknown): number | null => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

export class PerksCorpApiError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number,
    public readonly code: string,
    public readonly retryable: boolean,
    public readonly ambiguous: boolean,
  ) {
    super(message);
    this.name = 'PerksCorpApiError';
  }
}

/** One page of WeMAD's `/orders` response, envelope intact. */
export interface PerksOrdersPage {
  rows: Record<string, unknown>[];
  perPage: number;
  currentPage: number;
  lastPage: number;
  total: number;
  summary: {
    totalOrders: number | null;
    totalAmount: number | null;
    pendingOrders: number | null;
    completedOrders: number | null;
  };
}

@Injectable()
export class PerksCorpApiClient {
  private readonly logger = new Logger(PerksCorpApiClient.name);
  private readonly baseUrl: string;
  private readonly frontendUrl: string;
  private readonly clientKey: string;
  private readonly clientSecret: string;
  private readonly siteId: string;
  private readonly requestType: string;
  private readonly timeoutMs: number;

  constructor(private readonly config: ConfigService) {
    this.baseUrl = this.config
      .get<string>(
        'WMAD_CORP_BASE_URL',
        'https://sandbox.wemad.com.au/api/corp',
      )
      .replace(/\/+$/, '');
    this.frontendUrl = this.config
      .get<string>(
        'WMAD_CORP_FRONTEND_URL',
        'https://sandbox.wemad.com.au/frontend',
      )
      .replace(/\/+$/, '');
    this.clientKey = this.config
      .get<string>('WMAD_CORP_CLIENT_KEY', 'android_app')
      .trim();
    this.clientSecret = this.config
      .get<string>('WMAD_CORP_CLIENT_SECRET', '')
      .trim();
    this.siteId = String(this.config.get<string>('WMAD_CORP_SITE_ID', '2')).trim();
    this.requestType = this.config
      .get<string>('WMAD_CORP_REQUEST_TYPE', 'CORP')
      .trim();
    this.timeoutMs = Number(
      this.config.get<number>('WMAD_CORP_TIMEOUT_MS', 12_000),
    );
  }

  buildCheckoutUrl(webToken: string): string {
    return `${this.frontendUrl}/sso/login?token=${encodeURIComponent(webToken)}`;
  }

  async createSsoUrl(
    accessToken: string,
    payload: CorpSsoPayload,
  ): Promise<string> {
    const data = await this.request<{ login_url?: string }>(
      '/sso/login',
      { method: 'POST', body: JSON.stringify(payload) },
      accessToken,
    );

    const loginUrl = String(data?.login_url ?? '').trim();
    if (!loginUrl) {
      throw new PerksCorpApiError(
        'WeMAD did not return a checkout URL',
        502,
        'INVALID_SSO_RESPONSE',
        true,
        false,
      );
    }

    return this.normaliseFrontendUrl(loginUrl);
  }

  private normaliseFrontendUrl(loginUrl: string): string {
    try {
      const url = new URL(loginUrl);
      const configured = new URL(this.frontendUrl);
      if (url.host === configured.host) return url.toString();

      const isPrivateHost =
        url.hostname === 'localhost' ||
        /^127\./.test(url.hostname) ||
        /^10\./.test(url.hostname) ||
        /^192\.168\./.test(url.hostname) ||
        /^172\.(1[6-9]|2\d|3[01])\./.test(url.hostname);
      if (!isPrivateHost) return url.toString();

      url.protocol = configured.protocol;
      url.host = configured.host;
      url.port = configured.port;
      return url.toString();
    } catch {
      return loginUrl;
    }
  }

  async autologin(payload: CorpAutologinPayload): Promise<CorpSession> {
    const data = await this.request<{
      access_token: string;
      web_token: string;
      user: { id: number | string };
    }>('/auth/autologin', { method: 'POST', body: JSON.stringify(payload) });

    if (!data?.access_token) {
      throw new PerksCorpApiError(
        'WeMAD login did not return an access token',
        502,
        'INVALID_AUTH_RESPONSE',
        false,
        false,
      );
    }

    return {
      accessToken: data.access_token,
      webToken: data.web_token,
      wmadUserId: String(data.user?.id ?? ''),
    };
  }

  async changePassword(
    accessToken: string,
    currentPassword: string,
    newPassword: string,
  ): Promise<void> {
    await this.request('/change-password', {
      method: 'POST',
      body: JSON.stringify({
        password: currentPassword,
        newpassword: newPassword,
        newpassword_confirmation: newPassword,
      }),
    }, accessToken);
  }

  /**
   * Puts the member on a WeMAD membership tier.
   *
   * Card discounts are per tier (`per_standard`, `per_gold`, `per_platinum`,
   * `per_platinum_plus`), and everyone starts on standard, where every card
   * reads `per_standard: 0.00`. That is why the catalogue showed 0% off across
   * the board — not a WeMAD data gap, our members were simply never upgraded.
   *
   * My Perks sells one level, Platinum, so this runs after every successful
   * registration and is retried until it sticks.
   */
  async changeMembership(
    accessToken: string,
    membershipId: string,
  ): Promise<void> {
    await this.request(
      '/change-membership',
      { method: 'POST', body: JSON.stringify({ membership_id: membershipId }) },
      accessToken,
    );
  }

  async listGiftCards(filters: {
    paginate?: number;
    page?: number;
    category?: string | number;
    search?: string;
    redeemable?: string;
  } = {}): Promise<Record<string, unknown>[]> {
    const { page = 1, ...body } = filters;
    const data = await this.request<Record<string, unknown>[]>(
      `/gift-cards?page=${page}`,
      { method: 'POST', body: JSON.stringify(body) },
    );
    return Array.isArray(data) ? data : [];
  }

  /**
   * The whole catalogue, not just the first page.
   *
   * The listing is paginated and carries no total, so the pages have to be
   * walked. Asking for everything in one request works but took 10-13s live —
   * past our own timeout — so pages are fetched in parallel batches instead,
   * each request staying small and quick. Reading only page 1 previously hid
   * 534 of 634 cards from the app.
   */
  async listAllGiftCards({
    pageSize = 100,
    maxPages = 20,
    batchSize = 8,
  }: { pageSize?: number; maxPages?: number; batchSize?: number } = {}): Promise<
    Record<string, unknown>[]
  > {
    const byId = new Map<string, Record<string, unknown>>();
    let nextPage = 1;
    let exhausted = false;

    while (!exhausted && nextPage <= maxPages) {
      const pages: number[] = [];
      for (let i = 0; i < batchSize && nextPage + i <= maxPages; i += 1) {
        pages.push(nextPage + i);
      }

      const results = await Promise.all(
        pages.map((page) => this.listGiftCards({ paginate: pageSize, page })),
      );

      for (const rows of results) {
        for (const row of rows) {
          const id = String((row as { id?: unknown }).id ?? '');
          if (id) byId.set(id, row);
        }
      }

      // A page shorter than requested is the last one; an empty batch means we
      // have run past the end.
      exhausted = results.some((rows) => rows.length < pageSize);
      nextPage += pages.length;
    }

    if (!exhausted) {
      this.logger.warn(
        `Perks catalogue hit the ${maxPages}-page cap; some cards may be missing`,
      );
    }

    return [...byId.values()];
  }

  async getGiftCard(idOrSlug: string): Promise<Record<string, unknown>> {
    return this.request<Record<string, unknown>>(
      `/gift-cards/${encodeURIComponent(idOrSlug)}`,
      { method: 'GET' },
    );
  }

  async getCategories(): Promise<Record<string, unknown>[]> {
    const data = await this.request<{ categories?: Record<string, unknown>[] }>(
      '/category',
      { method: 'GET' },
    );
    return Array.isArray(data?.categories) ? data.categories : [];
  }


  async getCart(accessToken: string): Promise<Record<string, unknown>[]> {
    const data = await this.request<Record<string, unknown>[]>(
      '/cart',
      { method: 'GET' },
      accessToken,
    );
    return Array.isArray(data) ? data : [];
  }

  async addToCart(accessToken: string, line: CorpCartLine): Promise<void> {
    await this.request(
      '/cart/add',
      { method: 'POST', body: JSON.stringify(line) },
      accessToken,
    );
  }

  async removeFromCart(
    accessToken: string,
    cartId: number | string,
  ): Promise<void> {
    await this.request(
      '/cart/remove',
      { method: 'POST', body: JSON.stringify({ cart_id: cartId }) },
      accessToken,
    );
  }

  /**
   * One page of `/orders`, with WeMAD's envelope preserved.
   *
   * Shape confirmed by WeMAD 2026-09-04:
   *   data.orders.{ data, current_page, last_page, per_page, total }
   *   data.{ totalOrders, totalAmount, pendingOrders, completedOrders }
   *
   * `total` and `per_page` are what make real paging possible. We used to throw
   * both away, walk every page and slice the result, which meant up to twenty
   * sequential requests to WeMAD each time a member opened their order history.
   */
  async listOrdersPage(
    accessToken: string,
    page = 1,
  ): Promise<PerksOrdersPage> {
    const payload = await this.request<Record<string, unknown>>(
      `/orders?page=${page}`,
      { method: 'GET' },
      accessToken,
    );

    const orders = (payload?.orders ?? {}) as Record<string, unknown>;
    const rows = Array.isArray(orders.data)
      ? (orders.data as Record<string, unknown>[])
      : [];

    return {
      rows,
      // Their per_page has been 10 on every response seen; fall back to the
      // page length rather than a guess, so a change on their side is absorbed.
      perPage: num(orders.per_page) ?? rows.length ?? 0,
      currentPage: num(orders.current_page) ?? page,
      lastPage: num(orders.last_page) ?? page,
      total: num(orders.total) ?? num(payload?.totalOrders) ?? rows.length,
      summary: {
        totalOrders: num(payload?.totalOrders),
        totalAmount: num(payload?.totalAmount),
        pendingOrders: num(payload?.pendingOrders),
        completedOrders: num(payload?.completedOrders),
      },
    };
  }

  /**
   * One order by its numeric **Order ID** — `order.id`, not `order_number`.
   *
   * Passing the order number here returns a 500. WeMAD confirmed on 2026-09-04
   * that the two are different fields: `order_number` is the customer-facing
   * reference (`WMDAU3-2026...`), `id` is the integer key this route expects.
   *
   * Nothing calls this today: `perks.service.getOrder` resolves the order from
   * the list response, which already carries every `order_item`. Kept, and
   * documented, so the next person does not rediscover the 500 the hard way.
   */
  async getOrder(
    accessToken: string,
    orderId: string,
  ): Promise<Record<string, unknown>> {
    return this.request<Record<string, unknown>>(
      `/orders/${encodeURIComponent(orderId)}`,
      { method: 'GET' },
      accessToken,
    );
  }

  async listMyGiftCards(accessToken: string): Promise<Record<string, unknown>[]> {
    return this.collectPages(accessToken, '/my-gift-cards', (payload) => {
      if (Array.isArray(payload)) return { rows: payload, lastPage: 1 };
      const items = (payload as { items?: unknown })?.items;
      const pagination = (payload as { pagination?: Record<string, unknown> })
        ?.pagination;
      return {
        rows: Array.isArray(items) ? items : [],
        lastPage: num(pagination?.last_page),
      };
    });
  }

  private async collectPages(
    accessToken: string,
    path: string,
    read: (payload: any) => { rows: Record<string, unknown>[]; lastPage: number | null },
    maxPages = 20,
  ): Promise<Record<string, unknown>[]> {
    const all: Record<string, unknown>[] = [];
    let page = 1;
    let lastPage = 1;

    while (page <= Math.min(lastPage, maxPages)) {
      const payload = await this.request<unknown>(
        `${path}?page=${page}`,
        { method: 'GET' },
        accessToken,
      );
      const { rows, lastPage: reported } = read(payload);
      all.push(...rows);

      if (page === 1 && reported && reported > 1) lastPage = reported;
      if (!rows.length) break;
      page += 1;
    }

    return all;
  }

  private signedHeaders(accessToken?: string): Record<string, string> {
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const signature = createHmac('sha256', this.clientSecret)
      .update(`${this.siteId}|${this.clientKey}|${timestamp}`)
      .digest('hex');

    const headers: Record<string, string> = {
      'X-CLIENT-KEY': this.clientKey,
      'X-TIMESTAMP': timestamp,
      'X-SIGNATURE': signature,
      'X-SITE-ID': this.siteId,
      'X-REQUEST-TYPE': this.requestType,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    };
    if (accessToken) {
      headers.Authorization = `Bearer ${accessToken}`;
    }
    return headers;
  }

  private async request<T>(
    path: string,
    init: RequestInit,
    accessToken?: string,
  ): Promise<T> {
    if (!this.clientSecret) {
      this.logger.error('WMAD_CORP_CLIENT_SECRET is not configured');
      throw new ServiceUnavailableException(
        'Perks integration is not configured',
      );
    }

    const ambiguousOnFailure = init.method === 'POST';
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    let httpStatus: number;
    let raw: string;
    try {
      const response = await fetch(`${this.baseUrl}${path}`, {
        ...init,
        headers: this.signedHeaders(accessToken),
        signal: controller.signal,
      });
      httpStatus = response.status;
      raw = await response.text();
    } catch (error) {
      const timedOut = error instanceof Error && error.name === 'AbortError';
      throw new PerksCorpApiError(
        timedOut ? 'WeMAD request timed out' : 'WeMAD request failed',
        503,
        timedOut ? 'UPSTREAM_TIMEOUT' : 'UPSTREAM_UNAVAILABLE',
        true,
        ambiguousOnFailure,
      );
    } finally {
      clearTimeout(timer);
    }

    let body: CorpEnvelope<T> | null = null;
    if (raw) {
      try {
        body = JSON.parse(raw) as CorpEnvelope<T>;
      } catch {
        this.logger.warn(
          `WeMAD returned non-JSON path=${path} status=${httpStatus}`,
        );
        throw new PerksCorpApiError(
          httpStatus >= 500
            ? 'WeMAD is currently unavailable. Please try again.'
            : 'WeMAD returned an unreadable response',
          httpStatus >= 500 ? 502 : httpStatus,
          httpStatus >= 500 ? 'UPSTREAM_ERROR' : 'INVALID_RESPONSE',
          httpStatus >= 500,
          ambiguousOnFailure,
        );
      }
    }

    if (httpStatus >= 200 && httpStatus < 300 && body?.success !== false) {
      return body?.data as T;
    }

    const message = this.extractMessage(body?.message);
    const code = `WMAD_CORP_${httpStatus}`;
    this.logger.warn(
      `WeMAD rejected request path=${path} status=${httpStatus} message=${message}`,
    );
    throw new PerksCorpApiError(
      message,
      httpStatus || 502,
      code,
      httpStatus === 429 || httpStatus >= 500,
      false,
    );
  }

  private extractMessage(value: unknown): string {
    if (typeof value === 'string' && value.trim()) return value.trim();
    if (Array.isArray(value)) {
      const parts = value.filter(
        (part): part is string => typeof part === 'string' && part.trim().length > 0,
      );
      if (parts.length) return parts.join(', ');
    }
    if (
      value &&
      typeof value === 'object' &&
      typeof (value as { message?: unknown }).message === 'string'
    ) {
      const nested = String((value as { message: string }).message).trim();
      if (nested) return nested;
    }
    return 'WeMAD rejected the request';
  }
}
