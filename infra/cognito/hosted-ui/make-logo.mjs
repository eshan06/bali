// Draws the sign-in page's two logos, logo-dev.png and logo-prod.png: the Bali lockup of
// docs/DESIGN.md (the mark, bare, beside "Bali" in Instrument Sans 600), dev's with a Dev tag so a
// tester knows which pool they are on. A transparent 140 x 32 px canvas drawn at 3x, so it is
// sharp on a phone when Cognito shows it at 140 px (hosted-ui.css, .logo-customizable).
//
// The mark's one source is apps/web/public/icon.svg (its stone-50 tile dropped, as the
// B artboards draw the lockup). The font comes from Google Fonts at draw time, Chromium from the
// Playwright CLI's own package (never a dependency; docs/DESIGN.md). Run from the repo:
//
//   npx --yes playwright@1.63.0 install chromium   # once
//   node infra/cognito/hosted-ui/make-logo.mjs
import { execFileSync } from 'node:child_process';
import { readFileSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..', '..', '..');

// The CLI's package, fetched into npx's cache if it is not there yet; its `playwright` lives two
// directories above the bin that npx puts on PATH.
const bin = execFileSync(
  'npx',
  ['--yes', '-p', 'playwright@1.63.0', '-c', 'command -v playwright'],
  {
    encoding: 'utf8',
  },
).trim();
const { chromium } = createRequire(import.meta.url)(resolve(bin, '..', '..', 'playwright'));

const icon = readFileSync(resolve(root, 'apps/web/public/icon.svg'), 'utf8');
const mark = icon.replace(/<rect[^>]*\/>\s*/, '').replace(
  /width="1024" height="1024" viewBox="0 0 1024 1024"/,
  'width="32" height="32" viewBox="222 222 580 580"', // the ring's box: 512 +/- (240 + 50)
);
if (/<rect/.test(mark) || !/viewBox="222 222 580 580"/.test(mark)) {
  throw new Error('apps/web/public/icon.svg changed shape; update make-logo.mjs to match');
}

const page = (dev) => `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Instrument+Sans:wght@600&display=block">
<style>
  body { margin: 0; background: transparent; }
  .lockup { width: 140px; height: 32px; display: flex; align-items: center; justify-content: center;
    gap: 8px; font-family: 'Instrument Sans', sans-serif; -webkit-font-smoothing: antialiased; }
  svg { flex-shrink: 0; }
  .word { font-size: 24px; line-height: 30px; font-weight: 600; color: #211f1b; }
  .tag { font-size: 12px; line-height: 16px; font-weight: 600; letter-spacing: 0.06em;
    text-transform: uppercase; color: #6b665d; background: #efece7; border-radius: 6px; padding: 2px 8px; }
</style></head>
<body><div class="lockup">${mark}<span class="word">Bali</span>${dev ? '<span class="tag">Dev</span>' : ''}</div></body></html>`;

const browser = await chromium.launch();
try {
  const context = await browser.newContext({
    viewport: { width: 140, height: 32 },
    deviceScaleFactor: 3,
  });
  for (const env of ['dev', 'prod']) {
    const tab = await context.newPage();
    await tab.setContent(page(env === 'dev'), { waitUntil: 'networkidle' });
    const loaded = await tab.evaluate(
      `[...document.fonts].some((f) => f.family.includes('Instrument Sans') && f.status === 'loaded')`,
    );
    if (!loaded) throw new Error('Instrument Sans did not load from Google Fonts (offline?)');
    const width = await tab.evaluate(`document.querySelector('.lockup').scrollWidth`);
    if (width > 140)
      throw new Error(`the ${env} lockup is ${width} px wide, over the 140 px canvas`);
    const path = resolve(here, `logo-${env}.png`);
    await tab.screenshot({ path, omitBackground: true });
    console.log(`${path}  ${statSync(path).size} bytes`);
  }
} finally {
  await browser.close();
}
