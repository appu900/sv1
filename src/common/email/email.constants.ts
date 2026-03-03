export const EMAIL_QUEUE_NAME = 'email';

export enum EmailJobType {
  OTP = 'otp',
  WELCOME = 'welcome',
  PASSWORD_RESET = 'password-reset',
  ACCOUNT_DELETION = 'account-deletion',
}

export interface OTPEmailJobData {
  type: EmailJobType.OTP;
  email: string;
  otpCode: string;
  expiryMinutes: number;
}

export interface WelcomeEmailJobData {
  type: EmailJobType.WELCOME;
  email: string;
  userName: string;
}

export interface PasswordResetEmailJobData {
  type: EmailJobType.PASSWORD_RESET;
  email: string;
  otpCode: string;
  expiryMinutes: number;
}

export interface AccountDeletionEmailJobData {
  type: EmailJobType.ACCOUNT_DELETION;
  email: string;
  userName: string;
}

export type EmailJobData =
  | OTPEmailJobData
  | WelcomeEmailJobData
  | PasswordResetEmailJobData
  | AccountDeletionEmailJobData;
