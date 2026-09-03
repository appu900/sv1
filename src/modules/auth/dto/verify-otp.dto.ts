import { IsEmail, IsNotEmpty, IsString, Length } from 'class-validator';
import { Transform } from 'class-transformer';

export class VerifyOtpDto {
  /** Email the OTP was sent to. */
  @IsEmail({}, { message: 'Please provide a valid email address' })
  @IsNotEmpty()
  @Transform(({ value }) => value?.toLowerCase()?.trim())
  email: string;

  /** 6-digit one-time code from the email. */
  @IsString()
  @IsNotEmpty()
  @Length(6, 6)
  otp: string;
}
