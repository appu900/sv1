import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'crypto';

export interface MemberValidationResponse {
  status: 'ACTIVE' | 'INACTIVE' | 'NO_ONLINE_ACCESS';
  message: string;
}

export interface PartnerAccrualResponse {
  accrualReferenceNumber: string;
  [key: string]: any;
}

export interface CancelAccrualResponse {
  status: string;
  accrualReferenceNumber: string;
  memberID: string;
  pointsBalance: number;
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
    super('Accrual activity already exists (409)');
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

export class QantasMemberInactiveError extends Error {
  constructor(
    public readonly memberStatus: string,
    public readonly memberMessage: string,
  ) {
    super(`Member is not active: ${memberStatus} – ${memberMessage}`);
    this.name = 'QantasMemberInactiveError';
  }
}

@Injectable()
export class QantasApiClient {
  private readonly logger = new Logger(QantasApiClient.name);

  private readonly environment: 'sit' | 'stg' | 'prd' | '';
  private readonly baseUrl: string;
  private readonly validationAuthHeader: string;
  private readonly accrualAuthHeader: string;
  private readonly partnerId: string;
  private readonly loyaltyPartnerForward: string;

  private normalizeAuthHeader(value: string): string {
    return value.replace(/^Basic\s+/i, '').trim();
  }

  private resolveEnvironment(): 'sit' | 'stg' | 'prd' | '' {
    const raw = this.configService.get<string>('QANTAS_ENV', '').trim().toLowerCase();
    if (raw === 'sit') return 'sit';
    if (raw === 'stg' || raw === 'staging') return 'stg';
    if (raw === 'prd' || raw === 'prod' || raw === 'production') return 'prd';
    return '';
  }

  private getScopedValue(...suffixes: string[]): string {
    const keys: string[] = [];
    for (const suffix of suffixes) {
      if (this.environment) {
        keys.push(`QANTAS_${this.environment.toUpperCase()}_${suffix}`);
      }
      keys.push(`QANTAS_${suffix}`);
    }

    for (const key of keys) {
      const value = this.configService.get<string>(key, '').trim();
      if (value) return value;
    }

    return '';
  }

  constructor(private readonly configService: ConfigService) {
    this.environment = this.resolveEnvironment();
    this.baseUrl = this.getScopedValue('API_BASE_URL');
    this.validationAuthHeader = this.normalizeAuthHeader(
      this.getScopedValue('VALIDATION_AUTH_HEADER', 'PARTNER_LINKING_AUTH_HEADER'),
    );
    this.accrualAuthHeader = this.normalizeAuthHeader(
      this.getScopedValue('ACCRUAL_AUTH_HEADER', 'POS_AUTH_HEADER', 'QL_POS_AUTH_HEADER'),
    );
    this.partnerId = this.getScopedValue('PARTNER_ID');
    this.loyaltyPartnerForward = this.getScopedValue('LOYALTY_PARTNER_FORWARD');

    this.logger.log(
      `[config] env=${this.environment || 'legacy'} baseUrl=${this.baseUrl || 'missing'} partnerId=${this.partnerId || 'missing'}`,
    );
  }

  getRuntimeConfig(): {
    environment: string;
    baseUrl: string;
    partnerId: string;
    validationAuthHeader: string;
    accrualAuthHeader: string;
    loyaltyPartnerForward: string;
  } {
    return {
      environment: this.environment || 'legacy',
      baseUrl: this.baseUrl,
      partnerId: this.partnerId,
      validationAuthHeader: this.validationAuthHeader,
      accrualAuthHeader: this.accrualAuthHeader,
      loyaltyPartnerForward: this.loyaltyPartnerForward,
    };
  }

  private ensureConfigured(): void {
    const missing: string[] = [];
    if (!this.baseUrl) missing.push('QANTAS_API_BASE_URL');
    if (!this.validationAuthHeader) missing.push('QANTAS_VALIDATION_AUTH_HEADER');
    if (!this.accrualAuthHeader) missing.push('QANTAS_ACCRUAL_AUTH_HEADER');
    if (!this.partnerId) missing.push('QANTAS_PARTNER_ID');
    if (missing.length > 0) {
      throw new Error(
        `Qantas API is not configured. Missing env vars: ${missing.join(', ')}`,
      );
    }
  }

  async validateMember(
    memberId: string,
    surname: string,
  ): Promise<MemberValidationResponse> {
    this.ensureConfigured();
    const url = `${this.baseUrl}/validation/members`;

    const payload = {
      memberId,
      criteria: {
        surname: surname.toUpperCase(),
      },
    };

    this.logger.log(`[validateMember] POST ${url} – member=${memberId}`);

    const res = await this.fetchWithRetry(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Basic ${this.validationAuthHeader}`,
      },
      body: JSON.stringify(payload),
    });

    if (res.status === 200) {
      return res.json() as Promise<MemberValidationResponse>;
    }

    const body = await res.text().catch(() => '');

    if (res.status === 404) {
      this.logger.warn(`[validateMember] Member not found: ${body}`);
      throw new QantasMemberInactiveError('NOT_FOUND', body);
    }

    if (res.status >= 500) {
      throw new QantasRetryableError(res.status, body);
    }

    throw new QantasApiError(url, res.status, body);
  }

  async accruePoints(params: {
    memberId: string;
    firstName?: string;
    lastName: string;
    basePoints: number;
    referenceNumber: string;
  }): Promise<PartnerAccrualResponse> {
    this.ensureConfigured();
    const url = `${this.baseUrl}/member/transactions/accrual/partner`;

    const externalRefID = randomUUID();
    const transactionDate = new Date().toISOString().slice(0, 10); // yyyy-MM-dd

    const payload = {
      partnerID: this.partnerId,
      externalRefID,
      memberProfile: {
        memberId: params.memberId,
        ...(params.firstName && { firstName: params.firstName }),
        lastName: params.lastName.toUpperCase(),
      },
      partnerTransaction: {
        referenceNumber: params.referenceNumber.slice(0, 12),
        productCode: 'Saveful',
        description: 'Saveful Direct Accrual',
        transactionDate,
        basePoints: params.basePoints,
        bonusPoints: 0,
        totalPoints: params.basePoints,
      },
    };

    this.logger.log(
      `[accruePoints] POST ${url} – member=${params.memberId}, points=${params.basePoints}, ref=${params.referenceNumber}`,
    );

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Authorization: `Basic ${this.accrualAuthHeader}`,
    };

    if (this.loyaltyPartnerForward) {
      headers['LOYALTY-PARTNER-FORWARD'] = this.loyaltyPartnerForward;
    }

    const res = await this.fetchWithRetry(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
    });

    return this.handleResponse<PartnerAccrualResponse>(url, res, true);
  }

  async cancelAccrual(params: {
    accrualReferenceNumber: string;
    memberId: string;
    lastName: string;
  }): Promise<CancelAccrualResponse> {
    this.ensureConfigured();
    const url = `${this.baseUrl}/member/transactions/accrual/partner/cancel`;

    const payload = {
      partnerID: this.partnerId,
      accrualReferenceNumber: params.accrualReferenceNumber,
      memberProfile: {
        memberId: params.memberId,
        lastName: params.lastName.toUpperCase(),
      },
    };

    this.logger.log(
      `[cancelAccrual] POST ${url} – ref=${params.accrualReferenceNumber}, member=${params.memberId}`,
    );

    const res = await this.fetchWithRetry(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Basic ${this.accrualAuthHeader}`,
      },
      body: JSON.stringify(payload),
    });

    return this.handleResponse<CancelAccrualResponse>(url, res);
  }

  private async fetchWithRetry(
    url: string,
    init: RequestInit,
    retries = 1,
  ): Promise<Response> {
    try {
      return await fetch(url, init);
    } catch (err) {
      if (retries > 0) {
        this.logger.warn(
          `[fetchWithRetry] Transport error, retrying – ${(err as Error).message}`,
        );
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

    if (status >= 200 && status <= 226) {
      return res.json() as Promise<T>;
    }

    const body = await res.text().catch(() => '');

    if (status === 409 && handleConflict) {
      this.logger.warn(`[Qantas 409] Conflict – ${url}: ${body}`);
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
