import { Controller, Get, INestApplication, Query, Req, Res } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import * as compression from 'compression';
import { Request, Response } from 'express';
import { get, Server } from 'http';
import { AddressInfo } from 'net';
import * as request from 'supertest';
import { sendCacheableJson } from '../src/common/http/cacheable-json';

const CURRENT_VERSION = 42;

/**
 * Roughly the size and shape of a real recipe-summaries response, which matters
 * because `compression` only kicks in above a 1 KB threshold.
 */
const PAYLOAD = Array.from({ length: 160 }, (_, index) => ({
  _id: index.toString(16).padStart(24, '0'),
  title: `Recipe number ${index}`,
  heroImageUrl: `https://cdn.saveful.app/saveful/recipes/hero/recipe-${index}.png`,
  order: index,
  frameworkCategoryIds: ['5f0000000000000000000001'],
  variantTags: ['Mild', 'Spicy'],
  unsubstitutableIngredientIds: ['5f0000000000000000000002'],
}));

@Controller('summaries')
class SummariesTestController {
  @Get()
  find(
    @Req() req: Request,
    @Res() res: Response,
    @Query('v') v?: string,
  ) {
    return sendCacheableJson(req, res, PAYLOAD, {
      requestedVersion: v,
      currentVersion: CURRENT_VERSION,
    });
  }
}

async function countWireBytes(
  app: INestApplication,
  acceptEncoding: string,
): Promise<number> {
  const server = app.getHttpServer() as Server;
  if (!server.listening) {
    await new Promise<void>((resolve) => server.listen(0, resolve));
  }
  const { port } = server.address() as AddressInfo;

  return new Promise((resolve, reject) => {
    const req = get(
      {
        port,
        path: '/api/summaries',
        headers: { 'accept-encoding': acceptEncoding },
      },
      (res) => {
        let bytes = 0;
        res.on('data', (chunk: Buffer) => {
          bytes += chunk.length;
        });
        res.on('end', () => resolve(bytes));
      },
    );
    req.on('error', reject);
  });
}

/**
 * Exercises the response pipeline the summary endpoints depend on, using the
 * same middleware order as src/main.ts. Compression, the CORS `Vary` header,
 * ETag revalidation and the `immutable` opt-in all interact, and a regression in
 * any one of them silently costs either bytes or freshness.
 */
describe('summary response caching and compression', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [SummariesTestController],
    }).compile();

    app = moduleRef.createNestApplication();
    app.use(compression({ threshold: 1024, level: 6 }));
    app.setGlobalPrefix('api');
    app.enableCors({ origin: true, credentials: true });
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('gzips the response and advertises Vary: Accept-Encoding', async () => {
    const identity = await request(app.getHttpServer())
      .get('/api/summaries')
      .set('Accept-Encoding', 'identity')
      .expect(200);

    const gzipped = await request(app.getHttpServer())
      .get('/api/summaries')
      .set('Accept-Encoding', 'gzip')
      .expect(200);

    expect(gzipped.headers['content-encoding']).toBe('gzip');
    expect(gzipped.headers.vary).toContain('Accept-Encoding');
    expect(identity.headers['content-encoding']).toBeUndefined();
    expect(gzipped.body).toEqual(identity.body);
  });

  it('shrinks the transferred bytes by at least 5x', async () => {
    // supertest inflates transparently and gzip replies are chunked, so counting
    // raw socket bytes is the only way to see the real transfer size.
    const wireBytes = await countWireBytes(app, 'gzip');
    const rawBytes = await countWireBytes(app, 'identity');

    expect(rawBytes).toBeGreaterThan(10_000);
    expect(wireBytes).toBeLessThan(rawBytes / 5);
  });

  it('keeps the CORS Vary: Origin alongside Accept-Encoding', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/summaries')
      .set('Origin', 'https://saveful.app')
      .set('Accept-Encoding', 'gzip')
      .expect(200);

    expect(response.headers.vary).toContain('Origin');
    expect(response.headers.vary).toContain('Accept-Encoding');
  });

  it('marks a current ?v= immutable and an absent one revalidating', async () => {
    const pinned = await request(app.getHttpServer())
      .get(`/api/summaries?v=${CURRENT_VERSION}`)
      .expect(200);
    expect(pinned.headers['cache-control']).toBe(
      'public, max-age=31536000, immutable',
    );

    const unpinned = await request(app.getHttpServer())
      .get('/api/summaries')
      .expect(200);
    expect(unpinned.headers['cache-control']).toBe(
      'public, max-age=0, must-revalidate',
    );

    const stale = await request(app.getHttpServer())
      .get(`/api/summaries?v=${CURRENT_VERSION - 1}`)
      .expect(200);
    expect(stale.headers['cache-control']).toBe(
      'public, max-age=0, must-revalidate',
    );
  });

  it('revalidates to a 304 that carries no body', async () => {
    const first = await request(app.getHttpServer())
      .get('/api/summaries')
      .expect(200);

    const etag = first.headers.etag;
    expect(etag).toBeTruthy();

    const second = await request(app.getHttpServer())
      .get('/api/summaries')
      .set('If-None-Match', etag)
      .expect(304);

    expect(second.text).toBeFalsy();
    expect(second.headers['x-data-version']).toBe(String(CURRENT_VERSION));
  });
});
