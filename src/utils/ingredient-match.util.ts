/**
 * Ingredient duplicate keys and group folding.
 *
 * Two names are the same ingredient when they only differ by case, accents,
 * punctuation, spacing or singular/plural ("Brown onion" = "brown onions").
 * Keep `ingredientMatchKey` identical to saveful-india-web/lib/ingredientMatching.ts.
 */

const KEEP_TRAILING_S = /(ss|us|is)$/;

export function singularizeToken(token: string): string {
  let word = token;
  if (word.length > 3) {
    if (word.endsWith('ies') && word.length > 4) word = `${word.slice(0, -3)}y`;
    else if (word.endsWith('oes')) word = word.slice(0, -2);
    else if (/(ches|shes|xes|sses)$/.test(word)) word = word.slice(0, -2);
    else if (word.endsWith('s') && !KEEP_TRAILING_S.test(word)) word = word.slice(0, -1);
  }
  if (word.length > 3) {
    if (word.endsWith('ie')) word = `${word.slice(0, -2)}y`;
    else if (word.endsWith('i')) word = `${word.slice(0, -1)}y`;
  }
  return word;
}

export function ingredientMatchKey(name: string): string {
  return String(name || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/&/g, ' and ')
    .split(/[^a-z0-9]+/)
    .filter(Boolean)
    .map(singularizeToken)
    .join('');
}

type GroupableIngredient = {
  _id: unknown;
  name?: unknown;
  aliases?: unknown;
  primaryIngredientId?: unknown;
};

const idOf = (value: unknown): string => {
  if (!value) return '';
  if (typeof value === 'object' && value !== null && '_id' in value) {
    return String((value as { _id: unknown })._id);
  }
  return String(value);
};

/**
 * One row per ingredient group, for search lists. A variant is dropped when its
 * main ingredient is in the same list; its name (and aliases) are added to the
 * main ingredient's `aliases`, and `groupIngredientIds` lists every member.
 * A variant whose main ingredient is not in the list (e.g. another country)
 * stays, so nothing disappears for that audience.
 */
export function collapseIngredientGroups<T extends GroupableIngredient>(rows: T[]): T[] {
  const ids = new Set(rows.map((row) => idOf(row._id)));
  const variantsByPrimary = new Map<string, T[]>();

  for (const row of rows) {
    const primaryId = idOf(row.primaryIngredientId);
    if (!primaryId || primaryId === idOf(row._id) || !ids.has(primaryId)) continue;
    const list = variantsByPrimary.get(primaryId) || [];
    list.push(row);
    variantsByPrimary.set(primaryId, list);
  }
  if (variantsByPrimary.size === 0) return rows;

  const result: T[] = [];
  for (const row of rows) {
    const id = idOf(row._id);
    const primaryId = idOf(row.primaryIngredientId);
    if (primaryId && primaryId !== id && ids.has(primaryId)) continue;

    const variants = variantsByPrimary.get(id);
    if (!variants) {
      result.push(row);
      continue;
    }

    const ownName = String(row.name || '');
    const aliases = new Set<string>(Array.isArray(row.aliases) ? row.aliases.map(String) : []);
    for (const variant of variants) {
      const variantName = String(variant.name || '').trim();
      if (variantName && variantName !== ownName) aliases.add(variantName);
      if (Array.isArray(variant.aliases)) variant.aliases.forEach((alias) => aliases.add(String(alias)));
    }
    aliases.delete(ownName);

    result.push({
      ...row,
      aliases: Array.from(aliases),
      groupIngredientIds: [id, ...variants.map((variant) => idOf(variant._id))],
    });
  }
  return result;
}
