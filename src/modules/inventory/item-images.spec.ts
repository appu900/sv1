import { buildNameIndex } from '../ingredients/ingredient-image-match';
import { ingredientImageFor, leftoverRecipeName, phraseCandidates } from './item-images';

describe('leftoverRecipeName', () => {
  it('takes the recipe title out of a leftover item', () => {
    expect(leftoverRecipeName('Herby Bread Balls (leftover)')).toBe('Herby Bread Balls');
    expect(leftoverRecipeName('Crispy Sushi Rolls (Leftovers)')).toBe('Crispy Sushi Rolls');
  });

  it('is null for ordinary items', () => {
    expect(leftoverRecipeName('Lamb rump steaks')).toBeNull();
    expect(leftoverRecipeName('(leftover)')).toBeNull();
  });
});

describe('phraseCandidates', () => {
  it('tries the whole name first, then shorter runs of words', () => {
    expect(phraseCandidates('Lamb rump steaks')).toEqual([
      'lamb rump steaks',
      'lamb rump',
      'rump steaks',
      'lamb',
      'rump',
      'steaks',
    ]);
  });

  it('skips brackets, numbers and filler words on their own', () => {
    expect(phraseCandidates('Fresh Basil (2 bunches)')).toEqual(['fresh basil', 'basil']);
  });
});

describe('ingredientImageFor', () => {
  const index = buildNameIndex([
    { id: 'lamb', name: 'Lamb' },
    { id: 'tomato', name: 'Tomato', aliases: ['Tomatoes'] },
    { id: 'bread', name: 'Bread' },
    { id: 'noimage', name: 'Rump' },
  ]);
  const images = new Map([
    ['lamb', 'https://img/lamb.png'],
    ['tomato', 'https://img/tomato.png'],
    ['bread', 'https://img/bread.png'],
  ]);

  it('matches plurals and whole names', () => {
    expect(ingredientImageFor('Cherry tomatoes', index, images)).toBe('https://img/tomato.png');
  });

  it('falls back to a shorter phrase that has a picture', () => {
    expect(ingredientImageFor('Lamb rump steaks', index, images)).toBe('https://img/lamb.png');
  });

  it('returns nothing when no ingredient fits', () => {
    expect(ingredientImageFor('Mystery sauce', index, images)).toBeUndefined();
  });
});
