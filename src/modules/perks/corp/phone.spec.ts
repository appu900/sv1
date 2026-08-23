import { toWemadPhone } from './phone';

/**
 * WeMAD's production API answers anything but nine digits with
 * 422 `{"phone":["The phone field must be 9 digits."]}`.
 *
 * We forwarded 8 to 11 digits untouched before this, so every Australian
 * mobile arrived with its leading zero and no member could finish signing up —
 * including one who had already paid.
 */
describe('toWemadPhone', () => {
  it('reduces every way of writing one Australian mobile to the same nine digits', () => {
    for (const written of [
      '0412228301',
      '0412 228 301',
      '(04) 1222 8301',
      '+61 412 228 301',
      '+61412228301',
      '61412228301',
      '0061412228301',
      '412228301',
    ]) {
      expect(toWemadPhone(written)).toBe('412228301');
    }
  });

  it('keeps a landline that is already national format', () => {
    expect(toWemadPhone('03 9123 4567')).toBe('391234567');
  });

  it('refuses a number that cannot be an Australian one', () => {
    // A ten-digit Indian mobile has no trunk zero to strip, so nothing makes
    // it nine digits. Better caught here than as a 422 from WeMAD.
    expect(toWemadPhone('8260951404')).toBeNull();
    expect(toWemadPhone('7008485825')).toBeNull();
    // A US number with its country code is eleven digits but not +61.
    expect(toWemadPhone('+1 415 555 0123')).toBeNull();
  });

  it('refuses anything too short or absent', () => {
    expect(toWemadPhone('123')).toBeNull();
    expect(toWemadPhone('')).toBeNull();
    expect(toWemadPhone(null)).toBeNull();
    expect(toWemadPhone(undefined)).toBeNull();
  });

  it('never returns anything but nine digits', () => {
    for (const written of [
      '0412228301',
      '+61412228301',
      '412228301',
      '8260951404',
      'not a phone',
    ]) {
      const result = toWemadPhone(written);
      if (result !== null) expect(result).toMatch(/^\d{9}$/);
    }
  });
});
