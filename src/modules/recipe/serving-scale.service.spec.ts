import { ServingScaleService } from './serving-scale.service';

describe('ServingScaleService', () => {
  let service: ServingScaleService;

  beforeEach(() => {
    process.env.OPENAI_API_KEY = 'test-key';

    service = new ServingScaleService(
      {
        get: jest.fn(),
        set: jest.fn(),
      } as any,
      {
        findOne: jest.fn(),
        create: jest.fn(),
      } as any,
    );
  });

  it('builds different cache keys for different recipe ids', () => {
    const firstKey = (service as any).buildCacheKey({
      recipeId: 'recipe-a',
      recipeTitle: 'Soup',
      originalServings: 2,
      desiredServings: 4,
      ingredients: [
        {
          ingredientId: 'onion',
          ingredientName: 'Onion',
          originalQuantity: '1 whole',
          preparation: 'diced',
        },
      ],
    });

    const secondKey = (service as any).buildCacheKey({
      recipeId: 'recipe-b',
      recipeTitle: 'Soup',
      originalServings: 2,
      desiredServings: 4,
      ingredients: [
        {
          ingredientId: 'onion',
          ingredientName: 'Onion',
          originalQuantity: '1 whole',
          preparation: 'diced',
        },
      ],
    });

    expect(firstKey).not.toEqual(secondKey);
  });

  it('builds different cache keys for different ingredient preparations', () => {
    const dicedKey = (service as any).buildCacheKey({
      recipeId: 'recipe-a',
      recipeTitle: 'Soup',
      originalServings: 2,
      desiredServings: 4,
      ingredients: [
        {
          ingredientId: 'onion',
          ingredientName: 'Onion',
          originalQuantity: '1 whole',
          preparation: 'diced',
        },
      ],
    });

    const slicedKey = (service as any).buildCacheKey({
      recipeId: 'recipe-a',
      recipeTitle: 'Soup',
      originalServings: 2,
      desiredServings: 4,
      ingredients: [
        {
          ingredientId: 'onion',
          ingredientName: 'Onion',
          originalQuantity: '1 whole',
          preparation: 'sliced',
        },
      ],
    });

    expect(dicedKey).not.toEqual(slicedKey);
  });

  it('returns the original quantities when servings are unchanged', async () => {
    await expect(
      service.scaleServings({
        recipeId: 'recipe-a',
        recipeTitle: 'Soup',
        originalServings: 4,
        desiredServings: 4,
        ingredients: [
          {
            ingredientId: 'onion',
            ingredientName: 'Onion',
            originalQuantity: '1 whole',
            preparation: 'diced',
          },
        ],
      }),
    ).resolves.toEqual({
      originalServings: 4,
      desiredServings: 4,
      scaledIngredients: [
        {
          ingredientId: 'onion',
          ingredientName: 'Onion',
          originalQuantity: '1 whole',
          scaledQuantity: '1 whole',
          preparation: 'diced',
        },
      ],
    });
  });
});