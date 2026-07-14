import { RecipeController } from './recipe.controller';

describe('RecipeController', () => {
  it('routes summary requests without changing the full list endpoint', async () => {
    const recipeService = {
      findAll: jest.fn().mockResolvedValue([{ full: true }]),
      findSummaries: jest.fn().mockResolvedValue([{ _id: 'recipe-1' }]),
    };
    const controller = new RecipeController(
      recipeService as never,
      {} as never,
    );

    await expect(controller.findSummaries('AU')).resolves.toEqual([
      { _id: 'recipe-1' },
    ]);
    await expect(controller.findAll('AU')).resolves.toEqual([
      { full: true },
    ]);
    expect(recipeService.findSummaries).toHaveBeenCalledWith('AU');
    expect(recipeService.findAll).toHaveBeenCalledWith('AU');
  });
});
