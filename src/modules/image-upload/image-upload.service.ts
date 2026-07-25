import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  S3Client,
  PutObjectCommand,
  DeleteObjectCommand,
} from '@aws-sdk/client-s3';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'crypto';

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
    await this.s3Client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: file.buffer,
        ContentType: file.mimetype,
        CacheControl: 'public, max-age=31536000, immutable',
      }),
    );
    this.logger.log(`Uploaded file: ${key}`);
    return `${this.cdnBaseUrl}/${key
      .split('/')
      .map(encodeURIComponent)
      .join('/')}`;
  }

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
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`Failed to delete file ${fileUrl}: ${message}`);
    }
  }
}
