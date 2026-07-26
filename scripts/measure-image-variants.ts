
import { mkdirSync, readFileSync, writeFileSync } from 'fs';
import { basename, extname, join } from 'path';
import {
  renderImageSet,
  renderThumbhash,
} from '../src/modules/image-upload/image-variants';

const kb = (bytes: number) => `${(bytes / 1024).toFixed(1)} KB`;

async function main() {
  const args = process.argv.slice(2);
  const outDir = args
    .find((arg) => arg.startsWith('--out='))
    ?.slice('--out='.length);
  const files = args.filter((arg) => !arg.startsWith('--'));

  if (files.length === 0) {
    console.error('Pass at least one image path.');
    process.exit(1);
  }
  if (outDir) mkdirSync(outDir, { recursive: true });

  for (const file of files) {
    const original = readFileSync(file);
    const set = await renderImageSet(original);
    const thumbhash = await renderThumbhash(original);

    console.log(
      `\n${basename(file)}  ${kb(original.length)} original, ${set.width}x${set.height}`,
    );

    for (const variant of set.variants) {
      console.log(
        `  ${String(variant.width).padStart(4)}px  ${kb(variant.buffer.length).padStart(9)}` +
          `  ${(original.length / variant.buffer.length).toFixed(0)}x smaller`,
      );

      if (outDir) {
        const stem = basename(file, extname(file));
        writeFileSync(
          join(outDir, `${stem}-${variant.width}.webp`),
          variant.buffer,
        );
      }
    }

    console.log(`  thumbhash: ${thumbhash?.length ?? 0} base64 chars`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
