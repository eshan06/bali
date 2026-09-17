import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { config } from 'dotenv';
import { z } from 'zod';

// One .env for the whole monorepo, at the repo root (same convention as v2).
// DOTENV_CONFIG_PATH (dotenv's own convention) overrides it — used by the
// boot-contract tests, and available for odd deploy layouts.
const explicitPath = process.env.DOTENV_CONFIG_PATH;
const loaded = config({
  path: explicitPath ?? resolve(fileURLToPath(new URL('.', import.meta.url)), '../../..', '.env'),
  quiet: true,
});
// dotenv reports read failures via the return value, not by throwing. A missing
// default .env is fine (defaults and platform env apply), but any other read
// error — and a missing *explicitly pointed-at* file — must fail the boot:
// silently running on defaults would break the fail-fast contract.
// The cast is load-bearing: dotenv types `code` as its vault-only literals,
// but read failures carry fs errno codes like ENOENT.
if (loaded.error) {
  const code = (loaded.error as NodeJS.ErrnoException).code;
  if (explicitPath !== undefined || code !== 'ENOENT') {
    throw loaded.error;
  }
}

const envSchema = z.object({
  // Default to production: unset env must take the safe JSON-logging path, never
  // the dev one (pino-pretty is a devDependency). `npm run dev` sets development.
  NODE_ENV: z.enum(['development', 'test', 'production']).default('production'),
  /** 0 means "any free port" (Node's listen(0)) — used by tests; real deploys pin one. */
  PORT: z.coerce.number().int().min(0).max(65535).default(3001),
  /** 0.0.0.0 so containers (Railway) and LAN devices (iPhone dev) can reach the API. */
  HOST: z.string().min(1).default('0.0.0.0'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  /**
   * How long shutdown waits for close() before exiting non-zero. Must sit
   * inside the platform's SIGTERM→SIGKILL window with headroom (docker stop
   * defaults to exactly 10s; Railway's is 0 unless
   * RAILWAY_DEPLOYMENT_DRAINING_SECONDS is set — the hosting step must set it
   * above this value).
   */
  SHUTDOWN_DEADLINE_MS: z.coerce.number().int().min(100).default(8000),
  /*
   * Auth (Cognito). The API verifies every request's JWT against the pool's
   * public keys with math alone — no per-request network call in the hot path
   * once the key set is cached (auth decision 2). Required so a deploy can't
   * silently come up unable to authenticate anyone; real values are set at the
   * hosting step, and tests inject a verifier instead of reaching the network.
   */
  AUTH_ISSUER: z.string().url(),
  AUTH_JWKS_URI: z.string().url(),
  /** The Cognito app client id: an access token's `client_id` or an id token's `aud`. */
  AUTH_AUDIENCE: z.string().min(1),
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
