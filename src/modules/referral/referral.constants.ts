/** Chef commission: 10% of net subscription proceeds, in basis points. */
export const REFERRAL_COMMISSION_RATE_BPS = 1000;

/** Shown to customers; the store offer itself applies the discount. */
export const REFERRAL_CUSTOMER_DISCOUNT_PERCENT = 5;

/** Play Console offer tag the app looks for on each base plan. */
export const REFERRAL_ANDROID_OFFER_TAG = 'chef-referral';

/** Unambiguous characters for generated code suffixes (no 0/O, 1/I). */
export const REFERRAL_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export const REFERRAL_CODE_PATTERN = /^[A-Z0-9]{4,16}$/;
export const REFERRAL_CODE_PREFIX_MAX = 4;
export const REFERRAL_CODE_SUFFIX_LENGTH = 3;

export const DEFAULT_REFERRAL_LINK_BASE_URL = 'https://admin.saveful.app/r';

/** RevenueCat events whose ledger processing failed are retried this many times. */
export const REFERRAL_EVENT_MAX_ATTEMPTS = 10;

export enum ReferralBindRejection {
  INVALID_CODE = 'invalid_code',
  SELF_REFERRAL = 'self_referral',
  NOT_ELIGIBLE_ROLE = 'not_eligible_role',
  ALREADY_SUBSCRIBED = 'already_subscribed',
  USER_NOT_FOUND = 'user_not_found',
}

export enum ReferralHoldReason {
  MISSING_PRICE = 'missing_price',
  MISSING_CURRENCY = 'missing_currency',
  MISSING_TAX = 'missing_tax_percentage',
  MISSING_STORE_FEE = 'missing_commission_percentage',
  INVALID_RATES = 'invalid_rates',
}
