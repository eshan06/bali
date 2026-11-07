// Quick checks on dist/ after the build. Vercel runs them after every build, so a broken page fails the
// build and getbali.app keeps serving the last good version. The browser tests (tests/) go further.
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';
import { ROUTES } from './routes.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dist = join(root, 'dist');
const problems = [];
const fail = (msg) => problems.push(msg);
const uncomment = (css) => css.replace(/\/\*[\s\S]*?\*\//g, '');

// The bundle's boards, read without running any of them: each one's template, styles and stylesheets.
const sandbox = { window: {} };
runInNewContext(readFileSync(join(dist, 'boards.js'), 'utf8'), sandbox);
const DCB = sandbox.window.DCB || {};
const imports = (name) => [...(DCB[name]?.tpl || '').matchAll(/<dc-import name="([A-Za-z0-9]+)"/g)].map((m) => m[1] + '.dc.html');
const closure = (name, seen = new Set()) => {
  if (seen.has(name)) return seen;
  seen.add(name);
  for (const i of imports(name)) closure(i, seen);
  return seen;
};
const css = Object.fromEntries(readdirSync(join(dist, 'css')).filter((f) => f.endsWith('.css')).map((f) => [`/css/${f}`, readFileSync(join(dist, 'css', f), 'utf8')]));
const pages = new Set(Object.values(ROUTES));

for (const [name, path] of Object.entries(ROUTES)) {
  const file = join(dist, path, 'index.html');
  if (!existsSync(file)) {
    fail(`no page for ${name} at ${path}`);
    continue;
  }
  if (!DCB[name]) fail(`${name} is missing from boards.js`);
  for (const board of closure(name)) if (!DCB[board]) fail(`${board}, which ${name} imports, is missing from boards.js`);
  const html = readFileSync(file, 'utf8');
  // Each page links every stylesheet its boards use in its HTML, so it never paints unstyled.
  const linked = [...html.matchAll(/<link rel="stylesheet" href="([^"]+)"/g)].map((m) => m[1]);
  for (const board of closure(name)) for (const href of DCB[board]?.heads || []) if (!linked.includes(href)) fail(`${path} doesn't link ${href} in its HTML`);
  for (const href of linked) if (!css[href]) fail(`${path} links ${href}, which isn't in dist/`);
  // iPhone Safari enlarges small text on its own, and inside the scaled-down screen pictures that piles the
  // lines on top of each other (seen on the owner's iPhone, 2026-11-02). Each page turns that off.
  const pageCss = uncomment(linked.map((href) => css[href] || '').join('\n') + (DCB[name]?.helmet || ''));
  if (!/html\{[^}]*-webkit-text-size-adjust:100%[^}]*\}/.test(pageCss) || !/html\{[^}]*[^-]text-size-adjust:100%[^}]*\}/.test(pageCss)) fail(`${path} doesn't turn off iPhone Safari's text enlarging (html text-size-adjust: 100%)`);
  // The two states the canvas's SiteStates board draws: a page that didn't load, and JavaScript off.
  if (!/<template id="dc-error">[\s\S]*href="mailto:eshan\.shah@vanderbilt\.edu"[\s\S]*<\/template>/.test(html)) fail(`${path} is missing the state for a page that didn't load`);
  if (!/<noscript>[\s\S]*href="mailto:eshan\.shah@vanderbilt\.edu"[\s\S]*<\/noscript>/.test(html)) fail(`${path} is missing the state for JavaScript off`);
  if (/<script(?![^>]*\ssrc=)[^>]*>/.test(html)) fail(`${path} has an inline script (the security policy allows only our own files)`);
}

const tpls = Object.values(DCB).map((b) => b.tpl).join('\n');
const left = [...tpls.matchAll(/href="([^"]*\.dc\.html[^"]*)"/g)].map((m) => m[1]);
if (left.length) fail(`canvas links left: ${[...new Set(left)].join(', ')}`);
if (tpls.includes('/_blob/')) fail('a canvas upload path (/_blob/) is left');
if (/ on[a-z]+="/i.test(tpls)) fail('an inline event handler attribute is left in a board');
if (/fonts\.(googleapis|gstatic)\.com/.test(tpls + Object.values(DCB).map((b) => b.helmet).join('\n'))) fail('a Google Fonts link is left');
if (/<script[\s>]/.test(tpls + Object.values(DCB).map((b) => b.helmet).join('\n'))) fail('a <script> tag is left inside a board');
// With the enlarging off, iPhone Safari draws text inside CSS zoom at its full size, so the pictures scale
// with transform instead: no zoom in a stylesheet, a board's styles or an inline style.
const styles = uncomment([...Object.values(css), ...Object.values(DCB).flatMap((b) => [b.helmet, b.tpl])].join('\n'));
if (/[{;"]\s*zoom\s*:/.test(styles)) fail('a CSS zoom is left (iPhone Safari draws zoomed text at full size); scale with transform');

// Internal links: a page path (with or without #anchor), or a file in dist/.
for (const m of tpls.matchAll(/(?:href|src)="(\/[^"#]*)(#[^"]*)?"/g)) {
  const path = m[1];
  const ok = pages.has(path) || (path !== '/' && existsSync(join(dist, path)) && statSync(join(dist, path)).isFile());
  if (!ok) fail(`internal link or asset not found: ${path}`);
}
for (const f of ['runtime.js', 'css/fonts.css', 'css/v2.css', 'css/site.css', 'favicon.svg', 'fonts/instrument-sans-latin-wght-normal.woff2', 'fonts/jetbrains-mono-latin-wght-normal.woff2', 'img/android-focus-question.png']) {
  if (!existsSync(join(dist, f))) fail(`missing ${f}`);
}

// The security policy Vercel sends: our own scripts only, nothing evaluated from strings, no framing, no plugins.
const config = JSON.parse(readFileSync(join(root, 'vercel.json'), 'utf8'));
const csp = (config.headers?.[0]?.headers || []).find((h) => h.key === 'Content-Security-Policy');
if (!csp || !/(^|; )script-src 'self'(;|$)/.test(csp.value) || csp.value.includes('unsafe-eval') || !csp.value.includes("frame-ancestors 'none'") || !csp.value.includes("object-src 'none'")) {
  fail("the security policy: script-src 'self' only, no unsafe-eval, frame-ancestors 'none', object-src 'none'");
}

// Size budgets: each file, and each page's HTML.
const budgets = [['boards.js', 400], ['runtime.js', 16], ['css/v2.css', 60], ['css/site.css', 30], ['css/fonts.css', 2], ...[...pages].map((p) => [join(p, 'index.html'), 8])];
for (const [file, kb] of budgets) {
  if (!existsSync(join(dist, file))) continue;
  const size = statSync(join(dist, file)).size / 1024;
  if (size > kb) fail(`${file} is ${size.toFixed(0)} KB, over its ${kb} KB budget`);
}

if (problems.length) {
  console.error('check: ' + problems.length + ' problem(s)\n- ' + problems.join('\n- '));
  process.exit(1);
}
console.log(`check: ${pages.size} pages, every link, stylesheet and state in place, boards.js ${Math.round(statSync(join(dist, 'boards.js')).size / 1024)} KB`);
