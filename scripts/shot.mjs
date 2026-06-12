#!/usr/bin/env node
/** Screenshot a page via headless Chrome CDP (port 9222).
 *  Usage: node scripts/shot.mjs <url> <outfile.png> [--w 1440] [--h 900] [--wait 1200]
 *         [--token "dev:..."] [--reduced-motion] [--click "css"] [--js "expr"]
 *  --token seeds localStorage bali.devToken on the origin before loading the page. */
import CDP from 'chrome-remote-interface';
import { writeFileSync } from 'node:fs';

const [url, outfile, ...rest] = process.argv.slice(2);
if (!url || !outfile) {
  console.error('usage: shot.mjs <url> <outfile> [--w N] [--h N] [--wait ms] [--token T] [--js expr] [--click css]');
  process.exit(1);
}
const opt = (name, fallback = null) => {
  const i = rest.indexOf(`--${name}`);
  return i >= 0 ? rest[i + 1] : fallback;
};
const has = (name) => rest.includes(`--${name}`);

const width = Number(opt('w', 1440));
const height = Number(opt('h', 900));
const wait = Number(opt('wait', 1500));
const token = opt('token');
const js = opt('js');
const click = opt('click');

const target = await CDP.New({ url: 'about:blank' });
const client = await CDP({ target });
const { Page, Runtime, Emulation } = client;
await Page.enable();
await Runtime.enable();
await Emulation.setDeviceMetricsOverride({ width, height, deviceScaleFactor: 2, mobile: width < 600 });
if (has('reduced-motion')) {
  await Emulation.setEmulatedMedia({ features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
}

if (token) {
  const origin = new URL(url).origin;
  await Page.navigate({ url: origin + '/login' });
  await Page.loadEventFired();
  await Runtime.evaluate({ expression: `localStorage.setItem('bali.devToken', ${JSON.stringify(token)})` });
}

await Page.navigate({ url });
await Page.loadEventFired();
await new Promise((r) => setTimeout(r, wait));

if (click) {
  await Runtime.evaluate({ expression: `document.querySelector(${JSON.stringify(click)})?.click()` });
  await new Promise((r) => setTimeout(r, 700));
}
if (js) {
  await Runtime.evaluate({ expression: js, awaitPromise: true });
  await new Promise((r) => setTimeout(r, 700));
}

const shot = await Page.captureScreenshot({ format: 'png' });
writeFileSync(outfile, Buffer.from(shot.data, 'base64'));
console.log(`saved ${outfile}`);
await CDP.Close({ id: target.id });
await client.close();
