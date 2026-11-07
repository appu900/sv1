import {
  normaliseSearchText,
  parseIdList,
  parseKeywordList,
  resolveCategoryIds,
  scoreTip,
} from './tips-helpers';

const A = 'a'.repeat(24);
const B = 'b'.repeat(24);

describe('tips helpers', () => {
  it('parses id lists from forms', () => {
    expect(parseIdList([A, B, A])).toEqual([A, B]);
    expect(parseIdList(JSON.stringify([A, 'bad']))).toEqual([A]);
    expect(parseIdList(`${A}, ${B}`)).toEqual([A, B]);
    expect(parseIdList(undefined)).toEqual([]);
    expect(parseIdList('[not json')).toEqual([]);
  });

  it('cleans keywords', () => {
    expect(parseKeywordList('Bread, crackers ,bread,')).toEqual(['Bread', 'crackers']);
    expect(parseKeywordList(Array.from({ length: 40 }, (_, i) => `k${i}`))).toHaveLength(30);
  });

  it('puts the primary category first without duplicates', () => {
    expect(resolveCategoryIds(A, [B, A])).toEqual([A, B]);
    expect(resolveCategoryIds(undefined, [B])).toEqual([B]);
    expect(resolveCategoryIds('nope', [B])).toEqual([B]);
  });

  it('normalises accents and punctuation', () => {
    expect(normaliseSearchText('  Crème-Brûlée! ')).toBe('creme brulee');
  });

  it('scores title, keyword, ingredient and category matches', () => {
    const tip = { title: 'Going crackers', shortDescription: 'Turn old bread into snacks', keywords: ['stale bread'] };
    expect(scoreTip(tip, 'going')).toBe(5);
    expect(scoreTip(tip, 'crack')).toBe(4);
    expect(scoreTip(tip, 'stale')).toBe(3);
    expect(scoreTip(tip, 'pita', [], ['Pita bread'])).toBe(3);
    expect(scoreTip(tip, 'diy', ['DIY, jams, pickles'])).toBe(2);
    expect(scoreTip(tip, 'snacks')).toBe(1);
  });

  it('requires every word to match', () => {
    const tip = { title: 'Going crackers' };
    expect(scoreTip(tip, 'going crackers')).toBe(9);
    expect(scoreTip(tip, 'going jam')).toBe(0);
    expect(scoreTip(tip, '')).toBe(0);
  });
});
