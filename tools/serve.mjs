// Serves dist/ for the browser tests with the same headers Vercel sends (vercel.json), so a page the
// security policy would break in production breaks here first.
import { readFileSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { dirname, extname, join, normalize, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dist = join(root, 'dist');
const config = JSON.parse(readFileSync(join(root, 'vercel.json'), 'utf8'));
const headers = Object.fromEntries(config.headers[0].headers.map((h) => [h.key, h.value]));
const types = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.txt': 'text/plain; charset=utf-8' };

createServer((req, res) => {
  let file = normalize(join(dist, decodeURIComponent(new URL(req.url, 'http://localhost').pathname)));
  if (file !== dist && !file.startsWith(dist + sep)) return res.writeHead(403, headers).end();
  try {
    if (statSync(file).isDirectory()) file = join(file, 'index.html');
    const body = readFileSync(file);
    res.writeHead(200, { ...headers, 'Content-Type': types[extname(file)] || 'application/octet-stream' }).end(body);
  } catch {
    res.writeHead(404, headers).end('not found');
  }
}).listen(Number(process.env.PORT || 4173), '127.0.0.1');
