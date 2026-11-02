// Builds the site in dist/ from the approved canvas files in canvas/. No dependencies: Vercel runs it as is.
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const canvas = join(root, 'canvas');
const out = join(root, 'dist');
const read = (path) => readFileSync(path, 'utf8');

const between = (text, start, end) => {
  const i = text.indexOf(start);
  const j = i < 0 ? -1 : text.indexOf(end, i + start.length);
  if (j < 0) throw new Error(`build: "${start}" … "${end}" not found`);
  return text.slice(i + start.length, j);
};
// Each canvas-only piece is swapped out exactly once; a canvas change that moves one fails the build loudly.
const swap = (text, from, to, times = 1) => {
  const found = text.split(from).length - 1;
  if (found !== times) throw new Error(`build: expected ${times} of "${from.slice(0, 70)}", found ${found}`);
  return text.split(from).join(to);
};
const escapeHtml = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// A board's markup, as the canvas draws it inside the page. Its links point at other canvas boards or
// nowhere; the screens are inert pictures, so they lose them.
const board = (name) =>
  between(read(join(canvas, `${name}.dc.html`)), '</helmet>', '</x-dc>').trim().replace(/ href="[^"]*"/g, '');

const main = read(join(canvas, 'Main.dc.html'));
let css = between(main, '<style>', '</style>');
let page = between(main, '</helmet>', '</x-dc>').trim();
const logic = between(main, 'data-dc-script', '</script>');

// The canvas-only rules (the mid-scroll board's frozen pose) don't ship.
css = css.split('\n').filter((line) => !line.startsWith('.pose')).join('\n').trim();
// On a phone the stage is the visible height (svh): at 100vh, Safari's toolbar would cover the scroll prompt.
css = swap(css, '.is-live .b-stage{position:sticky;top:0;height:100vh;overflow:hidden}', '.is-live .b-stage{position:sticky;top:0;height:100vh;height:100svh;overflow:hidden}');
css = `@font-face{font-family:'Instrument Sans';src:url(/fonts/instrument-sans-latin-wght-normal.woff2) format('woff2');font-weight:400 700;font-style:normal;font-display:swap}
@font-face{font-family:'JetBrains Mono';src:url(/fonts/jetbrains-mono-latin-wght-normal.woff2) format('woff2');font-weight:100 800;font-style:normal;font-display:swap}
${css}
.b-player{cursor:auto;background:#161513}
.b-player iframe{position:absolute;inset:0;width:100%;height:100%;border:0}
`;

// The grid's 28 tiles, laid out as the canvas's renderVals lays them out.
const list = (name) => JSON.parse(between(logic, `const ${name} = `, ';').replace(/'([^']*)'/g, (m, s) => JSON.stringify(s)));
const names = list('names');
const order = list('order');
const loop = page.match(/<sc-for list="\{\{tiles\}\}" as="t" hint-placeholder-count="28">\s*([\s\S]*?)\s*<\/sc-for>/);
if (!loop || names.length !== 28) throw new Error('build: the grid tiles changed shape');
const tiles = names.map((name, i) => {
  const rank = order.indexOf(i);
  return loop[1]
    .split('{{t.i}}').join(String(Math.max(rank, 0)))
    .split('{{t.name}}').join(escapeHtml(name))
    .split('{{t.topCls}}').join('tile t-focused b-top' + (rank < 0 ? ' hd-hide' : ''));
});
page = page.slice(0, loop.index) + tiles.join('\n') + page.slice(loop.index + loop[0].length);

// Each imported screen goes in where the canvas imports it, in the wrapper the canvas draws it in.
page = page.replace(/<dc-import name="(\w+)" hint-size="[^"]*"><\/dc-import>/g, (m, name) => `<div class="sc-host">${board(name)}</div>`);

// The canvas's live state becomes plain markup that src/site.js drives.
page = swap(page, '<div class="{{rootCls}}">', '<div class="bw"><script src="/live.js"></script>');
page = page.replace(/ onClick="\{\{(goDetails|goContact|goWatch|copy)\}\}"/g, '');
page = page.replace(/<path class="b-slingp" d="\{\{sl\.d\d\}\}" style="[^"]*"><\/path>/g, '<path class="b-slingp"></path>');
page = swap(page, '<sc-if value="{{landing}}" hint-placeholder-val="{{ false }}"><div class="b-veil" aria-hidden="true"></div></sc-if>', '<div class="b-veil" aria-hidden="true" hidden></div>');
page = swap(page, '{{copyLabel}}', '<span class="b-copytext">Copy address</span>');
page = swap(page, '<span class="sr-only" aria-live="polite">{{copyMsg}}</span>', '<span class="sr-only b-copymsg" aria-live="polite"></span>');
// The canvas can't hold a player, so its poster opens YouTube; here src/site.js plays the video in place
// (the canvas's VideoPlaying board), and without the script the poster still opens YouTube, as it says.
page = swap(page, 'aria-label="Play the Bali classroom demo (YouTube, opens in a new tab)">', 'aria-label="Play the Bali classroom demo (YouTube, opens in a new tab)" data-video="iLtbApxTNTA">');

const left = ['{{', 'dc-import', 'sc-for', 'sc-if', '.dc.html', 'onClick'].filter((s) => page.includes(s));
if (left.length) throw new Error(`build: canvas-only markup left over: ${left.join(', ')}`);
if ((page.match(/class="b-slingp"/g) || []).length !== 7) throw new Error('build: each chapter needs its slingshot path');

const title = 'Bali: focus for the whole class';
const description = "Students hold their phone to the teacher's Bali block, and their apps pause until the bell. Teachers see the whole room live, and Emergency Unlock always works.";
const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
<meta name="description" content="${escapeHtml(description)}">
<link rel="canonical" href="https://www.getbali.app/">
<meta property="og:type" content="website">
<meta property="og:url" content="https://www.getbali.app/">
<meta property="og:title" content="${title}">
<meta property="og:description" content="${escapeHtml(description)}">
<meta name="theme-color" content="#F7F5F2">
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="preload" href="/fonts/instrument-sans-latin-wght-normal.woff2" as="font" type="font/woff2" crossorigin>
<link rel="stylesheet" href="/v2.css">
<link rel="stylesheet" href="/site.css">
<script src="/site.js" defer></script>
</head>
<body>
${page}
</body>
</html>
`;

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
writeFileSync(join(out, 'index.html'), html);
writeFileSync(join(out, 'site.css'), css);
cpSync(join(canvas, 'v2.css'), join(out, 'v2.css'));
cpSync(join(root, 'src', 'site.js'), join(out, 'site.js'));
cpSync(join(root, 'src', 'live.js'), join(out, 'live.js'));
cpSync(join(root, 'static'), out, { recursive: true });
console.log(`built dist/: index.html ${Math.round(html.length / 1024)} KB, site.css ${Math.round(css.length / 1024)} KB`);
