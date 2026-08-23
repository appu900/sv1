/**
 * The one place a phone number is put into WeMAD's format.
 *
 * They want the Australian national number: exactly nine digits, no country
 * code and no trunk zero. `0412 228 301`, `+61 412 228 301` and `412228301`
 * are the same number and all three must arrive as `412228301`.
 *
 * Verified against their production API — anything else comes back
 * 422 `{"phone":["The phone field must be 9 digits."]}`. We used to forward
 * 8 to 11 digits untouched, so every Australian mobile went with its leading
 * zero attached and no member could complete sign-up. It applies to gift
 * recipients as well as the member, so both go through here.
 */
export function toWemadPhone(value: unknown): string | null {
  let digits = String(value ?? '').replace(/\D+/g, '');
  if (digits.startsWith('00')) digits = digits.slice(2);
  if (digits.length === 11 && digits.startsWith('61')) digits = digits.slice(2);
  if (digits.length === 10 && digits.startsWith('0')) digits = digits.slice(1);
  return digits.length === 9 ? digits : null;
}
