// PDF.js's worker and the image decoders it loads, served from the portal's own origin (Phase 7,
// M6): the CSP's worker-src names only 'self', and no CDN serves code to the portal. Copied from the
// installed pdfjs-dist, the version package.json pins, into public/pdfjs/ (gitignored) before each
// `npm run dev` and `npm run build` (predev, prebuild), so they are always the library's own files
// at the library's version. src/lib/deck-pdf.ts loads them; the middleware gives them their CSP.
import { copyFileSync, mkdirSync, realpathSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import process from 'node:process';
import { fileURLToPath, URL } from 'node:url';

/** Each file served under /pdfjs/, by its name there, from its path in pdfjs-dist. */
export const PDFJS_ASSETS = {
  // The legacy build's worker, as the portal imports the legacy build (deck-pdf.ts says why).
  'pdf.worker.min.mjs': 'legacy/build/pdf.worker.min.mjs',
  // The JavaScript builds of its JBIG2 and CCITT, and JPEG 2000, decoders: with WebAssembly off,
  // the worker imports them from `wasmUrl` by these names.
  'jbig2_nowasm_fallback.js': 'wasm/jbig2_nowasm_fallback.js',
  'openjpeg_nowasm_fallback.js': 'wasm/openjpeg_nowasm_fallback.js',
  // Their licences, which a copy carries.
  LICENSE: 'LICENSE',
  LICENSE_JBIG2: 'wasm/LICENSE_JBIG2',
  LICENSE_PDFJS_JBIG2: 'wasm/LICENSE_PDFJS_JBIG2',
  LICENSE_OPENJPEG: 'wasm/LICENSE_OPENJPEG',
  LICENSE_PDFJS_OPENJPEG: 'wasm/LICENSE_PDFJS_OPENJPEG',
};

/** pdfjs-dist's folder, as this workspace resolves it. */
export const pdfjsDist = () =>
  dirname(createRequire(import.meta.url).resolve('pdfjs-dist/package.json'));

/** Copy them into `to`, emptied first, so a file an older version served never lingers. */
export function copyPdfjsAssets(to = fileURLToPath(new URL('../public/pdfjs/', import.meta.url))) {
  const from = pdfjsDist();
  rmSync(to, { recursive: true, force: true });
  mkdirSync(to, { recursive: true });
  for (const [name, path] of Object.entries(PDFJS_ASSETS)) {
    copyFileSync(join(from, path), join(to, name));
  }
}

// Run as a script (`node scripts/pdfjs-assets.mjs`), by any path to it, a link's too: copy. Imported
// (its test), nothing happens. A build that copied nothing fails anyway (next.config.ts).
const self = realpathSync.native(fileURLToPath(import.meta.url));
if (process.argv[1] && realpathSync.native(process.argv[1]) === self) copyPdfjsAssets();
