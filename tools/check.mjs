// Quick checks on dist/ after the build: every page and asset is there, every internal link goes
// somewhere real, no canvas-only markup or outside resource is left, and the bundle stays small.
import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ROUTES } from './routes.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dist = join(root, 'dist');
const problems = [];
const fail = (msg) => problems.push(msg);

const boards = readFileSync(join(dist, 'boards.js'), 'utf8');
const pages = new Set(Object.values(ROUTES));

for (const [name, path] of Object.entries(ROUTES)) {
  if (!existsSync(join(dist, path, 'index.html'))) fail(`no page for ${name} at ${path}`);
  if (!boards.includes(`window.DCB[${JSON.stringify(name)}]`)) fail(`${name} is missing from boards.js`);
}
const left = [...boards.matchAll(/href=\\"([^"\\]*\.dc\.html[^"\\]*)\\"/g)].map((m) => m[1]);
if (left.length) fail(`canvas links left: ${[...new Set(left)].join(', ')}`);
if (boards.includes('/_blob/')) fail('a canvas upload path (/_blob/) is left');
if (/ on[a-z]+=\\"/i.test(boards)) fail('an inline event handler attribute is left in a board');
if (/fonts\.(googleapis|gstatic)\.com/.test(boards)) fail('a Google Fonts link is left');
if (/<script[\s>]/.test(boards.replace(/<\\\/script>/g, ''))) fail('a <script> tag is left inside a board');

// Internal links: a page path (with or without #anchor), or a file in dist/.
for (const m of boards.matchAll(/(?:href|src)=\\"(\/[^"\\#]*)(#[^"\\]*)?\\"/g)) {
  const path = m[1];
  const ok = pages.has(path) || (path !== '/' && existsSync(join(dist, path)) && statSync(join(dist, path)).isFile());
  if (!ok) fail(`internal link or asset not found: ${path}`);
}
for (const f of ['runtime.js', 'css/fonts.css', 'css/v2.css', 'css/site.css', 'favicon.svg', 'fonts/instrument-sans-latin-wght-normal.woff2', 'fonts/jetbrains-mono-latin-wght-normal.woff2', 'img/android-focus-question.png']) {
  if (!existsSync(join(dist, f))) fail(`missing ${f}`);
}
const kb = Math.round(statSync(join(dist, 'boards.js')).size / 1024);
if (kb > 900) fail(`boards.js is ${kb} KB, over the 900 KB budget`);

if (problems.length) {
  console.error('check: ' + problems.length + ' problem(s)\n- ' + problems.join('\n- '));
  process.exit(1);
}
console.log(`check: ${pages.size} pages, every link and asset resolves, boards.js ${kb} KB`);
