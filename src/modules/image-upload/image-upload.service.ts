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
  private readonly logger = new Logger(ImageUploadService.name);
  constructor(
    @Inject('S3_CLIENT') private readonly s3Client: S3Client,
    private readonly configService: ConfigService,
  ) {
    this.bucket =
      this.configService.get<string>('AWS_BUCKET_NAME') ??
      'default_bucket_name';
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
      }),
    );
    this.logger.log(`Uploaded file: ${key}`);
    return `https://${this.bucket}.s3.${this.configService.get('AWS_REGION')}.amazonaws.com/${key}`;
  }

  async deleteFile(fileUrl: string): Promise<void> {
    try {
      // Extract key from URL
      const urlParts = fileUrl.split('/');
      const keyIndex = urlParts.findIndex((part) => part.includes('amazonaws.com'));
      if (keyIndex === -1 || keyIndex === urlParts.length - 1) {
        this.logger.warn(`Invalid file URL format: ${fileUrl}`);
        return;
      }
      const key = urlParts.slice(keyIndex + 1).join('/');
      
      await this.s3Client.send(
        new DeleteObjectCommand({
          Bucket: this.bucket,
          Key: key,
        }),
      );
      this.logger.log(`Deleted file: ${key}`);
    } catch (error) {
      this.logger.error(`Failed to delete file ${fileUrl}: ${error.message}`);
    }
  }
}
