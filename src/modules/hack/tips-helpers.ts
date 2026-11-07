/**
 * Plain helpers for Kitchen Tips (stored as "hacks"): list fields from admin
 * forms, category order, and search scoring. No database access.
 */

const OBJECT_ID_RE = /^[a-f0-9]{24}$/i;

function toList(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return [];
    if (trimmed.startsWith('[')) {
      try {
        const parsed = JSON.parse(trimmed);
        return Array.isArray(parsed) ? parsed : [parsed];
      } catch {
        return [];
      }
    }
    return trimmed.split(',');
  }
  return [];
}

/** ObjectId strings from an array, a JSON array string or "a,b,c" (multipart forms send strings). */
export function parseIdList(value: unknown): string[] {
  const out: string[] = [];
  for (const item of toList(value)) {
    const id = String(item ?? '').trim();
    if (OBJECT_ID_RE.test(id) && !out.includes(id)) out.push(id);
  }
  return out;
}

/** Keywords: trimmed, deduplicated ignoring case, at most 30 of up to 40 characters. */
export function parseKeywordList(value: unknown): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const item of toList(value)) {
    const word = String(item ?? '').trim().slice(0, 40);
    const key = word.toLowerCase();
    if (!word || seen.has(key)) continue;
    seen.add(key);
    out.push(word);
    if (out.length >= 30) break;
  }
  return out;
}

/** All categories for a tip, with the primary (legacy categoryId) first. */
export function resolveCategoryIds(primary: string | undefined, list: string[]): string[] {
  const ids = primary && OBJECT_ID_RE.test(primary) ? [primary, ...list] : [...list];
  return ids.filter((id, i) => ids.indexOf(id) === i);
}

export function normaliseSearchText(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export interface SearchableTip {
  title: string;
  shortDescription?: string;
  keywords?: string[];
}

/**
 * How well a tip matches a query (0 = no match). Every word of the query
 * must appear in the title, description, keywords, category names or
 * ingredient names; the title counts most.
 */
export function scoreTip(
  tip: SearchableTip,
  query: string,
  categoryNames: string[] = [],
  ingredientNames: string[] = [],
): number {
  const words = normaliseSearchText(query).split(' ').filter(Boolean);
  if (words.length === 0) return 0;
  const title = normaliseSearchText(tip.title ?? '');
  const description = normaliseSearchText(tip.shortDescription ?? '');
  const keywords = (tip.keywords ?? []).map(normaliseSearchText);
  const categories = categoryNames.map(normaliseSearchText);
  const ingredients = ingredientNames.map(normaliseSearchText);

  let score = 0;
  for (const word of words) {
    let best = 0;
    if (title.startsWith(word)) best = Math.max(best, 5);
    if (title.split(' ').some(w => w.startsWith(word))) best = Math.max(best, 4);
    if (keywords.some(k => k.startsWith(word) || k.split(' ').some(w => w.startsWith(word)))) best = Math.max(best, 3);
    if (ingredients.some(n => n.split(' ').some(w => w.startsWith(word)))) best = Math.max(best, 3);
    if (categories.some(n => n.split(' ').some(w => w.startsWith(word)))) best = Math.max(best, 2);
    if (description.split(' ').some(w => w.startsWith(word))) best = Math.max(best, 1);
    if (best === 0) return 0;
    score += best;
  }
  return score;
}
