import { Types } from 'mongoose';
import { MAX_EXCLUDED_INGREDIENTS, parseExcludeIds, withoutExcluded } from './suggestion-filters';

const a = '65a1b2c3d4e5f60718293a4b';
const b = '65A1B2C3D4E5F60718293A4C';

describe('suggestion filters', () => {
  it('reads a comma list, drops bad ids, de-duplicates and sorts', () => {
    expect(parseExcludeIds(` ${b},nope,${a},${a},,123`)).toEqual([a, b.toLowerCase()]);
    expect(parseExcludeIds([a, `${b}`])).toEqual([a, b.toLowerCase()]);
    expect(parseExcludeIds(undefined)).toEqual([]);
  });

  it('keeps at most 50 ids', () => {
    const many = Array.from({ length: 60 }, () => new Types.ObjectId().toString()).join(',');
    expect(parseExcludeIds(many)).toHaveLength(MAX_EXCLUDED_INGREDIENTS);
  });

  it('removes kitchen items whose ingredient is excluded', () => {
    const items = [
      { name: 'Avocado', ingredientId: new Types.ObjectId(a) },
      { name: 'Apple', ingredientId: new Types.ObjectId(b) },
      { name: 'Note', ingredientId: undefined },
    ];
    expect(withoutExcluded(items, [a]).map(i => i.name)).toEqual(['Apple', 'Note']);
    expect(withoutExcluded(items, [])).toBe(items);
  });
});
