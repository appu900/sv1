import * as dotenv from 'dotenv';
import * as path from 'path';
import * as mongoose from 'mongoose';
import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { Recipe, RecipeSchema } from '../src/database/schemas/recipe.schema';
import {
  Ingredient,
  IngredientSchema,
} from '../src/database/schemas/ingredient.schema';
import { renderImageSet } from '../src/modules/image-upload/image-variants';

dotenv.config({ path: path.resolve(__dirname, '../.env') });

interface Options {
  dryRun: boolean;
  force: boolean;
  concurrency: number;
  limit?: number;
  collections: Array<'recipes' | 'ingredients'>;
}

interface Target {
  collection: string;
  id: string;
  label: string;
  heroImageUrl: string;
}

function parseOptions(argv: string[]): Options {
  const flag = (name: string) => argv.includes(`--${name}`);
  const value = (name: string) => {
    const match = argv.find(arg => arg.startsWith(`--${name}=`));
    return match?.slice(name.length + 3);
  };

  const requested = value('collection');
  const collections: Options['collections'] =
    requested === 'recipes'
      ? ['recipes']
      : requested === 'ingredients'
        ? ['ingredients']
        : ['recipes', 'ingredients'];

  const limit = Number(value('limit'));
  const concurrency = Number(value('concurrency'));

  return {
    dryRun: flag('dry-run'),
    force: flag('force'),

    concurrency:
      Number.isFinite(concurrency) && concurrency > 0
        ? Math.min(concurrency, 8)
        : 3,
    limit: Number.isFinite(limit) && limit > 0 ? limit : undefined,
    collections,
  };
}

function requireEnv(name: string): string {
  const found = process.env[name];
  if (!found) throw new Error(`${name} is not set`);
  return found;
}

const cdnBaseUrl = (
  process.env.CDN_BASE_URL ?? 'https://cdn.saveful.app'
).replace(/\/+$/, '');

function publicUrl(key: string): string {
  return `${cdnBaseUrl}/${key.split('/').map(encodeURIComponent).join('/')}`;
}

function keyFromUrl(url: string, bucket: string): string | null {
  try {
    const parsed = new URL(url);
    let key = decodeURIComponent(parsed.pathname.replace(/^\/+/, ''));

    if (
      parsed.hostname.startsWith('s3.') &&
      parsed.hostname.endsWith('.amazonaws.com') &&
      key.startsWith(`${bucket}/`)
    ) {
      key = key.slice(bucket.length + 1);
    }

    const cdnPath = new URL(cdnBaseUrl).pathname.replace(/^\/+|\/+$/g, '');
    if (cdnPath && key.startsWith(`${cdnPath}/`)) {
      key = key.slice(cdnPath.length + 1);
    }

    return key || null;
  } catch {
    return null;
  }
}

async function download(url: string): Promise<Buffer> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} fetching ${url}`);
  }
  return Buffer.from(await response.arrayBuffer());
}

/** Runs tasks with a bounded worker pool, preserving per-task isolation. */
async function pooled<T>(
  items: T[],
  concurrency: number,
  worker: (item: T) => Promise<void>,
): Promise<void> {
  let cursor = 0;
  const runners = Array.from(
    { length: Math.min(concurrency, items.length) },
    async () => {
      while (cursor < items.length) {
        const index = cursor++;
        await worker(items[index]);
      }
    },
  );
  await Promise.all(runners);
}

async function main() {
  const options = parseOptions(process.argv.slice(2));
  const uri = requireEnv('MONGODB_URI');
  const dbName = process.env.MONGODB_DBNAME || 'saveful';
  const bucket = requireEnv('AWS_BUCKET_NAME');
  const region = process.env.AWS_REGION ?? 'ap-southeast-2';

  const s3 = new S3Client({ region });

  await mongoose.connect(uri, { dbName });
  console.log(
    `Connected to ${dbName}. collections=${options.collections.join(',')} ` +
      `concurrency=${options.concurrency} dryRun=${options.dryRun} force=${options.force}`,
  );

  const RecipeModel = mongoose.model(Recipe.name, RecipeSchema);
  const IngredientModel = mongoose.model(Ingredient.name, IngredientSchema);

  const models: Record<string, mongoose.Model<any>> = {
    recipes: RecipeModel,
    ingredients: IngredientModel,
  };

  const targets: Target[] = [];
  for (const collection of options.collections) {
    const model = models[collection];
    const query: Record<string, unknown> = {
      heroImageUrl: { $exists: true, $nin: [null, ''] },
    };
    // Idempotence: documents that already carry variants are left alone unless
    // --force is passed (useful after changing the width ladder or quality).
    if (!options.force) {
      query['heroImage.variants'] = { $in: [null, undefined, {}] };
    }

    const rows = await model
      .find(query)
      .select({ _id: 1, heroImageUrl: 1, title: 1, name: 1 })
      .lean();

    for (const row of rows) {
      targets.push({
        collection,
        id: String(row._id),
        label: String(row.title ?? row.name ?? row._id),
        heroImageUrl: String(row.heroImageUrl),
      });
    }
  }

  const work = options.limit ? targets.slice(0, options.limit) : targets;
  console.log(`${work.length} document(s) need variants\n`);

  let done = 0;
  let skipped = 0;
  let failed = 0;
  let bytesWritten = 0;

  await pooled(work, options.concurrency, async target => {
    const prefix = `[${target.collection}/${target.label}]`;
    try {
      const originalKey = keyFromUrl(target.heroImageUrl, bucket);
      if (!originalKey) {
        console.warn(`${prefix} SKIP unparseable URL ${target.heroImageUrl}`);
        skipped++;
        return;
      }

      const source = await download(target.heroImageUrl);
      const rendered = await renderImageSet(source);

      // Variant keys are derived from the original key so they can be located
      // and cleaned up later without reading the document.
      const variantPrefix = originalKey.replace(/\.[^/.]+$/, '');
      const variants: Record<string, string> = {};
      let written = 0;

      for (const variant of rendered.variants) {
        const key = `${variantPrefix}/${variant.width}.webp`;
        if (!options.dryRun) {
          await s3.send(
            new PutObjectCommand({
              Bucket: bucket,
              Key: key,
              Body: variant.buffer,
              ContentType: 'image/webp',
              CacheControl: 'public, max-age=31536000, immutable',
            }),
          );
        }
        variants[String(variant.width)] = publicUrl(key);
        written += variant.buffer.length;
      }

      const heroImage = {
        base: target.heroImageUrl,
        variants,
        width: rendered.width,
        height: rendered.height,
        thumbhash: rendered.thumbhash,
      };

      if (!options.dryRun) {
        // Committed per document, so an interrupted run resumes cleanly.
        await models[target.collection].updateOne(
          { _id: target.id },
          { $set: { heroImage } },
        );
      }

      bytesWritten += written;
      done++;
      console.log(
        `${prefix} ${options.dryRun ? 'DRY ' : 'OK   '}` +
          `${rendered.width}x${rendered.height} -> ${rendered.variants.length} variants, ` +
          `${(source.length / 1024).toFixed(0)} KB source -> ${(written / 1024).toFixed(0)} KB total`,
      );
    } catch (error: unknown) {
      failed++;
      const message = error instanceof Error ? error.message : String(error);
      console.error(`${prefix} FAIL ${message}`);
    }
  });

  console.log(
    `\nDone. processed=${done} skipped=${skipped} failed=${failed} ` +
      `written=${(bytesWritten / 1024 / 1024).toFixed(1)} MB`,
  );

  await mongoose.disconnect();
  process.exit(failed > 0 ? 1 : 0);
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
