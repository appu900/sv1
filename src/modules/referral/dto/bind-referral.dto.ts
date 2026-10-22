import { IsIn, IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';
import { REFERRAL_SOURCES } from '../../../database/schemas/referral-attribution.schema';

export class BindReferralDto {
  /** Referral code or a pasted referral link. */
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  code: string;

  @IsOptional()
  @IsIn(REFERRAL_SOURCES)
  source?: string;
}
