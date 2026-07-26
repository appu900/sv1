/**
 * One-off equivalence check: runs the vendored ThumbHash encoder and the upstream
 * ESM package over the same deterministic inputs and reports byte differences.
 *
 * Compile the vendored module to ESM first, then point this script at it:
 *
 *   npx tsc src/modules/image-upload/thumbhash.ts --outDir /tmp/thumbhash-port \
 *     --module esnext --target es2022 --moduleResolution bundler
 *   VENDORED=/tmp/thumbhash-port/thumbhash.js node scripts/verify-thumbhash-port.mjs
 */
import { pathToFileURL } from 'node:url';
import { rgbaToThumbHash as upstream } from 'thumbhash';

const vendoredPath = process.env.VENDORED;
if (!vendoredPath) {
  console.error('Set VENDORED to the compiled thumbhash module path.');
  process.exit(2);
}
const { rgbaToThumbHash: vendored } = await import(
  pathToFileURL(vendoredPath).href
);

function buildCases() {
  const cases = [];

  // Deterministic pseudo-random gradient, fully opaque.
  const opaque = (w, h) => {
    const rgba = new Uint8Array(w * h * 4);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = (x + y * w) * 4;
        rgba[i] = (x * 7 + y * 3) % 256;
        rgba[i + 1] = (x * 3 + y * 11) % 256;
        rgba[i + 2] = (x * 13 + y * 5) % 256;
        rgba[i + 3] = 255;
      }
    }
    return { w, h, rgba };
  };

  // Transparent border with an opaque center, like an ingredient hero.
  const withAlpha = (w, h) => {
    const rgba = new Uint8Array(w * h * 4);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = (x + y * w) * 4;
        const inside =
          x > w * 0.2 && x < w * 0.8 && y > h * 0.2 && y < h * 0.8;
        rgba[i] = 220;
        rgba[i + 1] = 90;
        rgba[i + 2] = 40;
        rgba[i + 3] = inside ? 255 : 0;
      }
    }
    return { w, h, rgba };
  };

  cases.push(['square opaque 100x100', opaque(100, 100)]);
  cases.push(['landscape opaque 100x60', opaque(100, 60)]);
  cases.push(['portrait opaque 60x100', opaque(60, 100)]);
  cases.push(['tiny opaque 3x3', opaque(3, 3)]);
  cases.push(['square alpha 100x100', withAlpha(100, 100)]);
  cases.push(['landscape alpha 90x40', withAlpha(90, 40)]);
  cases.push(['portrait alpha 40x90', withAlpha(40, 90)]);
  return cases;
}

let failures = 0;
for (const [name, { w, h, rgba }] of buildCases()) {
  const expected = Buffer.from(upstream(w, h, rgba)).toString('base64');
  const actual = Buffer.from(vendored(w, h, rgba)).toString('base64');
  const ok = expected === actual;
  if (!ok) failures++;
  console.log(
    `${ok ? 'MATCH' : 'DIFF '}  ${name.padEnd(26)}  upstream=${expected}  vendored=${actual}`,
  );
}

console.log(`\n${failures === 0 ? 'All cases match upstream.' : `${failures} case(s) differ.`}`);
process.exit(failures === 0 ? 0 : 1);
