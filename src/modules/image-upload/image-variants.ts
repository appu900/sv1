import type { Sharp, SharpInput, SharpOptions, WebpOptions } from 'sharp';
import { rgbaToThumbHash } from './thumbhash';


// eslint-disable-next-line @typescript-eslint/no-require-imports
const sharp: (input?: SharpInput, options?: SharpOptions) => Sharp =
  require('sharp');

export const VARIANT_WIDTHS = [128, 256, 384, 640, 960, 1440] as const;

const WEBP_OPTIONS: WebpOptions = {
  quality: 82,
  alphaQuality: 100,
  effort: 5,
};

const THUMBHASH_MAX_DIMENSION = 100;

export interface RenderedVariant {
  width: number;
  buffer: Buffer;
}

export interface RenderedImageSet {
  variants: RenderedVariant[];
  width: number;
  height: number;
  thumbhash: string;
}

export function isRasterImage(mimetype?: string): boolean {
  if (!mimetype) return false;
  return /^image\/(png|jpe?g|webp|tiff|avif|gif)$/i.test(mimetype);
}
export async function renderImageSet(
  source: Buffer,
): Promise<RenderedImageSet> {
  const metadata = await sharp(source).metadata();
  const sourceWidth = metadata.width ?? 0;
  const sourceHeight = metadata.height ?? 0;

  if (!sourceWidth || !sourceHeight) {
    throw new Error('Unable to read image dimensions');
  }

  const targetWidths: number[] = VARIANT_WIDTHS.filter(
    width => width <= sourceWidth,
  );
  if (targetWidths.length === 0) {
    targetWidths.push(sourceWidth);
  }

  const variants: RenderedVariant[] = [];
  for (const width of targetWidths) {
    const buffer = await sharp(source)
      .rotate() 
      .resize({ width, withoutEnlargement: true })
      .webp(WEBP_OPTIONS)
      .toBuffer();
    variants.push({ width, buffer });
  }

  return {
    variants,
    width: sourceWidth,
    height: sourceHeight,
    thumbhash: await renderThumbhash(source),
  };
}

export async function renderThumbhash(source: Buffer): Promise<string> {
  const { data, info } = await sharp(source)
    .rotate()
    .resize({
      width: THUMBHASH_MAX_DIMENSION,
      height: THUMBHASH_MAX_DIMENSION,
      fit: 'inside',
      withoutEnlargement: true,
    })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const hash = rgbaToThumbHash(
    info.width,
    info.height,
    new Uint8Array(data.buffer, data.byteOffset, data.byteLength),
  );
  return Buffer.from(hash).toString('base64');
}
