import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  S3Client,
  PutObjectCommand,
  DeleteObjectCommand,
} from '@aws-sdk/client-s3';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'crypto';
import {
  isRasterImage,
  renderImageSet,
  VARIANT_WIDTHS,
} from './image-variants';
import { buildCdnAssetUrl } from '../../common/utils/image-url-migration';

export interface HeroImageAsset {
  base: string;
  variants: Record<string, string>;
  width: number;
  height: number;
  thumbhash: string;
}

@Injectable()
export class ImageUploadService {
  private bucket: string;
  private readonly cdnBaseUrl: string;
  private readonly logger = new Logger(ImageUploadService.name);
  constructor(
    @Inject('S3_CLIENT') private readonly s3Client: S3Client,
    private readonly configService: ConfigService,
  ) {
    this.bucket =
      this.configService.get<string>('AWS_BUCKET_NAME') ??
      'default_bucket_name';
    this.cdnBaseUrl = (
      this.configService.get<string>('CDN_BASE_URL') ??
      'https://cdn.saveful.app'
    ).replace(/\/+$/, '');
  }

  async uploadFile(file: Express.Multer.File, folder: string): Promise<string> {
    const fileExt = file.originalname.split('.').pop();
    const key = `${folder}/${randomUUID()}.${fileExt}`;
    await this.putObject(key, file.buffer, file.mimetype);
    return this.publicUrl(key);
  }

  /**
   * Uploads the original image plus a responsive WebP ladder and a ThumbHash.
   *
   * Variants live under `{folder}/{id}/{width}.webp`, keyed off the original's
   * id. Falls back to a base-only descriptor when the file is not a raster image
   * or `sharp` cannot process it, so an upload never fails over image tooling.
   */
  async uploadImageWithVariants(
    file: Express.Multer.File,
    folder: string,
  ): Promise<HeroImageAsset> {
    const id = randomUUID();
    const fileExt = file.originalname.split('.').pop();
    const originalKey = `${folder}/${id}.${fileExt}`;

    await this.putObject(originalKey, file.buffer, file.mimetype);
    const base = this.publicUrl(originalKey);

    if (!isRasterImage(file.mimetype)) {
      return { base, variants: {}, width: 0, height: 0, thumbhash: '' };
    }

    try {
      const rendered = await renderImageSet(file.buffer);
      const variants: Record<string, string> = {};

      for (const variant of rendered.variants) {
        const key = `${folder}/${id}/${variant.width}.webp`;
        await this.putObject(key, variant.buffer, 'image/webp');
        variants[String(variant.width)] = this.publicUrl(key);
      }

      this.logger.log(
        `Generated ${rendered.variants.length} variants for ${originalKey}`,
      );

      return {
        base,
        variants,
        width: rendered.width,
        height: rendered.height,
        thumbhash: rendered.thumbhash,
      };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(
        `Variant generation failed for ${originalKey}, keeping original only: ${message}`,
      );
      return { base, variants: {}, width: 0, height: 0, thumbhash: '' };
    }
  }

  private async putObject(key: string, body: Buffer, contentType?: string) {
    await this.s3Client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: body,
        ContentType: contentType,
        // Keys are content-addressed by UUID and never rewritten, so a new image
        // always means a new URL.
        CacheControl: 'public, max-age=31536000, immutable',
      }),
    );
    this.logger.log(`Uploaded file: ${key}`);
  }

  private publicUrl(key: string): string {
    return buildCdnAssetUrl(key, this.cdnBaseUrl);
  }

  private async deleteDerivedVariants(originalKey: string) {
    const prefix = originalKey.replace(/\.[^/.]+$/, '');
    if (!prefix || prefix === originalKey) return;

    await Promise.all(
      VARIANT_WIDTHS.map(async width => {
        try {
          await this.s3Client.send(
            new DeleteObjectCommand({
              Bucket: this.bucket,
              Key: `${prefix}/${width}.webp`,
            }),
          );
        } catch {
        }
      }),
    );
  }

  static readonly variantWidths = VARIANT_WIDTHS;

  async deleteFile(fileUrl: string): Promise<void> {
    try {
      const file = new URL(fileUrl);
      const cdn = new URL(this.cdnBaseUrl);
      const isCdnUrl = file.origin === cdn.origin;
      const isLegacyS3Url = file.hostname.endsWith('.amazonaws.com');

      if (!isCdnUrl && !isLegacyS3Url) {
        this.logger.warn(`Invalid file URL format: ${fileUrl}`);
        return;
      }

      let key = decodeURIComponent(file.pathname.replace(/^\/+/, ''));
      if (
        isLegacyS3Url &&
        file.hostname.startsWith('s3.') &&
        key.startsWith(`${this.bucket}/`)
      ) {
        key = key.slice(this.bucket.length + 1);
      }

      if (isCdnUrl) {
        const cdnPath = cdn.pathname.replace(/^\/+|\/+$/g, '');
        if (cdnPath && key.startsWith(`${cdnPath}/`)) {
          key = key.slice(cdnPath.length + 1);
        }
      }

      if (!key) {
        this.logger.warn(`Invalid file URL format: ${fileUrl}`);
        return;
      }

      await this.s3Client.send(
        new DeleteObjectCommand({
          Bucket: this.bucket,
          Key: key,
        }),
      );
      this.logger.log(`Deleted file: ${key}`);

      await this.deleteDerivedVariants(key);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`Failed to delete file ${fileUrl}: ${message}`);
    }
  }
}
