import { rgbaToThumbHash } from './thumbhash';

/**
 * Expected values were produced by the upstream `thumbhash` package (see
 * scripts/verify-thumbhash-port.mjs) and are frozen here so the vendored port
 * cannot silently drift from the reference implementation. ThumbHash strings are
 * stored on documents and rendered by clients, so a drift would be a data bug.
 */
function opaqueGradient(w: number, h: number): Uint8Array {
  const rgba = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (x + y * w) * 4;
      rgba[i] = (x * 7 + y * 3) % 256;
      rgba[i + 1] = (x * 3 + y * 11) % 256;
      rgba[i + 2] = (x * 13 + y * 5) % 256;
      rgba[i + 3] = 255;
    }
  }
  return rgba;
}

/** Transparent border around an opaque center, like an ingredient hero. */
function transparentBorder(w: number, h: number): Uint8Array {
  const rgba = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (x + y * w) * 4;
      const inside = x > w * 0.2 && x < w * 0.8 && y > h * 0.2 && y < h * 0.8;
      rgba[i] = 220;
      rgba[i + 1] = 90;
      rgba[i + 2] = 40;
      rgba[i + 3] = inside ? 255 : 0;
    }
  }
  return rgba;
}

const encode = (w: number, h: number, rgba: Uint8Array) =>
  Buffer.from(rgbaToThumbHash(w, h, rgba)).toString('base64');

describe('rgbaToThumbHash', () => {
  it.each([
    ['square opaque', 100, 100, '3wcCBwI2Z6CJSRw0MTMqVySmRtAp5h8E'],
    ['landscape opaque', 100, 60, 'IAgGDIR4ljVnZwaGZHdqB1N/ZA=='],
    ['portrait opaque', 60, 100, '3/cBDAJVtKYxE4VwgoZCbqC0Bg=='],
    ['tiny opaque', 3, 3, 'w/cJDwJ1eAqGiHiHiIiIeIh58GiIhI8I'],
  ])('matches upstream for %s %ix%i', (_name, w, h, expected) => {
    expect(encode(w, h, opaqueGradient(w, h))).toBe(expected);
  });

  it.each([
    ['square alpha', 100, 100, 'nQuDBQA1t4d4d392qBeIgH/nB1iHeICLVw=='],
    ['landscape alpha', 90, 40, 'nQuDAoA1+Kd3h3v4h9pgGAdoh3iAi2c='],
    ['portrait alpha', 40, 90, 'nQuDAgA1+HeXd0j4ePpRaAdoh3iAi2c='],
  ])('matches upstream for %s %ix%i', (_name, w, h, expected) => {
    expect(encode(w, h, transparentBorder(w, h))).toBe(expected);
  });

  it('stays within the size budget that makes it cheap to ship inline', () => {
    const bytes = rgbaToThumbHash(100, 100, opaqueGradient(100, 100));
    expect(bytes.length).toBeLessThanOrEqual(35);
  });

  it('rejects images larger than the 100x100 encoder limit', () => {
    expect(() => rgbaToThumbHash(101, 50, new Uint8Array(101 * 50 * 4))).toThrow(
      /doesn't fit/,
    );
  });
});
