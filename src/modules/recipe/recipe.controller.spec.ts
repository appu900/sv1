import { Request, Response } from 'express';
import { RecipeController } from './recipe.controller';

function createResponse() {
  const headers: Record<string, string> = {};
  const res = {
    headers,
    statusCode: 200,
    body: undefined as unknown,
    setHeader: jest.fn((name: string, value: string) => {
      headers[name] = value;
    }),
    vary: jest.fn(() => res),
    status: jest.fn((code: number) => {
      res.statusCode = code;
      return res;
    }),
    end: jest.fn(() => res),
    send: jest.fn((body: unknown) => {
      res.body = body;
      return res;
    }),
  };
  return res;
}

function createController(overrides: Record<string, any> = {}) {
  const recipeService = {
    findAll: jest.fn().mockResolvedValue([{ full: true }]),
    findSummaries: jest.fn().mockResolvedValue([{ _id: 'recipe-1' }]),
    ...overrides.recipeService,
  };
  const dataVersionService = {
    getVersion: jest.fn().mockResolvedValue(7),
    ...overrides.dataVersionService,
  };
  const controller = new RecipeController(
    recipeService as never,
    {} as never,
    dataVersionService as never,
  );
  return { controller, recipeService, dataVersionService };
}

describe('RecipeController', () => {
  it('routes summary requests without changing the full list endpoint', async () => {
    const { controller, recipeService } = createController();
    const res = createResponse();

    await controller.findSummaries(
      { headers: {} } as Request,
      res as unknown as Response,
      'AU',
    );

    expect(res.body).toBe(JSON.stringify([{ _id: 'recipe-1' }]));
    await expect(controller.findAll('AU')).resolves.toEqual([{ full: true }]);
    expect(recipeService.findSummaries).toHaveBeenCalledWith('AU');
    expect(recipeService.findAll).toHaveBeenCalledWith('AU');
  });

  it('marks a version-pinned summary response immutable', async () => {
    const { controller } = createController();
    const res = createResponse();

    await controller.findSummaries(
      { headers: {} } as Request,
      res as unknown as Response,
      'AU',
      '7',
    );

    expect(res.headers['Cache-Control']).toBe(
      'public, max-age=31536000, immutable',
    );
    expect(res.headers['X-Data-Version']).toBe('7');
  });

  it('falls back to revalidation when the client pins a stale version', async () => {
    const { controller } = createController();
    const res = createResponse();

    await controller.findSummaries(
      { headers: {} } as Request,
      res as unknown as Response,
      'AU',
      '6',
    );

    expect(res.headers['Cache-Control']).toBe(
      'public, max-age=0, must-revalidate',
    );
  });

  it('answers a matching If-None-Match with 304 and no body', async () => {
    const { controller } = createController();
    const first = createResponse();
    await controller.findSummaries(
      { headers: {} } as Request,
      first as unknown as Response,
      'AU',
    );
    const etag = first.headers.ETag;

    const second = createResponse();
    await controller.findSummaries(
      { headers: { 'if-none-match': etag } } as unknown as Request,
      second as unknown as Response,
      'AU',
    );

    expect(second.statusCode).toBe(304);
    expect(second.send).not.toHaveBeenCalled();
  });
});
