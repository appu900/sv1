import { Request, Response } from 'express';
import { sendCacheableJson } from './cacheable-json';

function mockRes() {
  const headers: Record<string, string> = {};
  const varied: string[] = [];
  const res = {
    headers,
    varied,
    statusCode: 200,
    body: undefined as unknown,
    ended: false,
    setHeader(name: string, value: string) {
      headers[name] = value;
    },
    vary(value: string) {
      varied.push(value);
      return res;
    },
    status(code: number) {
      res.statusCode = code;
      return res;
    },
    end() {
      res.ended = true;
      return res;
    },
    send(body: unknown) {
      res.body = body;
      return res;
    },
  };
  return res;
}

function mockReq(ifNoneMatch?: string) {
  return {
    headers: ifNoneMatch ? { 'if-none-match': ifNoneMatch } : {},
  } as unknown as Request;
}

describe('sendCacheableJson', () => {
  it('marks a version-pinned URL immutable so nginx and CloudFront can serve it', () => {
    const res = mockRes();
    sendCacheableJson(mockReq(), res as unknown as Response, [{ a: 1 }], {
      requestedVersion: '42',
      currentVersion: 42,
    });

    expect(res.headers['Cache-Control']).toBe(
      'public, max-age=31536000, immutable',
    );
    expect(res.headers['X-Data-Version']).toBe('42');
    expect(res.varied).toContain('Accept-Encoding');
    expect(res.body).toBe(JSON.stringify([{ a: 1 }]));
  });

  it('falls back to revalidation for a stale or absent version', () => {
    for (const requestedVersion of [undefined, '', '41']) {
      const res = mockRes();
      sendCacheableJson(mockReq(), res as unknown as Response, [], {
        requestedVersion,
        currentVersion: 42,
      });
      expect(res.headers['Cache-Control']).toBe(
        'public, max-age=0, must-revalidate',
      );
    }
  });

  it('answers a matching If-None-Match with a bodyless 304', () => {
    const first = mockRes();
    const payload = [{ _id: 'a', title: 'Soup' }];
    sendCacheableJson(mockReq(), first as unknown as Response, payload, {
      currentVersion: 7,
    });

    const etag = first.headers.ETag;
    expect(etag).toMatch(/^".+"$/);

    const second = mockRes();
    sendCacheableJson(
      mockReq(etag),
      second as unknown as Response,
      payload,
      { currentVersion: 7 },
    );

    expect(second.statusCode).toBe(304);
    expect(second.ended).toBe(true);
    expect(second.body).toBeUndefined();
    expect(second.headers.ETag).toBe(etag);
  });

  it('changes the ETag when the payload changes', () => {
    const a = mockRes();
    const b = mockRes();
    sendCacheableJson(mockReq(), a as unknown as Response, [{ x: 1 }], {
      currentVersion: 1,
    });
    sendCacheableJson(mockReq(), b as unknown as Response, [{ x: 2 }], {
      currentVersion: 1,
    });

    expect(a.headers.ETag).not.toBe(b.headers.ETag);
  });
});
