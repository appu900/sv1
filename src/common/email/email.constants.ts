export const EMAIL_QUEUE_NAME = 'email';

export enum EmailJobType {
  OTP = 'otp',
  WELCOME = 'welcome',
  PASSWORD_RESET = 'password-reset',
  ACCOUNT_DELETION = 'account-deletion',
  CHEF_REFERRAL_STATEMENT = 'chef-referral-statement',
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

export interface ChefReferralStatementEmailJobData {
  type: EmailJobType.CHEF_REFERRAL_STATEMENT;
  email: string;
  chefName: string;
  quarter: string;
  /** Pre-formatted, e.g. "A$123.45". */
  paidAmount: string;
  paidAt: string;
  paymentReference: string;
  /** Earned amounts per currency included in this payout. */
  lines: Array<{ label: string; amount: string }>;
  portalUrl: string;
}

export type EmailJobData =
  | OTPEmailJobData
  | WelcomeEmailJobData
  | PasswordResetEmailJobData
  | AccountDeletionEmailJobData
  | ChefReferralStatementEmailJobData;
