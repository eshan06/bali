import { defineConfig } from 'drizzle-kit';
import { config } from 'dotenv';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// Backend env lives at the repo root (mirrors the legacy convention).
const root = resolve(fileURLToPath(new URL('.', import.meta.url)), '../..');
config({ path: resolve(root, '.env') });

if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL missing — copy .env.example to .env at the repo root');
}

export default defineConfig({
  dialect: 'postgresql',
  schema: './src/schema.ts',
  out: './migrations',
  dbCredentials: { url: process.env.DATABASE_URL },
});
