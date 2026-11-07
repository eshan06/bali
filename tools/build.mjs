// Builds the site in dist/ from the canvas files in canvas/. No dependencies: Vercel runs it as is.
//
// Each page is a canvas board drawn in the browser by src/runtime.js. This script bundles every board
// a page needs into dist/boards.js (template, helmet styles, component class) so nothing is evaluated
// from strings, swaps the canvas-only pieces for the site's own (self-hosted fonts, real page paths,
// the Android picture), and writes one small HTML page per route.
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ASSETS, DESCRIPTIONS, ROUTES } from './routes.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const canvas = join(root, 'canvas');
const out = join(root, 'dist');
const read = (path) => readFileSync(path, 'utf8');
const SITE = 'https://www.getbali.app';

const between = (text, start, end, from = 0) => {
  const i = text.indexOf(start, from);
  const j = i < 0 ? -1 : text.indexOf(end, i + start.length);
  if (j < 0) throw new Error(`build: "${start}" … "${end}" not found`);
  return text.slice(i + start.length, j);
};
const escapeHtml = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// Links between boards become the site's paths; any other board link (inside a portal or app
// picture, which is inert) is dropped.
const relink = (html) =>
  html.replace(/ href="([A-Za-z0-9]+\.dc\.html)(#[^"]*)?"/g, (m, board, hash) => {
    const path = ROUTES[board];
    if (!path) return '';
    if (board === 'Main.dc.html' && hash) return ` href="/${hash}"`;
    return ` href="${path}${hash || ''}"`;
  });

function boardParts(name) {
  const src = read(join(canvas, name));
  const head = between(src, '<head>', '</head>');
  const title = (head.match(/<title>([\s\S]*?)<\/title>/) || [])[1] || 'Bali';
  const heads = [...head.matchAll(/<link rel="stylesheet" href="([^"]+)">/g)].map((m) => '/css/' + m[1]);
  const xdc = between(src, '<x-dc>', '</x-dc>');
  let helmet = '';
  let tpl = xdc;
  if (xdc.includes('<helmet>')) {
    helmet = between(xdc, '<helmet>', '</helmet>');
    tpl = xdc.slice(xdc.indexOf('</helmet>') + '</helmet>'.length);
  }
  // The canvas loads its fonts from Google; the site serves them itself (fonts.css).
  helmet = helmet.replace(/<link rel="stylesheet" href="https:\/\/fonts\.googleapis\.com[^"]*">\s*/g, '');
  tpl = relink(tpl.trim());
  // Event bindings become data attributes the runtime binds, so no inline handler reaches the browser.
  tpl = tpl.replace(/ on([A-Za-z]+)="(\{\{[^"]+\}\})"/g, (m, ev, hole) => ` data-dc-on-${ev.toLowerCase()}="${hole}"`);
  for (const [from, to] of Object.entries(ASSETS)) tpl = tpl.split(from).join(to);
  const script = src.match(/<script type="text\/x-dc" data-dc-script[^>]*>([\s\S]*?)<\/script>/);
  const code = script ? script[1].trim() : 'class Component extends DCLogic { renderVals() { return {}; } }';
  const imports = [...tpl.matchAll(/<dc-import name="([A-Za-z0-9]+)"/g)].map((m) => m[1] + '.dc.html');
  return { title, heads, helmet: helmet.trim(), tpl, code, imports };
}

// Every board a page needs: the pages and, through their imports, everything they draw.
const parts = {};
const queue = Object.keys(ROUTES);
while (queue.length) {
  const name = queue.shift();
  if (parts[name]) continue;
  if (!existsSync(join(canvas, name))) throw new Error(`build: ${name} is imported but missing from canvas/`);
  parts[name] = boardParts(name);
  queue.push(...parts[name].imports);
}

// Each page's stylesheets, in the order its boards ask for them. They go in the page's HTML, so it never
// paints before its styles arrive; the runtime skips a stylesheet that is already there.
const sheets = (name, seen = new Set()) => {
  if (seen.has(name)) return [];
  seen.add(name);
  return [...parts[name].heads, ...parts[name].imports.flatMap((i) => sheets(i, seen))];
};

// What a page shows when it can't be drawn (a page that didn't load, JavaScript off), as the canvas's
// SiteStates board draws them.
const states = read(join(canvas, 'SiteStates.dc.html'));
const failed = between(states, '<!-- state:error -->', '<!-- /state:error -->').trim();
const noScript = between(states, '<!-- state:noscript -->', '<!-- /state:noscript -->').trim();

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });

const bundle = [
  '// Built by tools/build.mjs from canvas/. Do not edit: change the canvas, copy the file in, rebuild.',
  'window.DCB = {};',
  ...Object.entries(parts).map(([name, p]) =>
    `window.DCB[${JSON.stringify(name)}] = { tpl: ${JSON.stringify(p.tpl)}, helmet: ${JSON.stringify(p.helmet)}, heads: ${JSON.stringify(p.heads)}, make: function (DCLogic) {\n${p.code}\nreturn Component;\n} };`),
  '',
].join('\n');
writeFileSync(join(out, 'boards.js'), bundle);
cpSync(join(root, 'src', 'runtime.js'), join(out, 'runtime.js'));

mkdirSync(join(out, 'css'), { recursive: true });
for (const f of readdirSync(canvas).filter((f) => f.endsWith('.css'))) cpSync(join(canvas, f), join(out, 'css', f));
writeFileSync(join(out, 'css', 'fonts.css'), [
  "@font-face{font-family:'Instrument Sans';src:url(/fonts/instrument-sans-latin-wght-normal.woff2) format('woff2');font-weight:400 700;font-style:normal;font-display:swap}",
  "@font-face{font-family:'JetBrains Mono';src:url(/fonts/jetbrains-mono-latin-wght-normal.woff2) format('woff2');font-weight:100 800;font-style:normal;font-display:swap}",
  'html,body{margin:0;background:#F7F5F2}',
  '',
].join('\n'));
cpSync(join(root, 'static'), out, { recursive: true });

for (const [name, path] of Object.entries(ROUTES)) {
  const p = parts[name];
  const title = escapeHtml(name === 'Main.dc.html' ? 'Bali: Lock the phone. Train the mind.' : `${p.title} · Bali`);
  const description = escapeHtml(DESCRIPTIONS[name]);
  const links = [...new Set(sheets(name))].map((href) => `<link rel="stylesheet" href="${href}" data-src="${href}">`).join('\n');
  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
<meta name="description" content="${description}">
<link rel="canonical" href="${SITE}${path}">
<meta property="og:type" content="website">
<meta property="og:site_name" content="Bali">
<meta property="og:url" content="${SITE}${path}">
<meta property="og:title" content="${title}">
<meta property="og:description" content="${description}">
<meta name="theme-color" content="#F7F5F2">
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="preload" href="/fonts/instrument-sans-latin-wght-normal.woff2" as="font" type="font/woff2" crossorigin>
<link rel="stylesheet" href="/css/fonts.css">
${links}
</head>
<body>
<div id="app" data-board="${name}"></div>
<template id="dc-error">${failed}</template>
<noscript>${noScript}</noscript>
<script src="/boards.js"></script>
<script src="/runtime.js"></script>
</body>
</html>
`;
  const dir = join(out, path);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'index.html'), html);
}

console.log(`build: ${Object.keys(ROUTES).length} pages from ${Object.keys(parts).length} boards, boards.js ${Math.round(bundle.length / 1024)} KB`);
