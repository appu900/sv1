/**
 * ThumbHash encoder, ported from the reference implementation at
 * https://github.com/evanw/thumbhash (MIT). Vendored rather than depended upon
 * because the published package is ESM-only and this backend compiles to
 * CommonJS; `thumbhash.spec.ts` pins the output to the upstream bytes.
 *
 * Produces ~25-32 bytes that decode into a recognizable blur, which the app uses
 * as an `expo-image` placeholder so cards paint content instead of a blank box.
 */

const MAX_DIMENSION = 100;

interface EncodedChannel {
  dc: number;
  ac: number[];
  scale: number;
}

/**
 * @param w Image width in pixels, at most 100.
 * @param h Image height in pixels, at most 100.
 * @param rgba Row-major RGBA bytes, 4 per pixel.
 */
export function rgbaToThumbHash(
  w: number,
  h: number,
  rgba: Uint8Array,
): Uint8Array {
  if (w > MAX_DIMENSION || h > MAX_DIMENSION) {
    throw new Error(`${w}x${h} doesn't fit in ${MAX_DIMENSION}x${MAX_DIMENSION}`);
  }

  // Alpha-weighted average color, used as the background the image is composited
  // onto so transparent regions do not skew the DCT.
  let avgR = 0;
  let avgG = 0;
  let avgB = 0;
  let avgA = 0;
  for (let i = 0, j = 0; i < w * h; i++, j += 4) {
    const alpha = rgba[j + 3] / 255;
    avgR += (alpha / 255) * rgba[j];
    avgG += (alpha / 255) * rgba[j + 1];
    avgB += (alpha / 255) * rgba[j + 2];
    avgA += alpha;
  }
  if (avgA > 0) {
    avgR /= avgA;
    avgG /= avgA;
    avgB /= avgA;
  }

  const hasAlpha = avgA < w * h;
  // Spend fewer luminance coefficients when alpha also needs encoding.
  const luminanceLimit = hasAlpha ? 5 : 7;
  const lx = Math.max(1, Math.round((luminanceLimit * w) / Math.max(w, h)));
  const ly = Math.max(1, Math.round((luminanceLimit * h) / Math.max(w, h)));

  const luminance: number[] = [];
  const yellowBlue: number[] = [];
  const redGreen: number[] = [];
  const alphaChannel: number[] = [];

  for (let i = 0, j = 0; i < w * h; i++, j += 4) {
    const alpha = rgba[j + 3] / 255;
    const r = avgR * (1 - alpha) + (alpha / 255) * rgba[j];
    const g = avgG * (1 - alpha) + (alpha / 255) * rgba[j + 1];
    const b = avgB * (1 - alpha) + (alpha / 255) * rgba[j + 2];
    luminance.push((r + g + b) / 3);
    yellowBlue.push((r + g) / 2 - b);
    redGreen.push(r - g);
    alphaChannel.push(alpha);
  }

  const encodeChannel = (
    channel: number[],
    nx: number,
    ny: number,
  ): EncodedChannel => {
    let dc = 0;
    let scale = 0;
    const ac: number[] = [];
    const fx: number[] = [];

    for (let cy = 0; cy < ny; cy++) {
      for (let cx = 0; cx * ny < nx * (ny - cy); cx++) {
        let f = 0;
        for (let x = 0; x < w; x++) {
          fx[x] = Math.cos((Math.PI / w) * cx * (x + 0.5));
        }
        for (let y = 0; y < h; y++) {
          const fy = Math.cos((Math.PI / h) * cy * (y + 0.5));
          for (let x = 0; x < w; x++) {
            f += channel[x + y * w] * fx[x] * fy;
          }
        }
        f /= w * h;
        if (cx || cy) {
          ac.push(f);
          scale = Math.max(scale, Math.abs(f));
        } else {
          dc = f;
        }
      }
    }

    if (scale > 0) {
      for (let i = 0; i < ac.length; i++) {
        ac[i] = 0.5 + (0.5 / scale) * ac[i];
      }
    }

    return { dc, ac, scale };
  };

  const l = encodeChannel(luminance, Math.max(3, lx), Math.max(3, ly));
  const p = encodeChannel(yellowBlue, 3, 3);
  const q = encodeChannel(redGreen, 3, 3);
  const a = hasAlpha ? encodeChannel(alphaChannel, 5, 5) : null;

  const isLandscape = w > h;
  const header24 =
    Math.round(63 * l.dc) |
    (Math.round(31.5 + 31.5 * p.dc) << 6) |
    (Math.round(31.5 + 31.5 * q.dc) << 12) |
    (Math.round(31 * l.scale) << 18) |
    ((hasAlpha ? 1 : 0) << 23);
  const header16 =
    (isLandscape ? ly : lx) |
    (Math.round(63 * p.scale) << 3) |
    (Math.round(63 * q.scale) << 9) |
    ((isLandscape ? 1 : 0) << 15);

  const hash: number[] = [
    header24 & 255,
    (header24 >> 8) & 255,
    header24 >> 16,
    header16 & 255,
    header16 >> 8,
  ];

  const acStart = hasAlpha ? 6 : 5;
  let acIndex = 0;
  if (a) {
    hash.push(Math.round(15 * a.dc) | (Math.round(15 * a.scale) << 4));
  }

  // Each AC coefficient is quantized to 4 bits, two per byte.
  const channels = a ? [l.ac, p.ac, q.ac, a.ac] : [l.ac, p.ac, q.ac];
  for (const ac of channels) {
    for (const f of ac) {
      const index = acStart + (acIndex >> 1);
      hash[index] =
        (hash[index] || 0) | (Math.round(15 * f) << ((acIndex++ & 1) << 2));
    }
  }

  return new Uint8Array(hash);
}
