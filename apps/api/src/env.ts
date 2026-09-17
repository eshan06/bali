import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { config } from 'dotenv';
import { z } from 'zod';

// One .env for the whole monorepo, at the repo root (same convention as v2).
const loaded = config({
  path: resolve(fileURLToPath(new URL('.', import.meta.url)), '../../..', '.env'),
  quiet: true,
});
// dotenv reports read failures via the return value, not by throwing. A missing
// .env is fine (defaults and platform env apply); an unreadable one must fail
// the boot — silently running on defaults would break the fail-fast contract.
// The cast is load-bearing: dotenv types `code` as its vault-only literals,
// but read failures carry fs errno codes like ENOENT.
if (loaded.error && (loaded.error as NodeJS.ErrnoException).code !== 'ENOENT') {
  throw loaded.error;
}

const envSchema = z.object({
  // Default to production: unset env must take the safe JSON-logging path, never
  // the dev one (pino-pretty is a devDependency). `npm run dev` sets development.
  NODE_ENV: z.enum(['development', 'test', 'production']).default('production'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3001),
  /** 0.0.0.0 so containers (Railway) and LAN devices (iPhone dev) can reach the API. */
  HOST: z.string().min(1).default('0.0.0.0'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
});

export type Env = z.infer<typeof envSchema>;

function load(): Env {
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    const lines = parsed.error.issues.map(
      (issue) => `  - ${issue.path.join('.') || '(root)'}: ${issue.message}`,
    );
    // Fail fast with a readable summary instead of a raw ZodError stack.
    throw new Error(`Invalid environment:\n${lines.join('\n')}`);
  }
  return parsed.data;
}

export const env = load();
