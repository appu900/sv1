import { buildNameIndex } from '../ingredients/ingredient-image-match';
import { duplicateTitles, parseCsv, readManifest, resolveRow } from './tip-import';

const lookups = {
  categories: new Map([
    ['bread', 'cat-bread'],
    ['storage', 'cat-storage'],
  ]),
  sponsors: new Map([['oz harvest', 'sp-oz']]),
  ingredients: buildNameIndex([
    { id: 'ing-bread', name: 'Bread' },
    { id: 'ing-onion', name: 'Spring onion', aliases: ['Scallion'] },
    { id: 'chilli1', name: 'Chilli' },
    { id: 'chilli2', name: 'chilli' },
  ]),
  existingTips: new Map([['revive stale bread', 'tip-1']]),
  images: new Set(['bread.png']),
};

describe('kitchen tips manifest', () => {
  it('parses quoted CSV with commas, quotes and new lines', () => {
    const rows = parseCsv('﻿title,short_description\r\n"Crisp it up","Use the oven, not ""the"" bin"\n"Two\nlines",x\n\n');
    expect(rows).toEqual([
      ['title', 'short_description'],
      ['Crisp it up', 'Use the oven, not "the" bin'],
      ['Two\nlines', 'x'],
    ]);
  });

  it('reads rows by header name and splits lists', () => {
    const [row] = readManifest(
      parseCsv('Title,Categories,Keywords,Ingredients,Order\nRevive stale bread,Bread|Storage,"toast, croutons|crumbs",Bread|Scallions,3'),
    );
    expect(row).toMatchObject({
      line: 2,
      title: 'Revive stale bread',
      categories: ['Bread', 'Storage'],
      keywords: ['toast', 'croutons', 'crumbs'],
      ingredients: ['Bread', 'Scallions'],
      order: 3,
    });
  });

  it('needs title and categories columns', () => {
    expect(() => readManifest([['title'], ['x']])).toThrow('categories');
  });

  it('resolves categories, ingredients, sponsor, image and existing tips', () => {
    const [row] = readManifest(
      parseCsv('title,categories,ingredients,sponsor,image\nRevive stale bread,Bread|storage|Bread,bread|scallions,OZ Harvest,Bread.png'),
    );
    expect(resolveRow(row, lookups)).toMatchObject({
      problems: [],
      categoryIds: ['cat-bread', 'cat-storage'],
      ingredientIds: ['ing-bread', 'ing-onion'],
      sponsorId: 'sp-oz',
      existingId: 'tip-1',
    });
  });

  it('lists every problem in a row', () => {
    const [row] = readManifest(
      parseCsv('title,categories,ingredients,sponsor,image\n,Snacks,Chilli|Dragon fruit,Nobody,missing.png'),
    );
    expect(resolveRow(row, lookups).problems).toEqual([
      'missing title',
      'unknown category "Snacks"',
      'ingredient "Chilli" matches 2 records',
      'unknown ingredient "Dragon fruit"',
      'unknown sponsor "Nobody"',
      'image "missing.png" not found',
    ]);
  });

  it('spots repeated titles', () => {
    const rows = readManifest(parseCsv('title,categories\nA,Bread\na,Bread\nB,Bread'));
    expect([...duplicateTitles(rows)]).toEqual(['a']);
  });
});
