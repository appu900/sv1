/**
 * Imports ingredient pictures from the design folder ("Ingredient images",
 * 1,333 PNGs sorted into A–W sub-folders) onto ingredient records.
 *
 * Dry run by default: matches each file name to an ingredient by name or
 * alias and writes a CSV report (matched / ambiguous / unmatched / skipped)
 * for review. With --apply it uploads the original plus WebP variants to S3
 * (same layout as admin uploads) and sets heroImageUrl and heroImage.
 *
 *   npm run import:ingredient-images -- <folder>                 # report only
 *   npm run import:ingredient-images -- <folder> --apply          # fill missing pictures
 *   npm run import:ingredient-images -- <folder> --apply --force  # also replace existing
 *   options: --report=path.csv  --concurrency=4  --limit=50
 *
 * Afterwards, bump the "ingredients" data version (admin) so apps refetch.
 */
import * as dotenv from 'dotenv';
import * as fs from 'fs/promises';
import * as path from 'path';
import { randomUUID } from 'crypto';
import * as mongoose from 'mongoose';
import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { Ingredient, IngredientSchema } from '../src/database/schemas/ingredient.schema';
import { renderImageSet } from '../src/modules/image-upload/image-variants';
import { buildCdnAssetUrl } from '../src/common/utils/image-url-migration';
import {
  buildNameIndex,
  isNumberedCopy,
  matchImageFile,
} from '../src/modules/ingredients/ingredient-image-match';

dotenv.config({ path: path.resolve(__dirname, '../.env') });

const FOLDER = 'saveful/ingredients/hero';

function option(name: string): string | undefined {
  const hit = process.argv.find(a => a.startsWith(`--${name}=`));
  return hit?.slice(name.length + 3);
}

async function listImages(dir: string): Promise<string[]> {
  const out: string[] = [];
  for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await listImages(full)));
    else if (/\.(png|jpe?g|webp)$/i.test(entry.name)) out.push(full);
  }
  return out.sort((a, b) => path.basename(a).localeCompare(path.basename(b)));
}

function csv(value: string): string {
  return /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

async function pooled<T>(items: T[], concurrency: number, worker: (item: T) => Promise<void>) {
  let cursor = 0;
  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, async () => {
      while (cursor < items.length) await worker(items[cursor++]);
    }),
  );
}

async function main() {
  const folder = process.argv.slice(2).find(a => !a.startsWith('--'));
  if (!folder) throw new Error('Usage: import-ingredient-images <folder> [--apply] [--force]');
  const apply = process.argv.includes('--apply');
  const force = process.argv.includes('--force');
  const concurrency = Math.min(8, Math.max(1, Number(option('concurrency')) || 4));
  const limit = Number(option('limit')) || undefined;
  const reportPath = option('report') ?? path.resolve(process.cwd(), 'ingredient-image-report.csv');

  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error('MONGODB_URI is not set');
  await mongoose.connect(uri, { dbName: process.env.MONGODB_DBNAME || 'saveful' });
  const IngredientModel = mongoose.model(Ingredient.name, IngredientSchema);

  const ingredients = await IngredientModel.find().select({ name: 1, aliases: 1, heroImageUrl: 1 }).lean();
  const index = buildNameIndex(
    ingredients.map((i: any) => ({ id: String(i._id), name: i.name, aliases: i.aliases })),
  );
  const hasImage = new Map(ingredients.map((i: any) => [String(i._id), !!i.heroImageUrl]));
  const nameOf = new Map(ingredients.map((i: any) => [String(i._id), i.name as string]));

  const files = await listImages(path.resolve(folder));
  const rows: string[][] = [['file', 'status', 'ingredient_id', 'ingredient_name', 'matched_on', 'note']];
  const work: { file: string; id: string }[] = [];
  const claimed = new Set<string>();

  // Plain files first so a "(2)" copy never wins over the original.
  const ordered = [...files].sort((a, b) => Number(isNumberedCopy(a)) - Number(isNumberedCopy(b)));
  for (const file of ordered) {
    const name = path.basename(file);
    const match = matchImageFile(name, index);
    if (match.status === 'unmatched') {
      rows.push([name, 'unmatched', '', '', '', '']);
    } else if (match.status === 'ambiguous') {
      rows.push([name, 'ambiguous', match.ids.join(' '), match.ids.map(id => nameOf.get(id) ?? '').join(' | '), match.via, '']);
    } else if (claimed.has(match.id)) {
      rows.push([name, 'skipped', match.id, nameOf.get(match.id) ?? '', match.via, 'another file already matched']);
    } else if (hasImage.get(match.id) && !force) {
      claimed.add(match.id);
      rows.push([name, 'skipped', match.id, nameOf.get(match.id) ?? '', match.via, 'already has a picture (use --force)']);
    } else {
      claimed.add(match.id);
      rows.push([name, 'matched', match.id, nameOf.get(match.id) ?? '', match.via, apply ? 'uploading' : '']);
      work.push({ file, id: match.id });
    }
  }

  await fs.writeFile(reportPath, rows.map(r => r.map(csv).join(',')).join('\n') + '\n');
  const counts = rows.slice(1).reduce<Record<string, number>>((acc, r) => ((acc[r[1]] = (acc[r[1]] ?? 0) + 1), acc), {});
  console.log(`${files.length} file(s): ${JSON.stringify(counts)}. Report: ${reportPath}`);

  if (!apply) {
    console.log('Dry run: nothing uploaded. Review the report, then run again with --apply.');
    await mongoose.disconnect();
    return;
  }

  const bucket = process.env.AWS_BUCKET_NAME;
  if (!bucket) throw new Error('AWS_BUCKET_NAME is not set');
  const s3 = new S3Client({ region: process.env.AWS_REGION ?? 'ap-southeast-2' });
  const cdnBase = process.env.CDN_BASE_URL ?? 'https://cdn.saveful.app';
  const put = (key: string, body: Buffer, type: string) =>
    s3.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: key,
        Body: body,
        ContentType: type,
        CacheControl: 'public, max-age=31536000, immutable',
      }),
    );

  let ok = 0;
  let failed = 0;
  const todo = limit ? work.slice(0, limit) : work;
  await pooled(todo, concurrency, async ({ file, id }) => {
    try {
      const buffer = await fs.readFile(file);
      const ext = path.extname(file).slice(1).toLowerCase() || 'png';
      const uid = randomUUID();
      const originalKey = `${FOLDER}/${uid}.${ext}`;
      await put(originalKey, buffer, ext === 'png' ? 'image/png' : ext === 'webp' ? 'image/webp' : 'image/jpeg');
      const base = buildCdnAssetUrl(originalKey, cdnBase);

      const rendered = await renderImageSet(buffer);
      const variants: Record<string, string> = {};
      for (const variant of rendered.variants) {
        const key = `${FOLDER}/${uid}/${variant.width}.webp`;
        await put(key, variant.buffer, 'image/webp');
        variants[String(variant.width)] = buildCdnAssetUrl(key, cdnBase);
      }
      await IngredientModel.updateOne(
        { _id: id },
        {
          $set: {
            heroImageUrl: base,
            heroImage: { base, variants, width: rendered.width, height: rendered.height, thumbhash: rendered.thumbhash },
          },
        },
      );
      ok++;
      console.log(`OK   ${path.basename(file)} -> ${nameOf.get(id)}`);
    } catch (error) {
      failed++;
      console.error(`FAIL ${path.basename(file)}: ${(error as Error).message}`);
    }
  });

  console.log(`Done. uploaded=${ok} failed=${failed}. Bump the ingredients data version so apps refetch.`);
  await mongoose.disconnect();
  process.exit(failed > 0 ? 1 : 0);
}

main().catch(async error => {
  console.error(error);
  await mongoose.disconnect().catch(() => undefined);
  process.exit(1);
});
