import 'reflect-metadata';
import * as dotenv from 'dotenv';
import * as fs from 'fs';
import * as path from 'path';
import Redis, { RedisOptions } from 'ioredis';
import mongoose from 'mongoose';
import OpenAI from 'openai';
import {
  Ingredient,
  IngredientSchema,
  Month,
} from '../src/database/schemas/ingredient.schema';

dotenv.config({ path: path.resolve(__dirname, '../.env') });
dotenv.config();

const MONTHS: Month[] = [
  Month.JANUARY,
  Month.FEBRUARY,
  Month.MARCH,
  Month.APRIL,
  Month.MAY,
  Month.JUNE,
  Month.JULY,
  Month.AUGUST,
  Month.SEPTEMBER,
  Month.OCTOBER,
  Month.NOVEMBER,
  Month.DECEMBER,
];

const MONTH_BY_LOWER = new Map(MONTHS.map((month) => [month.toLowerCase(), month]));

type IngredientDoc = {
  _id: mongoose.Types.ObjectId;
  name: string;
  aliases?: string[];
  countries?: string[];
  inSeason?: Month[];
  seasonByCountry?: Record<string, Month[]>;
};

type IngredientPromptItem = {
  id: string;
  name: string;
  aliases: string[];
  countries: string[];
  currentGlobalInSeason: Month[];
};

type GeneratedSeasonItem = {
  id: string;
  name: string;
  seasonByCountry: Record<string, Month[]>;
  confidenceByCountry?: Record<string, 'high'>;
  verificationNotesByCountry?: Record<string, string>;
};

type RejectedSeasonItem = {
  id: string;
  name: string;
  countries: string[];
  reason: string;
};

type CliOptions = {
  batchSize: number;
  limit?: number;
  dryRun: boolean;
  overwrite: boolean;
  country?: string;
  out?: string;
  clearCache: boolean;
};

const IngredientModel = mongoose.model(Ingredient.name, IngredientSchema);

function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = {
    batchSize: 20,
    dryRun: false,
    overwrite: false,
    clearCache: true,
  };

  for (const arg of argv) {
    if (arg === '--dry-run') options.dryRun = true;
    else if (arg === '--overwrite') options.overwrite = true;
    else if (arg === '--no-cache-clear') options.clearCache = false;
    else if (arg.startsWith('--batch-size=')) options.batchSize = Number(arg.split('=')[1]);
    else if (arg.startsWith('--limit=')) options.limit = Number(arg.split('=')[1]);
    else if (arg.startsWith('--country=')) options.country = arg.split('=').slice(1).join('=').trim();
    else if (arg.startsWith('--out=')) options.out = arg.split('=').slice(1).join('=').trim();
  }

  if (!Number.isFinite(options.batchSize) || options.batchSize < 1) options.batchSize = 20;
  if (options.limit !== undefined && (!Number.isFinite(options.limit) || options.limit < 1)) {
    options.limit = undefined;
  }

  return options;
}

function normalizeCountry(value: string): string {
  return value.trim();
}

function normalizeCountryKey(value: string): string {
  return normalizeCountry(value).toLowerCase();
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function normalizeMonths(value: unknown): Month[] {
  if (!Array.isArray(value)) return [];

  const months = new Set<Month>();
  for (const rawMonth of value) {
    const month = MONTH_BY_LOWER.get(String(rawMonth).trim().toLowerCase());
    if (month) months.add(month);
  }

  return MONTHS.filter((month) => months.has(month));
}

function readSeasonMapValue(
  map: Record<string, unknown> | undefined,
  country: string,
): unknown {
  if (!map) return undefined;
  if (map[country] !== undefined) return map[country];

  const wanted = normalizeCountryKey(country);
  const match = Object.entries(map).find(([key]) => normalizeCountryKey(key) === wanted);
  return match?.[1];
}

function targetCountriesForIngredient(
  ingredient: IngredientDoc,
  options: CliOptions,
): string[] {
  const countries = options.country ? [options.country] : ingredient.countries ?? [];
  return Array.from(
    new Map(
      countries
        .map(normalizeCountry)
        .filter(Boolean)
        .map((country) => [normalizeCountryKey(country), country]),
    ).values(),
  );
}

function ingredientNeedsUpdate(ingredient: IngredientDoc, options: CliOptions): boolean {
  const countries = targetCountriesForIngredient(ingredient, options);
  if (!countries.length) return false;
  if (options.overwrite) return true;

  const current = ingredient.seasonByCountry ?? {};
  return countries.some((country) => !Array.isArray(readSeasonMapValue(current, country)));
}

function mergeSeasonMaps(
  current: Record<string, Month[]> | undefined,
  generated: Record<string, Month[]>,
  overwrite: boolean,
): Record<string, Month[]> {
  if (overwrite) return generated;
  return { ...(current ?? {}), ...generated };
}

function buildPrompt(batch: IngredientPromptItem[]): OpenAI.Chat.Completions.ChatCompletionMessageParam[] {
  return [
    {
      role: 'system',
      content: [
        'You are an agricultural seasonality researcher for a consumer food app.',
        'Return strict JSON only. Do not include markdown or prose.',
        'Use exact month names from January through December.',
        'For each requested country, identify the typical fresh peak harvest/in-season months for the ingredient in that country.',
        'Prefer domestic field harvest seasons. If domestic production is limited, use the closest established regional fresh supply season for that country. Do not mark imported off-season availability, cold storage, or greenhouse-only supply as in-season.',
        'If an ingredient is genuinely year-round in a country, return all 12 months.',
        'If there is no meaningful domestic or normal regional fresh-market season for that ingredient in a requested country, return an empty array for that country.',
      ].join(' '),
    },
    {
      role: 'user',
      content: JSON.stringify({
        responseSchema: {
          ingredients: [
            {
              id: 'ingredient id from input',
              name: 'ingredient name from input',
              seasonByCountry: {
                'Country name from input': ['January', 'February'],
              },
            },
          ],
        },
        rules: [
          'Return every ingredient id from the input exactly once.',
          'For each ingredient, return every requested country exactly as provided.',
          'Each country value must be an array of valid month names ordered January through December, or an empty array when no meaningful fresh season exists.',
          'Use the currentGlobalInSeason months as a clue only; correct it for each country and hemisphere.',
          'Do not add countries, ids, or ingredient names that are not in the input.',
        ],
        ingredients: batch,
      }),
    },
  ];
}

function buildVerificationPrompt(
  batch: IngredientPromptItem[],
  generated: GeneratedSeasonItem[],
): OpenAI.Chat.Completions.ChatCompletionMessageParam[] {
  return [
    {
      role: 'system',
      content: [
        'You are an independent agricultural seasonality auditor.',
        'Return strict JSON only. Do not include markdown or prose.',
        'Another AI generated country-specific ingredient seasons. Verify them from agricultural seasonality knowledge, crop calendars, hemisphere timing, and typical fresh harvest windows.',
        'Correct any inaccurate month arrays. Approve only if the corrected result is high-confidence and suitable for production seeding.',
        'Use exact month names from January through December. Keep month arrays ordered January through December.',
        'Do not count imported off-season availability, long cold storage, or greenhouse-only supply as in-season.',
        'If a country has no meaningful local harvest for an ingredient, use the closest established regional fresh supply season only when it is clearly the normal fresh-market season for that country.',
        'If no meaningful domestic or normal regional fresh-market season exists for a requested country, return an empty array for that country and explain why in reviewNotesByCountry.',
      ].join(' '),
    },
    {
      role: 'user',
      content: JSON.stringify({
        responseSchema: {
          ingredients: [
            {
              id: 'ingredient id from input',
              name: 'ingredient name from input',
              approved: true,
              correctedSeasonByCountry: {
                'Country name from input': ['January', 'February'],
              },
              confidenceByCountry: {
                'Country name from input': 'high',
              },
              reviewNotesByCountry: {
                'Country name from input': 'brief reason for final months',
              },
            },
          ],
        },
        rules: [
          'Return every ingredient id from originalInput exactly once.',
          'Return every requested country exactly as provided in originalInput.',
          'If a proposed season is wrong, correct it in correctedSeasonByCountry.',
          'Set approved to false if any country for that ingredient cannot be verified with high confidence.',
          'Every confidenceByCountry value must be high for approved ingredients, including approved empty arrays.',
          'Do not add ids, countries, or ingredient names that are not in originalInput.',
        ],
        originalInput: batch,
        proposedSeasonality: generated,
      }),
    },
  ];
}

function extractGeneratedItems(raw: string): unknown[] {
  const parsed = JSON.parse(raw);
  if (Array.isArray(parsed)) return parsed;
  if (Array.isArray(parsed.ingredients)) return parsed.ingredients;
  if (Array.isArray(parsed.items)) return parsed.items;
  throw new Error('AI response did not include an ingredients array');
}

function sanitizeGeneratedItems(
  rawItems: unknown[],
  requestedItems: IngredientPromptItem[],
): GeneratedSeasonItem[] {
  const rawById = new Map<string, any>();
  for (const item of rawItems) {
    if (!item || typeof item !== 'object') continue;
    const id = String((item as any).id ?? '').trim();
    if (id) rawById.set(id, item);
  }

  return requestedItems.map((requested) => {
    const raw = rawById.get(requested.id);
    if (!raw) throw new Error(`AI response is missing ingredient ${requested.name} (${requested.id})`);

    const rawSeasonMap = raw.seasonByCountry;
    if (!rawSeasonMap || typeof rawSeasonMap !== 'object' || Array.isArray(rawSeasonMap)) {
      throw new Error(`AI response has invalid seasonByCountry for ${requested.name}`);
    }

    const seasonByCountry: Record<string, Month[]> = {};
    for (const country of requested.countries) {
      const rawMonths = readSeasonMapValue(rawSeasonMap, country);
      if (!Array.isArray(rawMonths)) {
        throw new Error(`AI response is missing a months array for ${requested.name} in ${country}`);
      }

      const months = normalizeMonths(rawMonths);
      if (rawMonths.length > 0 && !months.length) {
        throw new Error(`AI response has invalid month names for ${requested.name} in ${country}`);
      }
      seasonByCountry[country] = months;
    }

    return {
      id: requested.id,
      name: requested.name,
      seasonByCountry,
    };
  });
}

function sanitizeVerifiedItems(
  rawItems: unknown[],
  requestedItems: IngredientPromptItem[],
): GeneratedSeasonItem[] {
  const rawById = new Map<string, any>();
  for (const item of rawItems) {
    if (!item || typeof item !== 'object') continue;
    const id = String((item as any).id ?? '').trim();
    if (id) rawById.set(id, item);
  }

  return requestedItems.map((requested) => {
    const raw = rawById.get(requested.id);
    if (!raw) throw new Error(`Verifier response is missing ingredient ${requested.name} (${requested.id})`);
    if (raw.approved !== true) {
      throw new Error(`Verifier did not approve ${requested.name} (${requested.id})`);
    }

    const rawSeasonMap = raw.correctedSeasonByCountry ?? raw.seasonByCountry;
    if (!rawSeasonMap || typeof rawSeasonMap !== 'object' || Array.isArray(rawSeasonMap)) {
      throw new Error(`Verifier response has invalid correctedSeasonByCountry for ${requested.name}`);
    }

    const seasonByCountry: Record<string, Month[]> = {};
    const confidenceByCountry: Record<string, 'high'> = {};
    const verificationNotesByCountry: Record<string, string> = {};

    for (const country of requested.countries) {
      const rawMonths = readSeasonMapValue(rawSeasonMap, country);
      if (!Array.isArray(rawMonths)) {
        throw new Error(`Verifier response is missing a months array for ${requested.name} in ${country}`);
      }

      const months = normalizeMonths(rawMonths);
      if (rawMonths.length > 0 && !months.length) {
        throw new Error(`Verifier response has invalid month names for ${requested.name} in ${country}`);
      }

      const confidence = String(
        readSeasonMapValue(raw.confidenceByCountry, country) ?? '',
      ).trim().toLowerCase();
      if (confidence !== 'high') {
        throw new Error(`Verifier did not return high confidence for ${requested.name} in ${country}`);
      }

      seasonByCountry[country] = months;
      confidenceByCountry[country] = 'high';
      const note = readSeasonMapValue(raw.reviewNotesByCountry, country);
      if (typeof note === 'string' && note.trim()) {
        verificationNotesByCountry[country] = note.trim();
      }
    }

    return {
      id: requested.id,
      name: requested.name,
      seasonByCountry,
      confidenceByCountry,
      verificationNotesByCountry,
    };
  });
}

async function callOpenAIJsonWithRetry(
  openai: OpenAI,
  messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[],
  purpose: string,
): Promise<unknown[]> {
  let lastError: unknown;

  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const response = await openai.chat.completions.create({
        model: process.env.OPENAI_SEASONALITY_MODEL || 'gpt-4.1',
        messages,
        response_format: { type: 'json_object' },
        temperature: 0,
      });

      const content = response.choices[0]?.message?.content ?? '';
      return extractGeneratedItems(content);
    } catch (error) {
      lastError = error;
      console.warn(`AI ${purpose} attempt ${attempt}/3 failed: ${(error as Error).message}`);
    }
  }

  throw lastError instanceof Error ? lastError : new Error(`AI ${purpose} failed`);
}

async function generateBatch(
  openai: OpenAI,
  batch: IngredientPromptItem[],
): Promise<GeneratedSeasonItem[]> {
  const draftItems = sanitizeGeneratedItems(
    await callOpenAIJsonWithRetry(openai, buildPrompt(batch), 'seasonality generation'),
    batch,
  );

  return sanitizeVerifiedItems(
    await callOpenAIJsonWithRetry(
      openai,
      buildVerificationPrompt(batch, draftItems),
      'seasonality verification',
    ),
    batch,
  );
}

async function clearIngredientCaches() {
  if (!process.env.REDIS_URL && !process.env.REDIS_HOST) {
    console.log('Redis cache clear skipped: REDIS_URL/REDIS_HOST is not configured.');
    return;
  }

  const options: RedisOptions = {
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
    tls: {},
    username: process.env.REDIS_USERNAME,
    password: process.env.REDIS_PASSWORD,
  };

  const client = process.env.REDIS_URL
    ? new Redis(process.env.REDIS_URL.replace(/^redis:\/\//, 'rediss://'), options)
    : new Redis({
        host: process.env.REDIS_HOST || '127.0.0.1',
        port: Number(process.env.REDIS_PORT) || 6379,
        db: Number(process.env.REDIS_DB) || 0,
        ...options,
      });

  try {
    let cursor = '0';
    let deleted = 0;
    do {
      const [nextCursor, keys] = await client.scan(cursor, 'MATCH', 'Ingredients:all*', 'COUNT', 100);
      cursor = nextCursor;
      if (keys.length > 0) {
        deleted += keys.length;
        await client.del(...keys);
      }
    } while (cursor !== '0');
    console.log(`Cleared ${deleted} ingredient cache key(s).`);
  } finally {
    await client.quit();
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const mongoUri = process.env.MONGODB_URI;
  const apiKey = process.env.OPENAI_API_KEY;

  if (!mongoUri) throw new Error('MONGODB_URI is required');
  if (!apiKey) throw new Error('OPENAI_API_KEY is required');

  await mongoose.connect(mongoUri, {
    dbName: process.env.MONGODB_DBNAME || 'testdb',
    autoIndex: false,
  });

  const openai = new OpenAI({ apiKey });
  const query: Record<string, unknown> = { hasPage: true };
  if (options.country) query.countries = options.country;

  const ingredients = await IngredientModel.find(query)
    .select('name aliases countries inSeason seasonByCountry')
    .sort({ order: 1, name: 1 })
    .limit(options.limit ?? 0)
    .lean<IngredientDoc[]>();

  const candidates = ingredients.filter((ingredient) => ingredientNeedsUpdate(ingredient, options));
  console.log(`Found ${ingredients.length} hasPage ingredient(s), ${candidates.length} need seasonality updates.`);

  const generated: GeneratedSeasonItem[] = [];
  const rejected: RejectedSeasonItem[] = [];
  for (let index = 0; index < candidates.length; index += options.batchSize) {
    const docs = candidates.slice(index, index + options.batchSize);
    const promptItems = docs.map((ingredient) => ({
      id: ingredient._id.toString(),
      name: ingredient.name,
      aliases: ingredient.aliases ?? [],
      countries: targetCountriesForIngredient(ingredient, options),
      currentGlobalInSeason: ingredient.inSeason ?? [],
    }));

    console.log(`Generating batch ${Math.floor(index / options.batchSize) + 1}/${Math.ceil(candidates.length / options.batchSize)} (${promptItems.length} ingredient(s))...`);
    let batchResult: GeneratedSeasonItem[] = [];
    try {
      batchResult = await generateBatch(openai, promptItems);
    } catch (error) {
      console.warn(`Batch verification failed: ${getErrorMessage(error)}. Retrying ingredients one by one...`);
      for (const promptItem of promptItems) {
        try {
          const [singleResult] = await generateBatch(openai, [promptItem]);
          batchResult.push(singleResult);
        } catch (singleError) {
          console.warn(`Ingredient verification failed for ${promptItem.name}: ${getErrorMessage(singleError)}. Retrying country by country...`);
          const partialResult: GeneratedSeasonItem = {
            id: promptItem.id,
            name: promptItem.name,
            seasonByCountry: {},
            confidenceByCountry: {},
            verificationNotesByCountry: {},
          };
          const rejectedCountries: string[] = [];
          const rejectionReasons: string[] = [];

          for (const country of promptItem.countries) {
            try {
              const [countryResult] = await generateBatch(openai, [
                { ...promptItem, countries: [country] },
              ]);
              partialResult.seasonByCountry[country] =
                countryResult.seasonByCountry[country] ?? [];
              partialResult.confidenceByCountry![country] = 'high';
              const note = countryResult.verificationNotesByCountry?.[country];
              if (note) partialResult.verificationNotesByCountry![country] = note;
            } catch (countryError) {
              rejectedCountries.push(country);
              rejectionReasons.push(`${country}: ${getErrorMessage(countryError)}`);
            }
          }

          if (Object.keys(partialResult.seasonByCountry).length > 0) {
            batchResult.push(partialResult);
          }

          if (rejectedCountries.length > 0) {
            rejected.push({
              id: promptItem.id,
              name: promptItem.name,
              countries: rejectedCountries,
              reason: rejectionReasons.join('; '),
            });
            console.warn(`Skipped ${promptItem.name} for ${rejectedCountries.length} countr${rejectedCountries.length === 1 ? 'y' : 'ies'}.`);
          }
        }
      }
    }
    generated.push(...batchResult);
  }

  if (!options.dryRun && generated.length > 0) {
    const currentById = new Map(candidates.map((ingredient) => [ingredient._id.toString(), ingredient]));
    await IngredientModel.bulkWrite(
      generated.map((item) => {
        const current = currentById.get(item.id);
        return {
          updateOne: {
            filter: { _id: item.id, hasPage: true },
            update: {
              $set: {
                seasonByCountry: mergeSeasonMaps(
                  current?.seasonByCountry,
                  item.seasonByCountry,
                  options.overwrite,
                ),
              },
            },
          },
        };
      }),
    );
  }

  if (options.out) {
    fs.writeFileSync(path.resolve(options.out), JSON.stringify({ generated, rejected }, null, 2));
    console.log(`Wrote generated seasonality to ${options.out}`);
  }

  if (options.dryRun) {
    console.log(`Dry run complete. ${generated.length} ingredient(s) generated but not written. ${rejected.length} rejected.`);
  } else {
    console.log(`Seeded seasonByCountry for ${generated.length} ingredient(s). ${rejected.length} rejected.`);
    if (options.clearCache) await clearIngredientCaches();
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await mongoose.disconnect();
  });
