import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsDateString,
  IsEnum,
  IsIn,
  IsInt,
  IsMongoId,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  Min,
} from 'class-validator';
import { ReferralCodeStatus } from '../../../database/schemas/referral-code.schema';

const QUARTER = /^\d{4}-Q[1-4]$/;
const CURRENCY = /^[A-Za-z]{3}$/;

export class CreateReferralCodeDto {
  @IsMongoId()
  chefUserId: string;

  /** Optional vanity code; generated from the chef slug when omitted. */
  @IsOptional()
  @IsString()
  @MaxLength(32)
  code?: string;

  @IsOptional()
  @IsBoolean()
  makePrimary?: boolean;
}

export class UpdateReferralCodeDto {
  @IsOptional()
  @IsEnum(ReferralCodeStatus)
  status?: ReferralCodeStatus;

  @IsOptional()
  @IsBoolean()
  isPrimary?: boolean;
}

export class AttributionQueryDto {
  @IsOptional()
  @IsMongoId()
  chefUserId?: string;

  @IsOptional()
  @IsString()
  status?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  limit?: number;
}

export class AttributionNoteDto {
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}

export class ReassignAttributionDto extends AttributionNoteDto {
  @IsString()
  @IsNotEmpty()
  code: string;
}

export class LedgerQueryDto {
  @IsOptional()
  @IsMongoId()
  chefUserId?: string;

  @IsOptional()
  @IsString()
  status?: string;

  @IsOptional()
  @IsString()
  type?: string;

  @IsOptional()
  @IsIn(['PRODUCTION', 'SANDBOX', 'production', 'sandbox'])
  environment?: string;

  @IsOptional()
  @Matches(QUARTER, { message: 'quarter must look like 2026-Q4' })
  quarter?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  limit?: number;
}

export class ResolveHoldDto {
  @Matches(CURRENCY)
  currency: string;

  @IsInt()
  @Min(0)
  commissionMinor: number;

  @IsOptional()
  @IsInt()
  netMinor?: number;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}

export class CreateAdjustmentDto {
  @IsMongoId()
  chefUserId: string;

  @Matches(CURRENCY)
  currency: string;

  /** Signed minor units: negative to claw back, positive to credit. */
  @IsInt()
  commissionMinor: number;

  @IsOptional()
  @IsInt()
  commissionUsdCents?: number;

  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  note: string;
}

export class GeneratePayoutsDto {
  @Matches(QUARTER, { message: 'quarter must look like 2026-Q4' })
  quarter: string;
}

export class PayoutQueryDto {
  @IsOptional()
  @Matches(QUARTER, { message: 'quarter must look like 2026-Q4' })
  quarter?: string;

  @IsOptional()
  @IsString()
  status?: string;

  @IsOptional()
  @IsMongoId()
  chefUserId?: string;
}

export class MarkPayoutPaidDto {
  @IsInt()
  @Min(1)
  paidAmountMinor: number;

  @Matches(CURRENCY)
  paidCurrency: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  paymentReference: string;

  @IsOptional()
  @IsDateString()
  paidAt?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  fxNote?: string;
}

export class VoidPayoutDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  reason: string;
}

export class UpdatePaymentDetailsDto {
  @IsIn(['not_collected', 'pending', 'verified'])
  status: string;

  @IsOptional()
  @Matches(/^\d{4}$/, { message: 'accountNumberLast4 must be 4 digits' })
  accountNumberLast4?: string;

  @IsOptional()
  @Matches(CURRENCY)
  currency?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}

export class ExportPayoutsQueryDto {
  @Matches(QUARTER, { message: 'quarter must look like 2026-Q4' })
  quarter: string;
}
