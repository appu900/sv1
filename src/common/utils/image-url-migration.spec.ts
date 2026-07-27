import {
  buildCdnAssetUrl,
  collectLegacyImageUrlChanges,
  rewriteLegacyS3ImagesInHtml,
  rewriteLegacyS3Url,
} from './image-url-migration';

describe('image URL migration utilities', () => {
  it.each([
    [
      'https://saveful.s3.ap-south-1.amazonaws.com/recipes/photo.jpg',
      'https://cdn.saveful.app/recipes/photo.jpg',
    ],
    [
      'https://saveful1.s3.ap-south-1.amazonaws.com/email-templates/2026/07/banner.png',
      'https://cdn.saveful.app/email-templates/2026/07/banner.png',
    ],
    [
      'https://s3.ap-south-1.amazonaws.com/saveful/saveful/chef/avatar.webp',
      'https://cdn.saveful.app/saveful/chef/avatar.webp',
    ],
    [
      'https://s3.amazonaws.com/saveful1/folder/a%20b.jpg?X-Amz-Signature=secret',
      'https://cdn.saveful.app/folder/a%20b.jpg',
    ],
    [
      'http://saveful.s3-ap-south-1.amazonaws.com/folder/a+b.jpg',
      'https://cdn.saveful.app/folder/a%2Bb.jpg',
    ],
  ])('rewrites supported S3 URL %s', (input, expected) => {
    expect(rewriteLegacyS3Url(input)).toMatchObject({
      changed: true,
      value: expected,
    });
  });

  it.each([
    'https://cdn.saveful.app/recipes/photo.jpg',
    'https://example.com/photo.jpg',
    'https://other-bucket.s3.ap-south-1.amazonaws.com/photo.jpg',
    'https://d3fg04h02j12vm.cloudfront.net/photo.jpg',
    '/badges/onboarding/first-plate.png',
    'data:image/png;base64,abc',
    'blob:https://saveful.app/id',
    'https://youtube.com/watch?v=abc',
    '',
  ])('leaves unsupported URL unchanged: %s', (input) => {
    expect(rewriteLegacyS3Url(input)).toEqual({
      changed: false,
      value: input,
    });
  });

  it('preserves an already encoded object key without double-decoding it', () => {
    expect(
      rewriteLegacyS3Url(
        'https://saveful.s3.ap-south-1.amazonaws.com/folder/a%2520b.jpg',
      ).value,
    ).toBe('https://cdn.saveful.app/folder/a%2520b.jpg');
  });

  it('uses a configured CDN base path', () => {
    expect(buildCdnAssetUrl('recipes/photo.jpg', 'https://cdn.test/assets/')).toBe(
      'https://cdn.test/assets/recipes/photo.jpg',
    );
  });

  it('rewrites only image src attributes inside HTML', () => {
    const input =
      '<a href="https://saveful.s3.ap-south-1.amazonaws.com/docs/file.pdf">' +
      '<img alt="Hero" src="https://saveful.s3.ap-south-1.amazonaws.com/recipes/hero.jpg">' +
      '<img src="https://example.com/external.jpg"></a>';

    expect(rewriteLegacyS3ImagesInHtml(input)).toEqual({
      changed: true,
      value:
        '<a href="https://saveful.s3.ap-south-1.amazonaws.com/docs/file.pdf">' +
        '<img alt="Hero" src="https://cdn.saveful.app/recipes/hero.jpg">' +
        '<img src="https://example.com/external.jpg"></a>',
    });
  });

  it('supports single-quoted image src attributes', () => {
    const result = rewriteLegacyS3ImagesInHtml(
      "<img src='https://saveful1.s3.ap-south-1.amazonaws.com/email/logo.png'>",
    );
    expect(result.value).toBe(
      "<img src='https://cdn.saveful.app/email/logo.png'>",
    );
  });

  it('collects nested image fields, arrays, builder blocks, and HTML changes', () => {
    const legacy = 'https://saveful.s3.ap-south-1.amazonaws.com';
    const document = {
      heroImageUrl: `${legacy}/recipes/hero.jpg`,
      imageUrls: [`${legacy}/email/one.png`, 'https://example.com/two.png'],
      articleBlocks: [
        {
          type: 'video',
          videoUrl: 'https://youtube.com/watch?v=abc',
          videoThumbnail: `${legacy}/hacks/thumb.jpg`,
        },
        {
          type: 'text',
          text: `<p>Copy</p><img src="${legacy}/hacks/inline.jpg">`,
        },
      ],
      builderConfig: {
        theme: { headerLogoUrl: `${legacy}/email/logo.png` },
        blocks: [
          { type: 'image', url: `${legacy}/email/banner.png` },
          { type: 'button', url: `${legacy}/should-not-change.png` },
        ],
      },
    };

    const changes = collectLegacyImageUrlChanges(
      document,
      'payload',
    );

    expect(changes.map((change) => change.path)).toEqual([
      'payload.heroImageUrl',
      'payload.imageUrls.0',
      'payload.articleBlocks.0.videoThumbnail',
      'payload.articleBlocks.1.text',
      'payload.builderConfig.theme.headerLogoUrl',
      'payload.builderConfig.blocks.0.url',
    ]);
    expect(changes).toHaveLength(6);
    expect(changes.every((change) => change.after.includes('cdn.saveful.app'))).toBe(
      true,
    );
  });

  it('is idempotent for a fully migrated nested document', () => {
    expect(
      collectLegacyImageUrlChanges(
        {
          imageUrl: 'https://cdn.saveful.app/recipes/hero.jpg',
          bodyHtml: '<img src="https://cdn.saveful.app/email/banner.png">',
        },
        'payload',
      ),
    ).toEqual([]);
  });
});
