/**
 * "What can I cook?" lets people remove kitchen ingredients from the match
 * (design page 10). These helpers read the comma list from the query and
 * drop those ingredients before recipes are matched.
 */
import { Types } from 'mongoose';

export const MAX_EXCLUDED_INGREDIENTS = 50;

/** Valid, unique ObjectId strings from "a,b,c" (or an array), sorted, at most 50. */
export function parseExcludeIds(value: unknown): string[] {
  const parts = Array.isArray(value)
    ? value.flatMap(v => String(v).split(','))
    : typeof value === 'string'
      ? value.split(',')
      : [];
  const ids = new Set<string>();
  for (const part of parts) {
    const id = part.trim();
    if (id && Types.ObjectId.isValid(id) && /^[a-f0-9]{24}$/i.test(id)) ids.add(id.toLowerCase());
    if (ids.size >= MAX_EXCLUDED_INGREDIENTS) break;
  }
  return [...ids].sort();
}

/** Kitchen items whose ingredient is not in the excluded list. */
export function withoutExcluded<T extends { ingredientId?: unknown }>(items: T[], excluded: readonly string[]): T[] {
  if (excluded.length === 0) return items;
  const skip = new Set(excluded);
  return items.filter(item => {
    const id = item.ingredientId ? String(item.ingredientId).toLowerCase() : '';
    return !skip.has(id);
  });
}
