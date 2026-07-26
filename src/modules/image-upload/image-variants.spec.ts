import {
  isRasterImage,
  renderImageSet,
  renderThumbhash,
  VARIANT_WIDTHS,
} from './image-variants';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const sharp = require('sharp');

jest.setTimeout(30000);

/** Transparent PNG with a colored subject, mimicking an ingredient hero. */
async function createTransparentHero(size: number): Promise<Buffer> {
  const subject = await sharp({
    create: {
      width: Math.round(size * 0.6),
      height: Math.round(size * 0.6),
      channels: 4,
      background: { r: 220, g: 90, b: 40, alpha: 1 },
    },
  })
    .png()
    .toBuffer();

  return sharp({
    create: {
      width: size,
      height: size,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    },
  })
    .composite([{ input: subject, gravity: 'center' }])
    .png()
    .toBuffer();
}

describe('renderImageSet', () => {
  it('emits the full WebP ladder for a large source and preserves alpha', async () => {
    const source = await createTransparentHero(1600);
    const set = await renderImageSet(source);

    expect(set.width).toBe(1600);
    expect(set.height).toBe(1600);
    expect(set.variants.map(v => v.width)).toEqual([...VARIANT_WIDTHS]);

    for (const variant of set.variants) {
      const metadata = await sharp(variant.buffer).metadata();
      expect(metadata.format).toBe('webp');
      expect(metadata.width).toBe(variant.width);
      // Ingredient heroes sit on colored circles; losing alpha would show a box.
      expect(metadata.hasAlpha).toBe(true);
    }
  });

  it('produces variants far smaller than the source PNG', async () => {
    const source = await createTransparentHero(1600);
    const set = await renderImageSet(source);
    const at384 = set.variants.find(v => v.width === 384);

    expect(at384).toBeDefined();
    expect(at384!.buffer.length).toBeLessThan(source.length * 0.2);
  });

  it('never upscales past the source width', async () => {
    const set = await renderImageSet(await createTransparentHero(300));
    expect(set.variants.map(v => v.width)).toEqual([128, 256]);
  });

  it('still emits one variant for a source below the smallest rung', async () => {
    const set = await renderImageSet(await createTransparentHero(64));
    expect(set.variants.map(v => v.width)).toEqual([64]);
  });

  it('rejects unreadable input rather than writing a broken variant', async () => {
    await expect(renderImageSet(Buffer.from('not an image'))).rejects.toThrow();
  });
});

describe('renderThumbhash', () => {
  it('produces a compact hash that round-trips through base64', async () => {
    const hash = await renderThumbhash(await createTransparentHero(1600));
    const bytes = Buffer.from(hash, 'base64');

    expect(bytes.length).toBeGreaterThan(0);
    // ThumbHash is ~25-32 bytes; anything larger means we stored the wrong thing.
    expect(bytes.length).toBeLessThanOrEqual(35);
  });
});

describe('isRasterImage', () => {
  it('accepts the formats sharp can resize and rejects everything else', () => {
    expect(isRasterImage('image/png')).toBe(true);
    expect(isRasterImage('image/jpeg')).toBe(true);
    expect(isRasterImage('image/webp')).toBe(true);
    expect(isRasterImage('image/svg+xml')).toBe(false);
    expect(isRasterImage('application/pdf')).toBe(false);
    expect(isRasterImage(undefined)).toBe(false);
  });
});
