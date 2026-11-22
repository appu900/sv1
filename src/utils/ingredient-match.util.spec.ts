import { collapseIngredientGroups, ingredientMatchKey } from './ingredient-match.util';

describe('ingredientMatchKey', () => {
  it('matches singular/plural, case, accents and spacing', () => {
    expect(ingredientMatchKey('Brown onion')).toBe(ingredientMatchKey('brown onions'));
    expect(ingredientMatchKey('Tomato')).toBe(ingredientMatchKey('Tomatoes'));
    expect(ingredientMatchKey('Green chillies')).toBe(ingredientMatchKey('Green chilli'));
    expect(ingredientMatchKey('Corn flour')).toBe(ingredientMatchKey('Cornflour'));
    expect(ingredientMatchKey('Jalapeño')).toBe(ingredientMatchKey('jalapeno'));
  });

  it('keeps words that only look plural', () => {
    expect(ingredientMatchKey('Asparagus')).toBe('asparagus');
    expect(ingredientMatchKey('Hummus')).toBe('hummus');
    expect(ingredientMatchKey('Peas')).not.toBe(ingredientMatchKey('Pear'));
  });
});

describe('collapseIngredientGroups', () => {
  const rows = [
    { _id: 'tomato', name: 'Tomato', aliases: [] as string[] },
    { _id: 'tomatoes', name: 'Tomatoes', aliases: ['Tomatos'], primaryIngredientId: 'tomato' },
    { _id: 'onion', name: 'Onion', aliases: [] as string[] },
  ];

  it('shows each group once with the variant names as aliases', () => {
    const result = collapseIngredientGroups(rows);
    expect(result.map((row) => row._id)).toEqual(['tomato', 'onion']);
    expect(result[0]).toMatchObject({
      aliases: ['Tomatoes', 'Tomatos'],
      groupIngredientIds: ['tomato', 'tomatoes'],
    });
  });

  it('keeps a variant whose main ingredient is not in the list', () => {
    const result = collapseIngredientGroups(rows.slice(1));
    expect(result.map((row) => row._id)).toEqual(['tomatoes', 'onion']);
  });

  it('returns the same array when nothing is grouped', () => {
    const plain = [rows[0], rows[2]];
    expect(collapseIngredientGroups(plain)).toBe(plain);
  });

  it('reads populated or ObjectId-like references', () => {
    const result = collapseIngredientGroups([
      { _id: { toString: () => 'a' }, name: 'Lime' },
      { _id: { toString: () => 'b' }, name: 'Limes', primaryIngredientId: { _id: 'a' } },
    ]);
    expect(result).toHaveLength(1);
  });
});
