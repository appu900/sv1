/**
 * Projects the live full-list endpoints into the new summary shapes and reports
 * raw and gzipped sizes.
 *
 * The point is to verify the payload reduction against real production data
 * *before* the backend deploy, since `/api/api/recipe/summaries` and
 * `/api/ingredients/summaries` only exist once sv1 ships. It issues GETs only.
 *
 * Usage:
 *   npm run measure:summary-payloads -- --country=Australia
 *   npm run measure:summary-payloads -- --recipes=/tmp/recipes.json --ingredients=/tmp/ingredients.json
 */
import { gzipSync } from 'zlib';
import { readFileSync } from 'fs';

const DEFAULT_BASE_URL = 'https://backend.saveful.app';

interface Options {
  baseUrl: string;
  country: string;
  recipesFile?: string;
  ingredientsFile?: string;
}

function parseOptions(argv: string[]): Options {
  const get = (name: string) =>
    argv.find((arg) => arg.startsWith(`--${name}=`))?.split('=').slice(1).join('=');

  return {
    baseUrl: get('base-url') ?? DEFAULT_BASE_URL,
    country: get('country') ?? 'Australia',
    recipesFile: get('recipes'),
    ingredientsFile: get('ingredients'),
  };
}

async function load(
  file: string | undefined,
  url: string,
): Promise<{ json: unknown[]; wireBytes: number }> {
  if (file) {
    const raw = readFileSync(file, 'utf8');
    return { json: JSON.parse(raw), wireBytes: Buffer.byteLength(raw) };
  }

  const response = await fetch(url, {
    headers: { 'Accept-Encoding': 'gzip, br' },
  });
  if (!response.ok) {
    throw new Error(`${url} responded ${response.status}`);
  }
  const raw = await response.text();
  return { json: JSON.parse(raw), wireBytes: Buffer.byteLength(raw) };
}

const asId = (value: any): string => {
  if (!value) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'object') {
    if (typeof value.$oid === 'string') return value.$oid;
    if (typeof value._id === 'string') return value._id;
    if (value._id && value._id !== value) return asId(value._id);
  }
  return '';
};

/** Mirrors RecipeService.mapRecipeSummary against a full recipe document. */
function toRecipeSummary(recipe: any) {
  const variantTags = new Set<string>();
  const unsubstitutable = new Set<string>();

  for (const wrapper of recipe.components ?? []) {
    for (const tag of wrapper.variantTags ?? []) {
      if (typeof tag === 'string' && tag.trim()) variantTags.add(tag.trim());
    }
    for (const component of wrapper.component ?? []) {
      for (const required of component.requiredIngredients ?? []) {
        if ((required.alternativeIngredients ?? []).length === 0) {
          const id = asId(required.recommendedIngredient);
          if (id) unsubstitutable.add(id);
        }
      }
    }
  }

  const stickerId = asId(recipe.stickerId);
  const stickerImage =
    typeof recipe.stickerId?.imageUrl === 'string'
      ? recipe.stickerId.imageUrl
      : '';

  return {
    _id: asId(recipe._id),
    title: recipe.title ?? '',
    ...(recipe.heroImageUrl ? { heroImageUrl: recipe.heroImageUrl } : {}),
    ...(recipe.heroImage?.base ? { heroImage: recipe.heroImage } : {}),
    order: Number.isFinite(recipe.order) ? recipe.order : 0,
    frameworkCategoryIds: [
      ...new Set(
        (recipe.frameworkCategories ?? []).map(asId).filter(Boolean),
      ),
    ],
    cuisineIds: [
      ...new Set((recipe.cuisines ?? []).map(asId).filter(Boolean)),
    ],
    variantTags: [...variantTags],
    ...(stickerId && stickerImage
      ? { sticker: { id: stickerId, imageUrl: stickerImage } }
      : {}),
    unsubstitutableIngredientIds: [...unsubstitutable],
  };
}

/** Mirrors IngredientsService.getIngredientSummaries. */
function toIngredientSummaries(ingredients: any[], country: string) {
  return ingredients
    .filter((ingredient) => ingredient.hasPage === true)
    .map((ingredient) => ({
      _id: asId(ingredient._id),
      name: ingredient.name ?? '',
      ...(ingredient.heroImageUrl
        ? { heroImageUrl: ingredient.heroImageUrl }
        : {}),
      ...(ingredient.heroImage?.base ? { heroImage: ingredient.heroImage } : {}),
      ...(ingredient.theme ? { theme: ingredient.theme } : {}),
      inSeason: ingredient.inSeason ?? [],
      seasonByCountry: ingredient.seasonByCountry?.[country]
        ? { [country]: ingredient.seasonByCountry[country] }
        : {},
      order: Number.isFinite(ingredient.order) ? ingredient.order : 0,
    }))
    .sort((a, b) => a.order - b.order || a.name.localeCompare(b.name));
}

const kb = (bytes: number) => `${(bytes / 1024).toFixed(1)} KB`;

function report(
  label: string,
  beforeBytes: number,
  beforeCount: number,
  after: unknown[],
) {
  const body = Buffer.from(JSON.stringify(after));
  const gzipped = gzipSync(body, { level: 6 });

  console.log(`\n${label}`);
  console.log(`  before: ${kb(beforeBytes)} raw, ${beforeCount} records`);
  console.log(
    `  after:  ${kb(body.length)} raw, ${kb(gzipped.length)} gzipped, ${after.length} records`,
  );
  console.log(
    `  reduction: ${(beforeBytes / body.length).toFixed(1)}x raw, ` +
      `${(beforeBytes / gzipped.length).toFixed(0)}x on the wire`,
  );
}

async function main() {
  const options = parseOptions(process.argv.slice(2));
  const query = `?country=${encodeURIComponent(options.country)}`;

  const recipes = await load(
    options.recipesFile,
    `${options.baseUrl}/api/api/recipe${query}`,
  );
  report(
    'Make page — /api/api/recipe/summaries',
    recipes.wireBytes,
    recipes.json.length,
    recipes.json.map(toRecipeSummary),
  );

  const ingredients = await load(
    options.ingredientsFile,
    `${options.baseUrl}/api/ingredients${query}`,
  );
  report(
    'Feed carousel — /api/ingredients/summaries',
    ingredients.wireBytes,
    ingredients.json.length,
    toIngredientSummaries(ingredients.json as any[], options.country),
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
