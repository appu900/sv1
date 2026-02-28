import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class QantasApiClient {
  private readonly logger = new Logger(QantasApiClient.name);

  private readonly baseUrl: string;
  private readonly authHeaderLink: string;
  private readonly authHeaderRedeem: string;
  private readonly linkPartnerCode: string;
  private readonly redeemPartnerCode: string;
  private readonly terminalId: string;

  constructor(private readonly configService: ConfigService) {
   
    this.baseUrl = this.configService.get<string>('QANTAS_API_BASE_URL', '');
    this.authHeaderLink = this.configService.get<string>('QANTAS_BASIC_AUTH_HEADER_LINK', '');
    this.authHeaderRedeem = this.configService.get<string>('QANTAS_BASIC_AUTH_HEADER_REDEEM', '');
    this.linkPartnerCode = this.configService.get<string>('QANTAS_LINK_PARTNER_CODE', '');
    this.redeemPartnerCode = this.configService.get<string>('QANTAS_REDEEM_PARTNER_CODE', '');
    this.terminalId = this.configService.get<string>('QANTAS_TERMINAL_ID', 'app');
  }

  private ensureConfigured(): void {
    const missing: string[] = [];
    if (!this.baseUrl) missing.push('QANTAS_API_BASE_URL');
    if (!this.authHeaderLink) missing.push('QANTAS_BASIC_AUTH_HEADER_LINK');
    if (!this.authHeaderRedeem) missing.push('QANTAS_BASIC_AUTH_HEADER_REDEEM');
    if (!this.linkPartnerCode) missing.push('QANTAS_LINK_PARTNER_CODE');
    if (!this.redeemPartnerCode) missing.push('QANTAS_REDEEM_PARTNER_CODE');
    if (missing.length > 0) {
      throw new Error(
        `Qantas API is not configured. Missing env vars: ${missing.join(', ')}`,
      );
    }
  }


  async linkFFN(
    memberId: string,
    surname: string,
    savefulUserId: string,
  ): Promise<QantasLinkResult> {
    this.ensureConfigured();
    const url = `${this.baseUrl}/member/program/partner/link`;

    const payload = {
      partnerCode: this.linkPartnerCode,
      qffReference: {
        memberId,
        surname: surname.toUpperCase(),
      },
      links: [
        {
          partnerReferenceId: savefulUserId,
          linkStatus: 'ACTIVE',
          updateTime: new Date().toISOString(),
        },
      ],
    };

    this.logger.log(`[linkFFN] POST ${url} – member=${memberId}`);
    return this.postJson<QantasLinkResult>(url, payload, this.authHeaderLink, {
      handleConflict: true,
    });
  }

  async unlinkFFN(
    memberId: string,
    surname: string,
    savefulUserId: string,
  ): Promise<QantasLinkResult> {
    this.ensureConfigured();
    const url = `${this.baseUrl}/member/program/partner/link`;

    const payload = {
      partnerCode: this.linkPartnerCode,
      qffReference: {
        memberId,
        surname: surname.toUpperCase(),
      },
      links: [
        {
          partnerReferenceId: savefulUserId,
          linkStatus: 'UNLINKED',
          updateTime: new Date().toISOString(),
        },
      ],
    };

    this.logger.log(`[unlinkFFN] PUT ${url} – member=${memberId}`);
    return this.putJson<QantasLinkResult>(url, payload, this.authHeaderLink);
  }

  async earnTransaction(
    memberId: string,
    points: number,
    allocationId: string,
  ): Promise<QantasEarnResult> {
    this.ensureConfigured();
    const url = `${this.baseUrl}/pos/api/member/v2/members/${memberId}/earntransactions`;

    const payload = {
      totalCurrencyAmount: '0.01',
      points: String(points),
      timestamp: new Date().toISOString(),
      terminalId: this.terminalId,
      clientRef: allocationId,
      "The earn offer's exco code": this.redeemPartnerCode,
      statementText: 'Green Tier - Saveful challenge completion',
    };

    this.logger.log(`[earnTransaction] POST ${url} – member=${memberId}, points=${points}`);
    return this.postJson<QantasEarnResult>(url, payload, this.authHeaderRedeem);
  }

  async getMemberDetail(memberId: string): Promise<QantasMemberDetail> {
    this.ensureConfigured();
    const url = `${this.baseUrl}/member/${memberId}/program/QFF`;

    this.logger.log(`[getMemberDetail] GET ${url}`);
    const res = await this.fetchWithRetry(url, {
      method: 'GET',
      headers: {
        Authorization: `Basic ${this.authHeaderLink}`,
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
    });

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      this.logger.error(`[getMemberDetail] ${res.status}: ${body}`);
      throw new QantasApiError('getMemberDetail', res.status, body);
    }

    return res.json();
  }
  private async postJson<T>(
    url: string,
    body: any,
    authHeader: string,
    opts?: { handleConflict?: boolean },
  ): Promise<T> {
    const res = await this.fetchWithRetry(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Basic ${authHeader}`,
      },
      body: JSON.stringify(body),
    });

    return this.handleResponse<T>(url, res, opts?.handleConflict);
  }

  private async putJson<T>(
    url: string,
    body: any,
    authHeader: string,
  ): Promise<T> {
    const res = await this.fetchWithRetry(url, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Basic ${authHeader}`,
      },
      body: JSON.stringify(body),
    });

    return this.handleResponse<T>(url, res);
  }

  /**
   * Retry wrapper – retries once on network/transport errors
   * (equivalent to the Erlang/OTP SSL workaround in the Elixir codebase).
   */
  private async fetchWithRetry(
    url: string,
    init: RequestInit,
    retries = 1,
  ): Promise<Response> {
    try {
      return await fetch(url, init);
    } catch (err) {
      if (retries > 0) {
        this.logger.warn(`[fetchWithRetry] Transport error, retrying – ${(err as Error).message}`);
        return this.fetchWithRetry(url, init, retries - 1);
      }
      throw err;
    }
  }

  private async handleResponse<T>(
    url: string,
    res: Response,
    handleConflict = false,
  ): Promise<T> {
    const status = res.status;

    // Per Qantas API docs: status 200–226 = success
    if (status >= 200 && status <= 226) {
      return res.json() as Promise<T>;
    }

    const body = await res.text().catch(() => '');

    if (status === 409 && handleConflict) {
      this.logger.warn(`[Qantas 409] Already linked – ${url}: ${body}`);
      throw new QantasConflictError(body);
    }

    if (status >= 500 && status <= 511) {
      this.logger.error(`[Qantas ${status}] Server error – ${url}: ${body}`);
      throw new QantasRetryableError(status, body);
    }

    this.logger.error(`[Qantas ${status}] Rejected – ${url}: ${body}`);
    throw new QantasApiError(url, status, body);
  }
}

export class QantasApiError extends Error {
  constructor(
    public readonly endpoint: string,
    public readonly statusCode: number,
    public readonly responseBody: string,
  ) {
    super(`Qantas API error ${statusCode} on ${endpoint}`);
    this.name = 'QantasApiError';
  }
}

export class QantasConflictError extends Error {
  constructor(public readonly responseBody: string) {
    super('FFN already linked on Qantas side (409)');
    this.name = 'QantasConflictError';
  }
}

export class QantasRetryableError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly responseBody: string,
  ) {
    super(`Qantas API retryable error ${statusCode}`);
    this.name = 'QantasRetryableError';
  }
}

export interface QantasLinkResult {
  [key: string]: any;
}

export interface QantasEarnResult {
  [key: string]: any;
}

export interface QantasMemberDetail {
  ffExpireDate?: string;
  [key: string]: any;
}
