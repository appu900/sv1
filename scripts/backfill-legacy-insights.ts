import * as crypto from 'crypto';
import * as dotenv from 'dotenv';
import * as fs from 'fs';
import * as path from 'path';
import * as mongoose from 'mongoose';
import { Types } from 'mongoose';
import { Recipe, RecipeSchema } from '../src/database/schemas/recipe.schema';
import {
  Ingredient,
  IngredientSchema,
} from '../src/database/schemas/ingredient.schema';
import {
  FoodSavedEventLog,
  FoodSavedEventLogSchema,
} from '../src/database/schemas/food-saved-event-log.schema';
import {
  IngredientSearchEvent,
  IngredientSearchEventSchema,
} from '../src/database/schemas/ingredient-search-event.schema';
import {
  RecipeView,
  RecipeViewSchema,
  RecipeViewSource,
} from '../src/database/schemas/recipe-view.schema';

dotenv.config({ path: path.resolve(__dirname, '../.env') });

const DEFAULT_INGREDIENTS_CSV =
  "/Users/aniket/Downloads/Most Ingredient Interactions_Insights_2023-11-01_to_2026-05-30.csv";
const DEFAULT_OPENED_CSV =
  '/Users/aniket/Downloads/Most Opened Frameworks_Insights_2023-11-01_to_2026-05-30.csv';
const DEFAULT_MADE_CSV =
  "/Users/aniket/Downloads/Most 'Made' Frameworks (pressed Make it)_Insights_2023-11-01_to_2026-05-30.csv";

const IMPORT_KEY = 'legacy-insights-2023-11-01-to-2026-05-30';
const LEGACY_USER_ID = new Types.ObjectId('000000000000000000000001');
const DEFAULT_EVENT_DATE = '2026-05-29T00:00:00.000Z';
const BULK_BATCH_SIZE = 1000;
const MANUAL_INGREDIENT_ALIASES_BY_NAME: Record<string, string[]> = {
  'Baby spinach (Palak)': ['Baby spinach'],
  'Mozzarella cheese': ['Mozzarella'],
  'Orange carrot': ['Carrot', 'Carrots'],
  'Potato (Aloo)': ['Potato', 'Potatoes'],
  'Red chillies': ['Long red chilli', 'Long red chillies', 'Red chilli'],
  'Refined / Plain Flour (Maida)': ['Plain flour'],
  'Spring onions': ['Spring onion'],
  'Table salt': ['Salt'],
};

type CsvKind = 'ingredient_interaction' | 'framework_open' | 'framework_made';

type CsvEntry = {
  label: string;
  count: number;
  lineNumber: number;
};

type IndexedDoc = {
  id: Types.ObjectId;
  label: string;
  isActive?: boolean;
};

type ResolvedEntry = CsvEntry & {
  targetId: Types.ObjectId;
  targetLabel: string;
};

type ResolutionResult = {
  resolved: ResolvedEntry[];
  unmatched: CsvEntry[];
  ambiguous: Array<CsvEntry & { candidates: string[] }>;
};

type Args = {
  apply: boolean;
  ingredientsCsv: string;
  openedCsv: string;
  madeCsv: string;
  eventDate: Date;
};

function parseArgs(): Args {
  const args = process.argv.slice(2);
  const getValue = (name: string, fallback: string) => {
    const prefix = `--${name}=`;
    const found = args.find((arg) => arg.startsWith(prefix));
    return found ? found.slice(prefix.length) : fallback;
  };

  const eventDateRaw = getValue('event-date', DEFAULT_EVENT_DATE);
  const eventDate = new Date(eventDateRaw);
  if (Number.isNaN(eventDate.getTime())) {
    throw new Error(`Invalid --event-date value: ${eventDateRaw}`);
  }

  return {
    apply: args.includes('--apply'),
    ingredientsCsv: getValue('ingredients-csv', DEFAULT_INGREDIENTS_CSV),
    openedCsv: getValue('opened-csv', DEFAULT_OPENED_CSV),
    madeCsv: getValue('made-csv', DEFAULT_MADE_CSV),
    eventDate,
  };
}

function parseCsvLine(line: string): string[] {
  const result: string[] = [];
  let current = '';
  let quoted = false;

  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    if (char === '"') {
      if (quoted && line[i + 1] === '"') {
        current += '"';
        i += 1;
      } else {
        quoted = !quoted;
      }
    } else if (char === ',' && !quoted) {
      result.push(current);
      current = '';
    } else {
      current += char;
    }
  }

  result.push(current);
  return result;
}

function readCsvEntries(filePath: string): CsvEntry[] {
  const raw = fs.readFileSync(filePath, 'utf8').replace(/^\uFEFF/, '');
  const lines = raw.split(/\r?\n/).filter((line) => line.trim().length > 0);

  return lines.slice(1).flatMap((line, index) => {
    const columns = parseCsvLine(line);
    const label = String(columns[1] ?? '').trim();
    const count = Number(String(columns[2] ?? '').replace(/,/g, '').trim());
    const lineNumber = index + 2;

    if (!label || label.toLowerCase() === 'undefined' || !Number.isFinite(count) || count <= 0) {
      return [];
    }

    return [{ label, count: Math.floor(count), lineNumber }];
  });
}

function normalizeUnicode(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[’‘]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—−]/g, '-')
    .replace(/\s+/g, ' ')
    .trim();
}

function strictKey(value: string): string {
  return normalizeUnicode(value).toLowerCase();
}

function looseKey(value: string): string {
  return strictKey(value)
    .replace(/dessicated/g, 'desiccated')
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function singularLooseKey(value: string): string {
  return looseKey(value)
    .split(' ')
    .map((word) => {
      if (word.endsWith('ies') && word.length > 3) return `${word.slice(0, -3)}y`;
      if (word.endsWith('s') && !word.endsWith('ss') && word.length > 3) {
        return word.slice(0, -1);
      }
      return word;
    })
    .join(' ');
}

function labelVariants(label: string): string[] {
  const candidates = new Set<string>([label]);
  const withoutParentheses = label.replace(/\s*\([^)]*\)\s*/g, ' ').trim();
  if (withoutParentheses && withoutParentheses !== label) {
    candidates.add(withoutParentheses);
  }

  for (const match of label.matchAll(/\(([^)]+)\)/g)) {
    const inner = match[1]?.trim();
    if (inner) candidates.add(inner);
  }

  for (const candidate of [...candidates]) {
    for (const part of candidate.split('/')) {
      const trimmed = part.trim();
      if (trimmed) candidates.add(trimmed);
    }
  }

  return [...candidates];
}

function addIndexEntry(
  index: Map<string, IndexedDoc[]>,
  key: string,
  doc: IndexedDoc,
) {
  if (!key) return;
  const current = index.get(key) ?? [];
  if (!current.some((item) => item.id.equals(doc.id))) {
    current.push(doc);
  }
  index.set(key, current);
}

function buildIndex(
  docs: IndexedDoc[],
  aliasesById: Map<string, string[]> = new Map(),
) {
  const strict = new Map<string, IndexedDoc[]>();
  const loose = new Map<string, IndexedDoc[]>();

  for (const doc of docs) {
    const aliases = aliasesById.get(doc.id.toString()) ?? [];
    for (const label of [doc.label, ...aliases].flatMap(labelVariants)) {
      addIndexEntry(strict, strictKey(label), doc);
      addIndexEntry(loose, looseKey(label), doc);
      addIndexEntry(loose, singularLooseKey(label), doc);
    }
  }

  return { strict, loose };
}

function chooseSingleMatch(matches: IndexedDoc[] | undefined): IndexedDoc | null {
  if (!matches?.length) return null;
  if (matches.length === 1) return matches[0];

  const active = matches.filter((match) => match.isActive !== false);
  if (active.length === 1) return active[0];
  return null;
}

function resolveEntries(
  entries: CsvEntry[],
  indexes: ReturnType<typeof buildIndex>,
): ResolutionResult {
  const resolved: ResolvedEntry[] = [];
  const unmatched: CsvEntry[] = [];
  const ambiguous: Array<CsvEntry & { candidates: string[] }> = [];

  for (const entry of entries) {
    let match: IndexedDoc | null = null;
    let ambiguousMatches: IndexedDoc[] | undefined;

    for (const candidate of labelVariants(entry.label)) {
      const strictMatches = indexes.strict.get(strictKey(candidate));
      match = chooseSingleMatch(strictMatches);
      if (match) break;
      if (strictMatches?.length) ambiguousMatches = strictMatches;

      const looseMatches =
        indexes.loose.get(looseKey(candidate)) ??
        indexes.loose.get(singularLooseKey(candidate));
      match = chooseSingleMatch(looseMatches);
      if (match) break;
      if (looseMatches?.length) ambiguousMatches = looseMatches;
    }

    if (match) {
      resolved.push({
        ...entry,
        targetId: match.id,
        targetLabel: match.label,
      });
    } else if (ambiguousMatches?.length) {
      ambiguous.push({
        ...entry,
        candidates: ambiguousMatches.map((item) => item.label),
      });
    } else {
      unmatched.push(entry);
    }
  }

  return { resolved, unmatched, ambiguous };
}

function aggregateResolved(entries: ResolvedEntry[]): ResolvedEntry[] {
  const byTarget = new Map<string, ResolvedEntry>();

  for (const entry of entries) {
    const key = entry.targetId.toString();
    const existing = byTarget.get(key);
    if (existing) {
      existing.count += entry.count;
      existing.label = existing.label === entry.label ? existing.label : existing.targetLabel;
    } else {
      byTarget.set(key, { ...entry });
    }
  }

  return [...byTarget.values()];
}

function deterministicObjectId(kind: CsvKind, targetId: Types.ObjectId, index: number) {
  const hex = crypto
    .createHash('sha1')
    .update(`${IMPORT_KEY}:${kind}:${targetId.toString()}:${index}`)
    .digest('hex')
    .slice(0, 24);
  return new Types.ObjectId(hex);
}

async function upsertRepeatedDocs(
  kind: CsvKind,
  entry: ResolvedEntry,
  buildDoc: (index: number) => Record<string, unknown>,
) {
  let upserted = 0;
  const collection = collectionForKind(kind);

  for (let start = 0; start < entry.count; start += BULK_BATCH_SIZE) {
    const end = Math.min(start + BULK_BATCH_SIZE, entry.count);
    const operations: any[] = [];

    for (let index = start; index < end; index += 1) {
      const _id = deterministicObjectId(kind, entry.targetId, index);
      const doc = { _id, ...buildDoc(index) };
      operations.push({
        updateOne: {
          filter: { _id },
          update: { $setOnInsert: doc },
          upsert: true,
        },
      });
    }

    const result = await collection.bulkWrite(operations, { ordered: false });
    upserted += result.upsertedCount;
  }

  return upserted;
}

let RecipeModel: mongoose.Model<any>;
let IngredientModel: mongoose.Model<any>;
let FoodSavedModel: mongoose.Model<any>;
let IngredientSearchModel: mongoose.Model<any>;
let RecipeViewModel: mongoose.Model<any>;

function collectionForKind(kind: CsvKind) {
  if (kind === 'ingredient_interaction') return IngredientSearchModel.collection;
  if (kind === 'framework_open') return RecipeViewModel.collection;
  return FoodSavedModel.collection;
}

async function applyBackfill(
  kind: CsvKind,
  entries: ResolvedEntry[],
  eventDate: Date,
) {
  let inserted = 0;

  for (let i = 0; i < entries.length; i += 1) {
    const entry = entries[i];
    if (kind === 'ingredient_interaction') {
      inserted += await upsertRepeatedDocs(kind, entry, () => ({
        userId: LEGACY_USER_ID,
        ingredientId: entry.targetId,
        query: null,
        source: 'legacy_insights',
        createdAt: eventDate,
        legacyImport: IMPORT_KEY,
        legacyLabel: entry.label,
      }));
    } else if (kind === 'framework_open') {
      inserted += await upsertRepeatedDocs(kind, entry, () => ({
        recipeId: entry.targetId,
        userId: LEGACY_USER_ID,
        source: RecipeViewSource.OTHER,
        viewedAt: eventDate,
        legacyImport: IMPORT_KEY,
        legacyLabel: entry.label,
      }));
    } else {
      inserted += await upsertRepeatedDocs(kind, entry, (index) => ({
        userId: LEGACY_USER_ID,
        frameworkId: entry.targetId,
        ingredientIds: [],
        foodSavedInGrams: 0,
        moneySaved: 0,
        currency: null,
        co2SavedInGrams: 0,
        country: null,
        idempotencyKey: `${IMPORT_KEY}:framework_made:${entry.targetId.toString()}:${index}`,
        createdAt: eventDate,
        legacyImport: IMPORT_KEY,
        legacyLabel: entry.label,
      }));
    }

    if ((i + 1) % 25 === 0 || i === entries.length - 1) {
      console.log(
        `${kind}: processed ${i + 1}/${entries.length} aggregate rows, inserted ${inserted} new event docs`,
      );
    }
  }

  return inserted;
}

async function refreshRecipeCounters(recipeIds: Types.ObjectId[]) {
  const uniqueIds = [...new Set(recipeIds.map((id) => id.toString()))].map(
    (id) => new Types.ObjectId(id),
  );
  if (!uniqueIds.length) return;

  const [viewRows, cookRows] = await Promise.all([
    RecipeViewModel.collection
      .aggregate([
        { $match: { recipeId: { $in: uniqueIds } } },
        { $group: { _id: '$recipeId', count: { $sum: 1 } } },
      ])
      .toArray(),
    FoodSavedModel.collection
      .aggregate([
        { $match: { frameworkId: { $in: uniqueIds } } },
        { $group: { _id: '$frameworkId', count: { $sum: 1 } } },
      ])
      .toArray(),
  ]);

  const viewCounts = new Map(viewRows.map((row) => [String(row._id), row.count]));
  const cookCounts = new Map(cookRows.map((row) => [String(row._id), row.count]));

  const operations = uniqueIds.map((id) => ({
    updateOne: {
      filter: { _id: id },
      update: {
        $max: {
          viewCount: viewCounts.get(id.toString()) ?? 0,
          cookCount: cookCounts.get(id.toString()) ?? 0,
        },
      },
    },
  }));

  await RecipeModel.collection.bulkWrite(operations, { ordered: false });
}

function printResolutionSummary(name: string, result: ResolutionResult) {
  const matchedEvents = result.resolved.reduce((sum, item) => sum + item.count, 0);
  const unmatchedEvents = result.unmatched.reduce((sum, item) => sum + item.count, 0);
  const ambiguousEvents = result.ambiguous.reduce((sum, item) => sum + item.count, 0);

  console.log(`\n${name}`);
  console.log(`  matched rows: ${result.resolved.length}, events: ${matchedEvents}`);
  console.log(`  unmatched rows: ${result.unmatched.length}, events: ${unmatchedEvents}`);
  console.log(`  ambiguous rows: ${result.ambiguous.length}, events: ${ambiguousEvents}`);

  const topUnmatched = [...result.unmatched]
    .sort((a, b) => b.count - a.count)
    .slice(0, 20);
  if (topUnmatched.length) {
    console.log('  top unmatched:');
    topUnmatched.forEach((item) => {
      console.log(`    ${item.label} (${item.count})`);
    });
  }

  const topAmbiguous = [...result.ambiguous]
    .sort((a, b) => b.count - a.count)
    .slice(0, 10);
  if (topAmbiguous.length) {
    console.log('  top ambiguous:');
    topAmbiguous.forEach((item) => {
      console.log(`    ${item.label} (${item.count}) -> ${item.candidates.join(' | ')}`);
    });
  }
}

async function main() {
  const args = parseArgs();
  const uri = process.env.MONGODB_URI;
  const dbName = process.env.MONGODB_DBNAME || 'saveful';

  if (!uri) {
    throw new Error('MONGODB_URI is not set in sv1/.env');
  }

  await mongoose.connect(uri, { dbName });
  console.log(`Connected to MongoDB database ${dbName}`);

  RecipeModel = mongoose.model(Recipe.name, RecipeSchema);
  IngredientModel = mongoose.model(Ingredient.name, IngredientSchema);
  FoodSavedModel = mongoose.model(FoodSavedEventLog.name, FoodSavedEventLogSchema);
  IngredientSearchModel = mongoose.model(
    IngredientSearchEvent.name,
    IngredientSearchEventSchema,
  );
  RecipeViewModel = mongoose.model(RecipeView.name, RecipeViewSchema);

  const [recipes, ingredients] = await Promise.all([
    RecipeModel.find({})
      .select('_id title isActive')
      .lean(),
    IngredientModel.find({})
      .select('_id name aliases')
      .lean(),
  ]);

  const recipeDocs: IndexedDoc[] = recipes.map((recipe: any) => ({
    id: recipe._id,
    label: recipe.title,
    isActive: recipe.isActive,
  }));

  const ingredientAliases = new Map<string, string[]>();
  const ingredientDocs: IndexedDoc[] = ingredients.map((ingredient: any) => {
    ingredientAliases.set(
      ingredient._id.toString(),
      [
        ...(Array.isArray(ingredient.aliases) ? ingredient.aliases : []),
        ...(MANUAL_INGREDIENT_ALIASES_BY_NAME[ingredient.name] ?? []),
      ],
    );
    return {
      id: ingredient._id,
      label: ingredient.name,
    };
  });

  const recipeIndex = buildIndex(recipeDocs);
  const ingredientIndex = buildIndex(ingredientDocs, ingredientAliases);

  const ingredientRows = readCsvEntries(args.ingredientsCsv);
  const openedRows = readCsvEntries(args.openedCsv);
  const madeRows = readCsvEntries(args.madeCsv);

  const ingredientResolution = resolveEntries(ingredientRows, ingredientIndex);
  const openedResolution = resolveEntries(openedRows, recipeIndex);
  const madeResolution = resolveEntries(madeRows, recipeIndex);

  printResolutionSummary('Ingredient interactions', ingredientResolution);
  printResolutionSummary('Opened frameworks', openedResolution);
  printResolutionSummary('Made frameworks', madeResolution);

  if (!args.apply) {
    console.log('\nDry run only. Re-run with --apply to write the backfill.');
    return;
  }

  const resolvedIngredients = aggregateResolved(ingredientResolution.resolved);
  const resolvedOpened = aggregateResolved(openedResolution.resolved);
  const resolvedMade = aggregateResolved(madeResolution.resolved);

  console.log(`\nApplying legacy insights at ${args.eventDate.toISOString()}`);

  const insertedIngredientEvents = await applyBackfill(
    'ingredient_interaction',
    resolvedIngredients,
    args.eventDate,
  );
  const insertedOpenEvents = await applyBackfill(
    'framework_open',
    resolvedOpened,
    args.eventDate,
  );
  const insertedMadeEvents = await applyBackfill(
    'framework_made',
    resolvedMade,
    args.eventDate,
  );

  await refreshRecipeCounters([
    ...resolvedOpened.map((entry) => entry.targetId),
    ...resolvedMade.map((entry) => entry.targetId),
  ]);

  console.log('\nBackfill complete.');
  console.log(`  ingredient event docs inserted: ${insertedIngredientEvents}`);
  console.log(`  recipe view docs inserted: ${insertedOpenEvents}`);
  console.log(`  food saved docs inserted: ${insertedMadeEvents}`);
  console.log('  recipe viewCount/cookCount counters refreshed with $max');
}

main()
  .catch((error) => {
    console.error('Legacy insights backfill failed:', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await mongoose.disconnect();
  });
