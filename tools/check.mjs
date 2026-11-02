// Quick checks on the built site in dist/. Vercel runs them after every build, so a broken page fails the
// build and getbali.app keeps serving the last good version. The browser tests (tests/) go further.
import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dist = join(root, 'dist');
const problems = [];
const need = (ok, message) => {
  if (!ok) problems.push(message);
};

const html = readFileSync(join(dist, 'index.html'), 'utf8');
const ids = new Set([...html.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]));
const hrefs = [...html.matchAll(/\shref="([^"]*)"/g)].map((m) => m[1]);

need(html.includes('<h1 id="h-1" class="display">Tap in.</h1>'), 'the page heading');
need(html.includes('<title>Bali: focus for the whole class</title>'), 'the page title');
for (const id of ['top', 'details', 'watch', 'contact', 'h-why', 'h-watch', 'h-contact']) need(ids.has(id), `#${id} exists`);
for (const href of hrefs) {
  if (href.startsWith('#')) need(ids.has(href.slice(1)), `${href} points at something on the page`);
  else if (href.startsWith('/')) need(existsSync(join(dist, href)), `${href} is in dist/`);
  else need(/^https:\/\/|^mailto:eshan\.shah@vanderbilt\.edu$/.test(href), `${href} is https or the contact address`);
}
for (const src of [...html.matchAll(/\ssrc="([^"]*)"/g)].map((m) => m[1])) need(src.startsWith('/') && existsSync(join(dist, src)), `${src} is one of our files in dist/`);
need(!/<script(?![^>]*\ssrc=)[^>]*>/.test(html), 'no inline scripts (the security policy allows only our own files)');
need(!/\{\{|dc-import|sc-for|sc-if|\.dc\.html/.test(html), 'no canvas-only markup left');
need(html.includes('data-video="iLtbApxTNTA"'), 'the video poster');
need(html.includes('<p>Coming soon!</p>'), 'the Android answer');
for (const [file, kb] of [['index.html', 200], ['site.css', 40], ['site.js', 16], ['v2.css', 60]]) {
  const size = statSync(join(dist, file)).size / 1024;
  need(size <= kb, `${file} is ${size.toFixed(0)} KB, over its ${kb} KB budget`);
}
const config = JSON.parse(readFileSync(join(root, 'vercel.json'), 'utf8'));
const csp = config.headers[0].headers.find((h) => h.key === 'Content-Security-Policy');
need(csp && /script-src 'self'(;|$)/.test(csp.value) && csp.value.includes('frame-src https://www.youtube-nocookie.com'), 'the security policy: our scripts only, YouTube\'s privacy-enhanced player only');

if (problems.length) {
  console.error(`check: ${problems.length} problem(s)\n- ${problems.join('\n- ')}`);
  process.exit(1);
}
console.log(`check: ok (${hrefs.length} links, ${ids.size} ids)`);
