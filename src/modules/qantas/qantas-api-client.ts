import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'crypto';

export interface PartnerLinkResponse {
  partnerCode: string;
  qffReference: {
    memberId: string;
    memberCardNumber?: string;
  };
  links: {
    partnerReferenceId: string;
    channel?: string;
  }[];
}

export type PartnerUnlinkResponse = PartnerLinkResponse;

export interface QlposEarnResponse {
  transactionNumber: string;
  pointsBurned: number;
  pointsEarned: number;
  pointsBalanceDelta: number;
  message: string;
}

export interface MemberDetailResponse {
  accountStatus: string;
  ffExpireDate: string; 
  suspended: boolean;
  [key: string]: any;
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

export class QantasAlreadyLinkedError extends Error {
  constructor(public readonly responseBody: string) {
    super('FFN is already linked (409 ENTITY_ALREADY_EXISTS)');
    this.name = 'QantasAlreadyLinkedError';
  }
}

export class QantasDuplicateAccrualError extends Error {
  constructor(public readonly responseBody: string) {
    super('Accrual already exists (400 ACCRUAL_ALREADY_EXISTS)');
    this.name = 'QantasDuplicateAccrualError';
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

export class QantasAkamaiBlockError extends Error {
  constructor(public readonly responseBody: string) {
    super('Request blocked by Akamai (IP not whitelisted)');
    this.name = 'QantasAkamaiBlockError';
  }
}

@Injectable()
export class QantasApiClient {
  private readonly logger = new Logger(QantasApiClient.name);

  private readonly baseUrl: string;
  private readonly linkAuthHeader: string;   
  private readonly redeemAuthHeader: string; 
  private readonly partnerCode: string;      
  private readonly excoCode: string;       
  private readonly terminalId: string;     
  private readonly currencyAmount: string;  

  constructor(private readonly configService: ConfigService) {
    this.baseUrl = this.getRequired('QANTAS_API_BASE_URL');

    this.linkAuthHeader = this.normalizeAuth(
      this.getRequired('QANTAS_BASIC_AUTH_HEADER_LINK'),
    );
    this.redeemAuthHeader = this.normalizeAuth(
      this.getRequired('QANTAS_BASIC_AUTH_HEADER_REDEEM'),
    );

    this.partnerCode = this.configService.get<string>(
      'QANTAS_LINK_PARTNER_CODE',
      'SAVEFUL',
    );
    this.excoCode = this.configService.get<string>(
      'QANTAS_REDEEM_PARTNER_CODE',
      'SAVEF01',
    );
    this.terminalId = this.configService.get<string>(
      'QANTAS_TERMINAL_ID',
      'Saveful',
    );
    this.currencyAmount = this.configService.get<string>(
      'QANTAS_CURRENCY_AMOUNT',
      '10',
    );

    this.logger.log(
      `[config] baseUrl=${this.baseUrl} partnerCode=${this.partnerCode} ` +
        `excoCode=${this.excoCode} terminalId=${this.terminalId} ` +
        `currencyAmount=${this.currencyAmount}`,
    );
  }



  async linkMember(params: {
    memberId: string;
    surname: string;
    partnerReferenceId: string; 
  }): Promise<PartnerLinkResponse> {
    const url = `${this.baseUrl}/member/program/partner/link`;

    const payload = {
      partnerCode: this.partnerCode,
      qffReference: {
        memberId: params.memberId,
        surname: params.surname.toUpperCase(),
      },
      links: [
        {
          partnerReferenceId: params.partnerReferenceId,
          linkStatus: 'ACTIVE',
          updateTime: new Date().toISOString(),
        },
      ],
    };

    this.logger.log(
      `[linkMember] POST ${url} — member=${params.memberId}, ref=${params.partnerReferenceId}`,
    );

    const res = await this.doRequest(url, {
      method: 'POST',
      headers: this.headers(this.linkAuthHeader),
      body: JSON.stringify(payload),
    });

    return this.handleLinkResponse<PartnerLinkResponse>(url, res);
  }


  async unlinkMember(params: {
    memberId: string;
    surname: string;
    partnerReferenceId: string;
  }): Promise<PartnerUnlinkResponse> {
    const url = `${this.baseUrl}/member/program/partner/link`;

    const payload = {
      partnerCode: this.partnerCode,
      qffReference: {
        memberId: params.memberId,
        surname: params.surname.toUpperCase(),
      },
      links: [
        {
          partnerReferenceId: params.partnerReferenceId,
          linkStatus: 'UNLINKED',
          updateTime: new Date().toISOString(),
        },
      ],
    };

    this.logger.log(
      `[unlinkMember] PUT ${url} — member=${params.memberId}`,
    );

    const res = await this.doRequest(url, {
      method: 'PUT',
      headers: this.headers(this.linkAuthHeader),
      body: JSON.stringify(payload),
    });

    return this.handleResponse<PartnerUnlinkResponse>(url, res);
  }
 
  async earnPoints(params: {
    memberId: string;
    points: number;
    clientRef: string;
    statementText?: string;
  }): Promise<QlposEarnResponse> {
    const url = `${this.baseUrl}/pos/api/member/v2/members/${params.memberId}/earntransactions`;

    const payload = {
      totalCurrencyAmount: this.currencyAmount,
      points: String(params.points),
      timestamp: new Date().toISOString(),
      terminalId: this.terminalId,
      clientRef: params.clientRef,
      "The earn offer's exco code": this.excoCode,
      statementText:
        params.statementText ?? 'Green Tier - Saveful challenge completion',
    };

    this.logger.log(
      `[earnPoints] POST ${url} — member=${params.memberId}, points=${params.points}, clientRef=${params.clientRef}`,
    );

    const res = await this.doRequest(url, {
      method: 'POST',
      headers: this.headers(this.redeemAuthHeader),
      body: JSON.stringify(payload),
    });

    return this.handleEarnResponse(url, res);
  }

  async getMemberDetail(memberId: string): Promise<MemberDetailResponse> {
    const url = `${this.baseUrl}/member/${memberId}/program/QFF`;

    this.logger.log(`[getMemberDetail] GET ${url}`);

    const res = await this.doRequest(url, {
      method: 'GET',
      headers: this.headers(this.linkAuthHeader),
    });

    return this.handleResponse<MemberDetailResponse>(url, res);
  }

  getRuntimeConfig() {
    return {
      baseUrl: this.baseUrl,
      partnerCode: this.partnerCode,
      excoCode: this.excoCode,
      terminalId: this.terminalId,
      linkAuthPresent: !!this.linkAuthHeader,
      redeemAuthPresent: !!this.redeemAuthHeader,
    };
  }

  private headers(authBase64: string): Record<string, string> {
    return {
      'Content-Type': 'application/json',
      Authorization: `Basic ${authBase64}`,
    };
  }

  private normalizeAuth(value: string): string {
    return value.replace(/^Basic\s+/i, '').trim();
  }

  private getRequired(key: string): string {
    const val = this.configService.get<string>(key, '').trim();
    if (!val) {
      this.logger.warn(`[config] Missing required env var: ${key}`);
    }
    return val;
  }

  private async doRequest(
    url: string,
    init: RequestInit,
    retries = 1,
  ): Promise<Response> {
    try {
      return await fetch(url, init);
    } catch (err) {
      if (retries > 0) {
        this.logger.warn(
          `[doRequest] Transport error, retrying — ${(err as Error).message}`,
        );
        return this.doRequest(url, init, retries - 1);
      }
      throw err;
    }
  }

  private isAkamaiBlock(body: string): boolean {
    return (
      body.includes('Access Denied') ||
      body.includes('akamai') ||
      body.includes('edgesuite')
    );
  }

  private async handleResponse<T>(url: string, res: Response): Promise<T> {
    if (res.status >= 200 && res.status <= 226) {
      return res.json() as Promise<T>;
    }

    const body = await res.text().catch(() => '');

    if (this.isAkamaiBlock(body)) {
      throw new QantasAkamaiBlockError(body);
    }

    if (res.status >= 500 && res.status <= 511) {
      this.logger.error(`[Qantas ${res.status}] Server error — ${url}: ${body}`);
      throw new QantasRetryableError(res.status, body);
    }

    this.logger.error(`[Qantas ${res.status}] Rejected — ${url}: ${body}`);
    throw new QantasApiError(url, res.status, body);
  }

  private async handleLinkResponse<T>(url: string, res: Response): Promise<T> {
    if (res.status >= 200 && res.status <= 226) {
      return res.json() as Promise<T>;
    }

    const body = await res.text().catch(() => '');

    if (this.isAkamaiBlock(body)) {
      throw new QantasAkamaiBlockError(body);
    }

    if (res.status === 409) {
      this.logger.warn(`[linkMember] 409 ENTITY_ALREADY_EXISTS: ${body}`);
      throw new QantasAlreadyLinkedError(body);
    }

    if (res.status >= 500 && res.status <= 511) {
      throw new QantasRetryableError(res.status, body);
    }

    throw new QantasApiError(url, res.status, body);
  }

  private async handleEarnResponse(
    url: string,
    res: Response,
  ): Promise<QlposEarnResponse> {
    if (res.status >= 200 && res.status <= 226) {
      return res.json() as Promise<QlposEarnResponse>;
    }

    const body = await res.text().catch(() => '');

    if (this.isAkamaiBlock(body)) {
      throw new QantasAkamaiBlockError(body);
    }

    if (res.status === 400 && body.includes('ACCRUAL_ALREADY_EXISTS')) {
      this.logger.warn(`[earnPoints] Duplicate accrual: ${body}`);
      throw new QantasDuplicateAccrualError(body);
    }

    if (res.status >= 500 && res.status <= 511) {
      throw new QantasRetryableError(res.status, body);
    }

    throw new QantasApiError(url, res.status, body);
  }
}