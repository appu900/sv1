/**
 * Plain helpers for scripts/import-kitchen-tips.ts: reads the tips manifest
 * (CSV) and checks each row against categories, ingredients and sponsors.
 *
 * Manifest columns (header row required, any order, case-insensitive):
 *   title              required
 *   short_description  optional
 *   categories         required; names separated by "|", the first is the main one
 *   keywords           optional; separated by "|" or ","
 *   ingredients        optional; names separated by "|"
 *   image              optional; file name inside the images folder
 *   sponsor            optional; sponsor title as shown in the admin panel
 *   order              optional; whole number, lower shows first
 */
import {
  IngredientNameIndex,
  matchIngredientName,
} from '../ingredients/ingredient-image-match';

export const MANIFEST_COLUMNS = [
  'title',
  'short_description',
  'categories',
  'keywords',
  'ingredients',
  'image',
  'sponsor',
  'order',
] as const;

/** RFC 4180-style CSV: quoted fields, doubled quotes, newlines inside quotes. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  const src = text.replace(/^﻿/, '');
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"' && src[i + 1] === '"') {
        field += '"';
        i++;
      } else if (ch === '"') {
        quoted = false;
      } else {
        field += ch;
      }
    } else if (ch === '"') {
      quoted = true;
    } else if (ch === ',') {
      row.push(field);
      field = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && src[i + 1] === '\n') i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else {
      field += ch;
    }
  }
  if (field !== '' || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter(r => r.some(cell => cell.trim() !== ''));
}

export interface ManifestRow {
  line: number;
  title: string;
  shortDescription?: string;
  categories: string[];
  keywords: string[];
  ingredients: string[];
  image?: string;
  sponsor?: string;
  order?: number;
}

const splitList = (value: string | undefined, separators: RegExp) =>
  (value ?? '')
    .split(separators)
    .map(v => v.trim())
    .filter(Boolean);

/** Turns CSV rows into manifest rows. Throws when a required column is missing. */
export function readManifest(rows: string[][]): ManifestRow[] {
  if (rows.length === 0) return [];
  const header = rows[0].map(h => h.trim().toLowerCase().replace(/\s+/g, '_'));
  for (const required of ['title', 'categories']) {
    if (!header.includes(required)) throw new Error(`Manifest needs a "${required}" column`);
  }
  const col = (row: string[], name: string) => {
    const i = header.indexOf(name);
    return i === -1 ? undefined : row[i]?.trim() || undefined;
  };
  return rows.slice(1).map((row, i) => {
    const order = col(row, 'order');
    return {
      line: i + 2,
      title: col(row, 'title') ?? '',
      shortDescription: col(row, 'short_description'),
      categories: splitList(col(row, 'categories'), /\|/),
      keywords: splitList(col(row, 'keywords'), /[|,]/),
      ingredients: splitList(col(row, 'ingredients'), /\|/),
      image: col(row, 'image'),
      sponsor: col(row, 'sponsor'),
      order: order !== undefined && /^-?\d+$/.test(order) ? Number(order) : undefined,
    };
  });
}

export interface ImportLookups {
  /** Lower-cased category name → id. */
  categories: Map<string, string>;
  /** Lower-cased sponsor title → id. */
  sponsors: Map<string, string>;
  ingredients: IngredientNameIndex;
  /** Lower-cased tip title → id, for tips already in the database. */
  existingTips: Map<string, string>;
  /** Lower-cased image file names available in the images folder. */
  images: Set<string>;
}

export interface ResolvedRow {
  row: ManifestRow;
  problems: string[];
  categoryIds: string[];
  ingredientIds: string[];
  sponsorId?: string;
  existingId?: string;
}

/** Checks one row; `problems` is empty when it can be imported. */
export function resolveRow(row: ManifestRow, lookups: ImportLookups): ResolvedRow {
  const problems: string[] = [];
  if (!row.title) problems.push('missing title');
  if (row.categories.length === 0) problems.push('no category');

  const categoryIds: string[] = [];
  for (const name of row.categories) {
    const id = lookups.categories.get(name.toLowerCase());
    if (!id) problems.push(`unknown category "${name}"`);
    else if (!categoryIds.includes(id)) categoryIds.push(id);
  }

  const ingredientIds: string[] = [];
  for (const name of row.ingredients) {
    const match = matchIngredientName(name, lookups.ingredients);
    if (match.status === 'matched') {
      if (!ingredientIds.includes(match.id)) ingredientIds.push(match.id);
    } else if (match.status === 'ambiguous') {
      problems.push(`ingredient "${name}" matches ${match.ids.length} records`);
    } else {
      problems.push(`unknown ingredient "${name}"`);
    }
  }

  let sponsorId: string | undefined;
  if (row.sponsor) {
    sponsorId = lookups.sponsors.get(row.sponsor.toLowerCase());
    if (!sponsorId) problems.push(`unknown sponsor "${row.sponsor}"`);
  }

  if (row.image && !lookups.images.has(row.image.toLowerCase())) {
    problems.push(`image "${row.image}" not found`);
  }

  return {
    row,
    problems,
    categoryIds,
    ingredientIds,
    sponsorId,
    existingId: row.title ? lookups.existingTips.get(row.title.toLowerCase()) : undefined,
  };
}

/** Rows whose title appears more than once in the manifest. */
export function duplicateTitles(rows: ManifestRow[]): Set<string> {
  const seen = new Set<string>();
  const dupes = new Set<string>();
  for (const r of rows) {
    const key = r.title.toLowerCase();
    if (!key) continue;
    if (seen.has(key)) dupes.add(key);
    seen.add(key);
  }
  return dupes;
}
