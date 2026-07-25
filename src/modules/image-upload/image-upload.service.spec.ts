import { DeleteObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import { ConfigService } from '@nestjs/config';
import { ImageUploadService } from './image-upload.service';

const file = {
  originalname: 'photo.jpg',
  mimetype: 'image/jpeg',
  buffer: Buffer.from('image'),
} as Express.Multer.File;

function createService(config: Record<string, string> = {}) {
  const s3Client = { send: jest.fn().mockResolvedValue({}) };
  const configService = {
    get: jest.fn((key: string) => config[key]),
  };
  const service = new ImageUploadService(
    s3Client as never,
    configService as unknown as ConfigService,
  );

  return { service, s3Client };
}

describe('ImageUploadService', () => {
  it('uploads with immutable caching and returns the default CDN URL', async () => {
    const { service, s3Client } = createService({
      AWS_BUCKET_NAME: 'saveful',
    });

    const url = await service.uploadFile(file, 'recipes');

    expect(url).toMatch(
      /^https:\/\/cdn\.saveful\.app\/recipes\/[0-9a-f-]+\.jpg$/,
    );
    const command = s3Client.send.mock.calls[0][0] as PutObjectCommand;
    expect(command.input).toMatchObject({
      Bucket: 'saveful',
      ContentType: 'image/jpeg',
      CacheControl: 'public, max-age=31536000, immutable',
    });
    expect(command.input.Key).toMatch(/^recipes\/[0-9a-f-]+\.jpg$/);
  });

  it('supports a configured CDN base URL', async () => {
    const { service } = createService({
      AWS_BUCKET_NAME: 'saveful',
      CDN_BASE_URL: 'https://cdn.example.com/assets/',
    });

    const url = await service.uploadFile(file, 'recipes');

    expect(url).toMatch(
      /^https:\/\/cdn\.example\.com\/assets\/recipes\/[0-9a-f-]+\.jpg$/,
    );
  });

  it.each([
    [
      'https://cdn.saveful.app/recipes/photo.jpg',
      'recipes/photo.jpg',
    ],
    [
      'https://saveful.s3.ap-south-1.amazonaws.com/recipes/photo.jpg',
      'recipes/photo.jpg',
    ],
    [
      'https://s3.ap-south-1.amazonaws.com/saveful/recipes/photo.jpg',
      'recipes/photo.jpg',
    ],
  ])('deletes CDN and legacy S3 URLs', async (url, expectedKey) => {
    const { service, s3Client } = createService({
      AWS_BUCKET_NAME: 'saveful',
    });

    await service.deleteFile(url);

    const command = s3Client.send.mock.calls[0][0] as DeleteObjectCommand;
    expect(command.input).toEqual({
      Bucket: 'saveful',
      Key: expectedKey,
    });
  });

  it('does not delete unrecognized URLs', async () => {
    const { service, s3Client } = createService({
      AWS_BUCKET_NAME: 'saveful',
    });

    await service.deleteFile('https://example.com/recipes/photo.jpg');

    expect(s3Client.send).not.toHaveBeenCalled();
  });
});
