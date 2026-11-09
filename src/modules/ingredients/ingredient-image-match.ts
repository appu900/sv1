/**
 * Matches design-folder image file names ("Almonds flaked.png",
 * "Alma (Indian gooseberries) (2).png") to ingredient records by name or
 * alias. Plain functions, used by scripts/import-ingredient-images.ts.
 */

export interface MatchableIngredient {
  id: string;
  name: string;
  aliases?: string[];
}

export type ImageMatch =
  | { status: 'matched'; id: string; via: string }
  | { status: 'ambiguous'; ids: string[]; via: string }
  | { status: 'unmatched' };

export function normaliseName(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9()\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function singular(word: string): string {
  if (word.endsWith('ies') && word.length > 4) return `${word.slice(0, -3)}y`;
  if (/(ches|shes|xes|ses|oes)$/.test(word)) return word.slice(0, -2);
  if (word.endsWith('s') && !word.endsWith('ss') && word.length > 3) return word.slice(0, -1);
  return word;
}

/** The name with every word made singular, then sorted, so word order and plurals don't matter. */
function looseKey(value: string): string {
  return value
    .split(' ')
    .filter(Boolean)
    .map(singular)
    .sort()
    .join(' ');
}

/** Names to try for a file, best first: exact, without "(2)", inside and outside brackets. */
export function candidateNames(fileName: string): string[] {
  return nameCandidates(fileName.replace(/\.[a-z0-9]+$/i, ''));
}

/** Same as candidateNames for a plain name (no file extension to strip). */
export function nameCandidates(base: string): string[] {
  const withoutCopy = base.replace(/\s*\(\d+\)\s*$/, '');
  const names = [base, withoutCopy];
  const bracket = withoutCopy.match(/^(.*?)\s*\(([^)]+)\)\s*(.*)$/);
  if (bracket) {
    const outside = `${bracket[1]} ${bracket[3]}`.trim();
    if (outside) names.push(outside);
    names.push(bracket[2]);
  }
  const out: string[] = [];
  for (const n of names.map(normaliseName).map(n => n.replace(/[()]/g, ' ').replace(/\s+/g, ' ').trim())) {
    if (n && !out.includes(n)) out.push(n);
  }
  return out;
}

export interface IngredientNameIndex {
  exact: Map<string, Set<string>>;
  loose: Map<string, Set<string>>;
}

export function buildNameIndex(ingredients: readonly MatchableIngredient[]): IngredientNameIndex {
  const exact = new Map<string, Set<string>>();
  const loose = new Map<string, Set<string>>();
  const add = (map: Map<string, Set<string>>, key: string, id: string) => {
    if (!key) return;
    const set = map.get(key) ?? new Set<string>();
    set.add(id);
    map.set(key, set);
  };
  for (const ing of ingredients) {
    for (const name of [ing.name, ...(ing.aliases ?? [])]) {
      const n = normaliseName(name ?? '').replace(/[()]/g, ' ').replace(/\s+/g, ' ').trim();
      add(exact, n, ing.id);
      add(loose, looseKey(n), ing.id);
    }
  }
  return { exact, loose };
}

/** Exact name or alias first, then ignoring plurals and word order. */
export function matchImageFile(fileName: string, index: IngredientNameIndex): ImageMatch {
  return matchCandidates(candidateNames(fileName), index);
}

/** Matches a typed ingredient name ("Stale bread", "Spring onions") the same way. */
export function matchIngredientName(name: string, index: IngredientNameIndex): ImageMatch {
  return matchCandidates(nameCandidates(name), index);
}

function matchCandidates(candidates: string[], index: IngredientNameIndex): ImageMatch {
  for (const name of candidates) {
    const ids = index.exact.get(name);
    if (ids?.size === 1) return { status: 'matched', id: [...ids][0], via: name };
    if (ids && ids.size > 1) return { status: 'ambiguous', ids: [...ids], via: name };
  }
  for (const name of candidates) {
    const ids = index.loose.get(looseKey(name));
    if (ids?.size === 1) return { status: 'matched', id: [...ids][0], via: `~${name}` };
    if (ids && ids.size > 1) return { status: 'ambiguous', ids: [...ids], via: `~${name}` };
  }
  return { status: 'unmatched' };
}

/** "(2)" copies lose to the plain file for the same ingredient. */
export function isNumberedCopy(fileName: string): boolean {
  return /\(\d+\)\.[a-z0-9]+$/i.test(fileName.trim());
}
