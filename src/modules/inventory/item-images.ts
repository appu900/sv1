import {
  IngredientNameIndex,
  matchIngredientName,
  normaliseName,
} from '../ingredients/ingredient-image-match';

/**
 * Pictures for My Kitchen items that aren't linked to an ingredient (receipt
 * scans, voice, typed names, leftovers). Plain functions so they can be tested.
 */

/** "Herby Bread Balls (leftover)" -> "Herby Bread Balls"; null when it isn't a leftover. */
export function leftoverRecipeName(name: string): string | null {
  const match = name.match(/^(.*?)\s*\(\s*leftovers?\s*\)\s*$/i);
  const title = match?.[1]?.trim();
  return title ? title : null;
}

/** Words that say nothing about what the food is, so never match on their own. */
const FILLER = new Set([
  'fresh', 'large', 'small', 'medium', 'big', 'mini', 'sliced', 'chopped', 'diced', 'grated',
  'leftover', 'leftovers', 'organic', 'frozen', 'pack', 'packet', 'bag', 'box', 'tin', 'can',
  'jar', 'bottle', 'cooked', 'raw', 'whole', 'mixed', 'free', 'range', 'lite', 'light', 'low',
  'fat', 'with', 'and', 'the', 'of', 'in', 'style', 'home', 'made', 'homemade', 'spicy', 'easy',
  'quick', 'best', 'ultimate', 'classic', 'level', 'up', 'excellent', 'crunchy', 'crispy', 'herby',
]);

/**
 * Phrases to try for a name, best first: the whole name, then shorter runs of
 * words, longest first ("lamb rump steaks" -> "lamb rump", "rump steaks",
 * "lamb", "rump", "steaks"). Single filler words are skipped.
 */
export function phraseCandidates(name: string): string[] {
  const words = normaliseName(name.replace(/\([^)]*\)/g, ' '))
    .replace(/[()]/g, ' ')
    .split(' ')
    .filter(w => w && !/^\d/.test(w));
  const out: string[] = [];
  for (let size = words.length; size >= 1; size--) {
    for (let start = 0; start + size <= words.length; start++) {
      const run = words.slice(start, start + size);
      if (size === 1 && (FILLER.has(run[0]) || run[0].length < 3)) continue;
      if (run.every(w => FILLER.has(w))) continue;
      const phrase = run.join(' ');
      if (!out.includes(phrase)) out.push(phrase);
    }
  }
  return out;
}

/** The picture of the best-matching ingredient that has one, if any. */
export function ingredientImageFor(
  name: string,
  index: IngredientNameIndex,
  imageById: ReadonlyMap<string, string>,
): string | undefined {
  for (const phrase of phraseCandidates(name)) {
    const match = matchIngredientName(phrase, index);
    if (match.status === 'matched') {
      const url = imageById.get(match.id);
      if (url) return url;
    } else if (match.status === 'ambiguous') {
      const url = match.ids.map(id => imageById.get(id)).find(Boolean);
      if (url) return url;
    }
  }
  return undefined;
}
