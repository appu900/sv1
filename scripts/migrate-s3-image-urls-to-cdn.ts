import * as dotenv from 'dotenv';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as mongoose from 'mongoose';
import Redis, { RedisOptions } from 'ioredis';
import {
  collectLegacyImageUrlChanges,
  DEFAULT_CDN_BASE_URL,
  ImageUrlValueChange,
} from '../src/common/utils/image-url-migration';

dotenv.config({ path: path.resolve(__dirname, '../.env') });

type CollectionSpec = {
  name: string;
  roots: string[];
};

type ManifestRecord = ImageUrlValueChange & {
  collection: string;
  documentId: string;
};

type CollectionSummary = {
  collection: string;
  scanned: number;
  changedDocuments: number;
  changedValues: number;
  writtenDocuments: number;
  samples: ManifestRecord[];
};

const COLLECTIONS: CollectionSpec[] = [
  { name: 'recipes', roots: ['heroImageUrl'] },
  { name: 'userrecipes', roots: ['heroImageUrl'] },
  { name: 'cuisines', roots: ['imageUrl'] },
  { name: 'chefprofiles', roots: ['avatarImageUrl', 'heroImageUrl'] },
  { name: 'ingredients', roots: ['heroImageUrl'] },
  { name: 'ingredientscategories', roots: ['imageUrl'] },
  { name: 'stickers', roots: ['imageUrl'] },
  { name: 'sponsers', roots: ['logo', 'logoBlackAndWhite'] },
  { name: 'badges', roots: ['imageUrl', 'sponsorLogoUrl'] },
  {
    name: 'hacks',
    roots: [
      'thumbnailImageUrl',
      'heroImageUrl',
      'iconImageUrl',
      'articleBlocks',
      'description',
      'leadText',
    ],
  },
  { name: 'hackscategories', roots: ['heroImageUrl', 'iconImageUrl'] },
  { name: 'communitygroups', roots: ['profilePhotoUrl'] },
  { name: 'user_custom_foods', roots: ['imageUrl'] },
  { name: 'food_items', roots: ['imageUrl'] },
  { name: 'userinventoryitems', roots: ['heroImageUrl'] },
  {
    name: 'notifications',
    roots: [
      'imageUrl',
      'imageUrls',
      'bodyHtml',
      'bodyBlocks',
      'builderConfig',
      'sentSnapshot',
    ],
  },
  { name: 'surveyconfigs', roots: ['weeklyTips'] },
  { name: 'chefleaderboardsnapshots', roots: ['payload'] },
  {
    name: 'notificationtemplates',
    roots: ['imageUrl', 'imageUrls', 'builderConfig', 'bodyHtml'],
  },
  { name: 'emaildeliveryevents', roots: ['sentSnapshot'] },
  { name: 'chefingredientsubmissions', roots: ['proposedIngredient'] },
  { name: 'users', roots: ['profileImageUrl'] },
];

const CACHE_PATTERNS = [
  'recipes:*',
  'dietary:*',
  'chefs:*',
  'chef:recipe-chefs:*',
  'cuisines:*',
  'Ingredients:*',
  'Ingrediants:*',
  'ingredients:*',
  'hacks:*',
  'sponsers:*',
  'food-facts:*',
  'community:*',
  'inventory:*',
  'user:*:cookbookai*',
  'analytics:leaderboard:v2:*',
  'analytics:trending:v2:*',
  'stickers:*',
  'sticker:*',
  'badges:*',
];

function parseArgs() {
  const args = process.argv.slice(2);
  const getValue = (name: string) => {
    const prefix = `--${name}=`;
    return args.find((arg) => arg.startsWith(prefix))?.slice(prefix.length);
  };
  const batchSize = Number(getValue('batch-size') || 500);
  if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > 5000) {
    throw new Error('--batch-size must be an integer between 1 and 5000');
  }

  const requestedCollections = new Set(
    (getValue('collection') || '')
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean),
  );
  const unknown = [...requestedCollections].filter(
    (name) => !COLLECTIONS.some((spec) => spec.name === name),
  );
  if (unknown.length) {
    throw new Error(`Unknown collection(s): ${unknown.join(', ')}`);
  }

  return {
    apply: args.includes('--apply'),
    invalidateCache: args.includes('--invalidate-cache'),
    batchSize,
    requestedCollections,
    cdnBaseUrl: (process.env.CDN_BASE_URL || DEFAULT_CDN_BASE_URL).replace(
      /\/+$/,
      '',
    ),
  };
}

function writeManifestRecord(fd: number, record: unknown): void {
  fs.writeSync(fd, `${JSON.stringify(record)}\n`);
}

async function migrateCollection(
  spec: CollectionSpec,
  options: ReturnType<typeof parseArgs>,
  manifestFd: number,
): Promise<CollectionSummary> {
  const db = mongoose.connection.db;
  if (!db) throw new Error('MongoDB connection is not available');

  const collection = db.collection(spec.name);
  const projection = Object.fromEntries([
    ['_id', 1],
    ...spec.roots.map((root) => [root, 1]),
  ]);
  const cursor = collection.find({}, { projection });
  const summary: CollectionSummary = {
    collection: spec.name,
    scanned: 0,
    changedDocuments: 0,
    changedValues: 0,
    writtenDocuments: 0,
    samples: [],
  };
  type BulkOperation = Parameters<typeof collection.bulkWrite>[0][number];
  let operations: BulkOperation[] = [];
  let pendingManifest: ManifestRecord[] = [];

  const flush = async () => {
    if (!operations.length) return;
    if (options.apply) {
      const result = await collection.bulkWrite(operations, { ordered: false });
      summary.writtenDocuments += result.modifiedCount;
      pendingManifest.forEach((record) =>
        writeManifestRecord(manifestFd, record),
      );
    }
    operations = [];
    pendingManifest = [];
  };

  for await (const document of cursor) {
    summary.scanned += 1;
    const changes: ImageUrlValueChange[] = [];
    for (const root of spec.roots) {
      changes.push(
        ...collectLegacyImageUrlChanges(document[root], root, {
          cdnBaseUrl: options.cdnBaseUrl,
        }),
      );
    }
    if (!changes.length) continue;

    summary.changedDocuments += 1;
    summary.changedValues += changes.length;
    const records = changes.map((change) => ({
      collection: spec.name,
      documentId: String(document._id),
      ...change,
    }));
    if (summary.samples.length < 5) {
      summary.samples.push(
        ...records.slice(0, 5 - summary.samples.length),
      );
    }

    if (options.apply) {
      operations.push({
        updateOne: {
          filter: { _id: document._id },
          update: {
            $set: Object.fromEntries(
              changes.map((change) => [change.path, change.after]),
            ),
          },
        },
      });
      pendingManifest.push(...records);
      if (operations.length >= options.batchSize) await flush();
    } else {
      records.forEach((record) => writeManifestRecord(manifestFd, record));
    }
  }
  await flush();
  return summary;
}

function createRedisClient(): Redis {
  const options: RedisOptions = {
    maxRetriesPerRequest: 1,
    enableReadyCheck: true,
    connectTimeout: 10_000,
    tls: {},
    username: process.env.REDIS_USERNAME,
    password: process.env.REDIS_PASSWORD,
    lazyConnect: true,
  };
  if (process.env.REDIS_URL) {
    return new Redis(
      process.env.REDIS_URL.replace(/^redis:\/\//, 'rediss://'),
      options,
    );
  }
  return new Redis({
    host: process.env.REDIS_HOST || '127.0.0.1',
    port: Number(process.env.REDIS_PORT) || 6379,
    db: Number(process.env.REDIS_DB) || 0,
    ...options,
  });
}

async function invalidateCaches(): Promise<number> {
  const redis = createRedisClient();
  redis.on('error', () => {
    // Connection failures are surfaced by connect()/commands and summarized by main.
  });
  let deleted = 0;
  try {
    await redis.connect();
    for (const pattern of CACHE_PATTERNS) {
      let cursor = '0';
      do {
        const [nextCursor, keys] = await redis.scan(
          cursor,
          'MATCH',
          pattern,
          'COUNT',
          500,
        );
        cursor = nextCursor;
        if (keys.length) {
          deleted += await redis.del(...keys);
        }
      } while (cursor !== '0');
    }
    return deleted;
  } finally {
    redis.disconnect();
  }
}

async function main() {
  const options = parseArgs();
  if (options.invalidateCache && !options.apply) {
    throw new Error('--invalidate-cache requires --apply');
  }

  const uri = process.env.MONGODB_URI;
  const dbName = process.env.MONGODB_DBNAME || 'saveful';
  if (!uri) throw new Error('MONGODB_URI is not set in sv1/.env');

  const selectedCollections = COLLECTIONS.filter(
    (spec) =>
      !options.requestedCollections.size ||
      options.requestedCollections.has(spec.name),
  );
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const reportDirectory = path.join(
    os.tmpdir(),
    'saveful-image-url-migrations',
  );
  fs.mkdirSync(reportDirectory, { recursive: true });
  const mode = options.apply ? 'apply' : 'dry-run';
  const manifestPath = path.join(
    reportDirectory,
    `${timestamp}-${mode}-manifest.jsonl`,
  );
  const summaryPath = path.join(
    reportDirectory,
    `${timestamp}-${mode}-summary.json`,
  );
  const manifestFd = fs.openSync(manifestPath, 'wx', 0o600);

  writeManifestRecord(manifestFd, {
    type: 'header',
    createdAt: new Date().toISOString(),
    mode,
    dbName,
    cdnBaseUrl: options.cdnBaseUrl,
    collections: selectedCollections.map((spec) => spec.name),
  });

  try {
    await mongoose.connect(uri, { dbName });
    console.log(`Connected to MongoDB database "${dbName}" (${mode})`);
    const summaries: CollectionSummary[] = [];
    for (const spec of selectedCollections) {
      const summary = await migrateCollection(spec, options, manifestFd);
      summaries.push(summary);
      console.log(
        `${spec.name}: scanned=${summary.scanned} changedDocs=${summary.changedDocuments} ` +
          `changedValues=${summary.changedValues} written=${summary.writtenDocuments}`,
      );
      summary.samples.forEach((sample) =>
        console.log(
          `  ${sample.documentId} ${sample.path}: ${sample.before} -> ${sample.after}`,
        ),
      );
    }

    let invalidatedCacheKeys = 0;
    let cacheInvalidationError: string | null = null;
    if (options.invalidateCache) {
      try {
        invalidatedCacheKeys = await invalidateCaches();
        console.log(`Invalidated ${invalidatedCacheKeys} Redis cache keys`);
      } catch (error) {
        cacheInvalidationError =
          error instanceof Error ? error.message : String(error);
        console.warn(`Redis cache invalidation failed: ${cacheInvalidationError}`);
      }
    }

    const totals = summaries.reduce(
      (total, summary) => ({
        scanned: total.scanned + summary.scanned,
        changedDocuments:
          total.changedDocuments + summary.changedDocuments,
        changedValues: total.changedValues + summary.changedValues,
        writtenDocuments:
          total.writtenDocuments + summary.writtenDocuments,
      }),
      {
        scanned: 0,
        changedDocuments: 0,
        changedValues: 0,
        writtenDocuments: 0,
      },
    );
    fs.writeFileSync(
      summaryPath,
      `${JSON.stringify(
        {
          mode,
          createdAt: new Date().toISOString(),
          dbName,
          cdnBaseUrl: options.cdnBaseUrl,
          totals,
          invalidatedCacheKeys,
          cacheInvalidationError,
          collections: summaries,
          manifestPath,
        },
        null,
        2,
      )}\n`,
      { mode: 0o600 },
    );
    console.log(`Migration ${mode} complete: ${JSON.stringify(totals)}`);
    console.log(`Manifest: ${manifestPath}`);
    console.log(`Summary: ${summaryPath}`);
    if (cacheInvalidationError) {
      throw new Error(`Migration completed, but cache invalidation failed: ${cacheInvalidationError}`);
    }
  } finally {
    fs.closeSync(manifestFd);
    await mongoose.disconnect();
  }
}

main().catch(async (error) => {
  console.error(error);
  await mongoose.disconnect();
  process.exit(1);
});
