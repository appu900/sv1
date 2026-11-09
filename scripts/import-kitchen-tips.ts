/**
 * Imports Kitchen Tips from a CSV manifest plus a folder of images (the 68
 * tip pictures in the design folder). Column list: src/modules/hack/tip-import.ts.
 *
 * Dry run by default: checks every row (categories, ingredients, sponsor,
 * image, repeated titles) and writes a CSV report. Nothing is changed.
 * With --apply it uploads each image (original as the hero, a 480 px WebP as
 * the card thumbnail) and creates the tip. A tip whose title already exists
 * is skipped unless --update is given, which updates it in place.
 *
 *   npm run import:kitchen-tips -- <manifest.csv> --images=<folder>
 *   npm run import:kitchen-tips -- <manifest.csv> --images=<folder> --apply
 *   npm run import:kitchen-tips -- <manifest.csv> --images=<folder> --apply --update
 *   options: --report=path.csv
 *
 * Rows with problems are never imported. Categories and sponsors must exist
 * in the admin panel first. Tip lists refresh in the app within 30 minutes
 * (cache), or clear the Redis keys hacks:* to see them at once.
 */
import * as dotenv from 'dotenv';
import * as fs from 'fs/promises';
import * as path from 'path';
import { randomUUID } from 'crypto';
import * as mongoose from 'mongoose';
import type { Sharp, SharpInput, SharpOptions } from 'sharp';
import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { Hacks, HackSchema } from '../src/database/schemas/hacks.schema';
import { Hackscategory, HacksCategorySchema } from '../src/database/schemas/hacks.category.schema';
import { Sponsers, SponsersSchema } from '../src/database/schemas/sponsers.schema';
import { Ingredient, IngredientSchema } from '../src/database/schemas/ingredient.schema';
import { buildCdnAssetUrl } from '../src/common/utils/image-url-migration';
import { buildNameIndex } from '../src/modules/ingredients/ingredient-image-match';
import {
  duplicateTitles,
  ImportLookups,
  parseCsv,
  readManifest,
  resolveRow,
} from '../src/modules/hack/tip-import';

dotenv.config({ path: path.resolve(__dirname, '../.env') });

// sharp is CommonJS and this repo has no esModuleInterop (same as image-variants.ts).
// eslint-disable-next-line @typescript-eslint/no-require-imports
const sharp: (input?: SharpInput, options?: SharpOptions) => Sharp = require('sharp');

function option(name: string): string | undefined {
  const hit = process.argv.find(a => a.startsWith(`--${name}=`));
  return hit?.slice(name.length + 3);
}

function csv(value: string): string {
  return /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

async function listImages(dir: string): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      for (const [k, v] of await listImages(full)) if (!out.has(k)) out.set(k, v);
    } else if (/\.(png|jpe?g|webp)$/i.test(entry.name)) {
      out.set(entry.name.toLowerCase(), full);
    }
  }
  return out;
}

async function main() {
  const manifestPath = process.argv.slice(2).find(a => !a.startsWith('--'));
  if (!manifestPath) throw new Error('Usage: import-kitchen-tips <manifest.csv> --images=<folder> [--apply] [--update]');
  const apply = process.argv.includes('--apply');
  const update = process.argv.includes('--update');
  const imagesDir = option('images');
  const reportPath = option('report') ?? path.resolve(process.cwd(), 'kitchen-tips-report.csv');

  const rows = readManifest(parseCsv(await fs.readFile(path.resolve(manifestPath), 'utf8')));
  const imageFiles = imagesDir ? await listImages(path.resolve(imagesDir)) : new Map<string, string>();

  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error('MONGODB_URI is not set');
  await mongoose.connect(uri, { dbName: process.env.MONGODB_DBNAME || 'saveful' });
  const HackModel = mongoose.model(Hacks.name, HackSchema);
  const CategoryModel = mongoose.model(Hackscategory.name, HacksCategorySchema);
  const SponsorModel = mongoose.model(Sponsers.name, SponsersSchema);
  const IngredientModel = mongoose.model(Ingredient.name, IngredientSchema);

  const [categories, sponsors, ingredients, tips] = await Promise.all([
    CategoryModel.find().select({ name: 1 }).lean(),
    SponsorModel.find().select({ title: 1 }).lean(),
    IngredientModel.find().select({ name: 1, aliases: 1 }).lean(),
    HackModel.find().select({ title: 1 }).lean(),
  ]);
  const lookups: ImportLookups = {
    categories: new Map(categories.map((c: any) => [String(c.name).trim().toLowerCase(), String(c._id)])),
    sponsors: new Map(sponsors.map((s: any) => [String(s.title).trim().toLowerCase(), String(s._id)])),
    ingredients: buildNameIndex(ingredients.map((i: any) => ({ id: String(i._id), name: i.name, aliases: i.aliases }))),
    existingTips: new Map(tips.map((t: any) => [String(t.title).trim().toLowerCase(), String(t._id)])),
    images: new Set(imageFiles.keys()),
  };

  const dupes = duplicateTitles(rows);
  const resolved = rows.map(row => {
    const r = resolveRow(row, lookups);
    if (dupes.has(row.title.toLowerCase())) r.problems.push('title repeated in the manifest');
    return r;
  });

  const status = (r: (typeof resolved)[number]) =>
    r.problems.length > 0 ? 'error' : r.existingId ? (update ? 'update' : 'skip') : 'create';
  const report = [['line', 'title', 'status', 'problems', 'category_ids', 'ingredient_ids', 'sponsor_id']];
  for (const r of resolved) {
    report.push([
      String(r.row.line),
      r.row.title,
      status(r),
      r.problems.join('; ') || (status(r) === 'skip' ? 'already exists (use --update)' : ''),
      r.categoryIds.join(' '),
      r.ingredientIds.join(' '),
      r.sponsorId ?? '',
    ]);
  }
  await fs.writeFile(reportPath, report.map(r => r.map(csv).join(',')).join('\n') + '\n');
  const counts = resolved.reduce<Record<string, number>>((acc, r) => ((acc[status(r)] = (acc[status(r)] ?? 0) + 1), acc), {});
  console.log(`${rows.length} row(s): ${JSON.stringify(counts)}. Report: ${reportPath}`);

  if (!apply) {
    console.log('Dry run: nothing changed. Fix the errors in the report, then run again with --apply.');
    await mongoose.disconnect();
    return;
  }

  const todo = resolved.filter(r => status(r) === 'create' || status(r) === 'update');
  const needsUpload = todo.some(r => r.row.image);
  const bucket = process.env.AWS_BUCKET_NAME;
  if (needsUpload && !bucket) throw new Error('AWS_BUCKET_NAME is not set');
  const s3 = new S3Client({ region: process.env.AWS_REGION ?? 'ap-southeast-2' });
  const cdnBase = process.env.CDN_BASE_URL ?? 'https://cdn.saveful.app';
  const put = async (key: string, body: Buffer, type: string) => {
    await s3.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: key,
        Body: body,
        ContentType: type,
        CacheControl: 'public, max-age=31536000, immutable',
      }),
    );
    return buildCdnAssetUrl(key, cdnBase);
  };

  let ok = 0;
  let failed = 0;
  for (const r of todo) {
    try {
      const images: { heroImageUrl?: string; thumbnailImageUrl?: string } = {};
      const file = r.row.image ? imageFiles.get(r.row.image.toLowerCase()) : undefined;
      if (file) {
        const buffer = await fs.readFile(file);
        const ext = path.extname(file).slice(1).toLowerCase() || 'png';
        const type = ext === 'png' ? 'image/png' : ext === 'webp' ? 'image/webp' : 'image/jpeg';
        images.heroImageUrl = await put(`saveful/hacks/hero-images/${randomUUID()}.${ext}`, buffer, type);
        const thumb = await sharp(buffer).resize({ width: 480, withoutEnlargement: true }).webp({ quality: 80 }).toBuffer();
        images.thumbnailImageUrl = await put(`saveful/hacks/thumbnails/${randomUUID()}.webp`, thumb, 'image/webp');
      }
      const fields = {
        title: r.row.title,
        ...(r.row.shortDescription !== undefined ? { shortDescription: r.row.shortDescription } : {}),
        categoryId: new mongoose.Types.ObjectId(r.categoryIds[0]),
        categoryIds: r.categoryIds.map(id => new mongoose.Types.ObjectId(id)),
        keywords: r.row.keywords,
        ingredientIds: r.ingredientIds.map(id => new mongoose.Types.ObjectId(id)),
        ...(r.sponsorId ? { sponsorId: new mongoose.Types.ObjectId(r.sponsorId) } : {}),
        ...(r.row.order !== undefined ? { order: r.row.order } : {}),
        ...images,
      };
      if (r.existingId) {
        await HackModel.updateOne({ _id: r.existingId }, { $set: fields });
        console.log(`UPDATED line ${r.row.line}: ${r.row.title}`);
      } else {
        await HackModel.create({ ...fields, articleBlocks: [] });
        console.log(`CREATED line ${r.row.line}: ${r.row.title}`);
      }
      ok++;
    } catch (error) {
      failed++;
      console.error(`FAIL line ${r.row.line} (${r.row.title}): ${(error as Error).message}`);
    }
  }

  console.log(`Done. saved=${ok} failed=${failed}. Tip lists refresh within 30 minutes, or clear Redis keys hacks:*.`);
  await mongoose.disconnect();
  process.exit(failed > 0 ? 1 : 0);
}

main().catch(async error => {
  console.error(error);
  await mongoose.disconnect().catch(() => undefined);
  process.exit(1);
});
