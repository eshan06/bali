import { createPrivateKey } from 'node:crypto';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { config } from 'dotenv';
import { z } from 'zod';

import { COGNITO_ISSUER } from './cognito/admin.js';

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

/** An optional variable set to the empty string reads as unset, never as a boot failure. */
function blankIsUnset<T extends z.ZodType>(schema: T) {
  return z.preprocess((value) => (value === '' ? undefined : value), schema);
}

/** An Apple key id or team id: ten capitals or numerals. */
const APPLE_ID = /^[A-Z0-9]{10}$/;

/** Whether `pem` is an EC P-256 private key, the kind APNs signs with (ES256). */
function isP256PrivateKey(pem: string): boolean {
  try {
    const key = createPrivateKey(pem);
    return key.asymmetricKeyType === 'ec' && key.asymmetricKeyDetails?.namedCurve === 'prime256v1';
  } catch {
    return false;
  }
}

const envSchema = z
  .object({
    // Default to production: unset env must take the safe JSON-logging path, never
    // the dev one (pino-pretty is a devDependency). `npm run dev` sets development.
    NODE_ENV: z.enum(['development', 'test', 'production']).default('production'),
    /** 0 means "any free port" (Node's listen(0)) — used by tests; real deploys pin one. */
    PORT: z.coerce.number().int().min(0).max(65535).default(3001),
    /** 0.0.0.0 so containers (Railway) and LAN devices (iPhone dev) can reach the API. */
    HOST: z.string().min(1).default('0.0.0.0'),
    LOG_LEVEL: z
      .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
      .default('info'),
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
    /**
     * The Cognito app clients whose access tokens are accepted — the token's `client_id` —
     * comma-separated: the portal's and the phone's own (B4). One id accepts exactly
     * that client, as it always did; an empty entry fails the boot rather than drop a client.
     */
    AUTH_AUDIENCE: z
      .string()
      .transform((value) => value.split(',').map((id) => id.trim()))
      .pipe(z.array(z.string().min(1, 'names an empty client id'))),
    /** Postgres connection string. Required; the client connects lazily so boot needs no live DB. */
    DATABASE_URL: z.string().min(1),
    /**
     * Shared secret the backup sweep cron presents to the internal sweep
     * endpoint (hosting decision 3). Server-to-server, not a user JWT; long enough
     * that it can't be guessed: 32 characters or more (Phase 6 S3; it was 16) —
     * `openssl rand -hex 32` gives 64.
     */
    INTERNAL_API_KEY: z.string().min(32),
    /**
     * Comma-separated browser origins allowed by CORS (the web portal). Unset —
     * the default — means no CORS headers at all, which is correct while the API
     * is called only by native apps and server-to-server. Set it to the portal's
     * origin(s) (e.g. `http://localhost:3000`) once the browser portal talks to
     * this API.
     */
    CORS_ORIGINS: z.string().optional(),
    /**
     * Error monitoring (monitoring.ts). Unset — the default, and always in tests
     * and dev — means Sentry is off and nothing leaves the process.
     */
    SENTRY_DSN: blankIsUnset(z.string().url().optional()),
    /** The Sentry environment tag (`dev`, `production`); unset, NODE_ENV. */
    SENTRY_ENVIRONMENT: blankIsUnset(z.string().optional()),
    /** Set by Railway on a deploy from git: the commit, used as the Sentry release. */
    RAILWAY_GIT_COMMIT_SHA: blankIsUnset(z.string().optional()),
    /*
     * The "class started" push (N5, push/apns.ts): Apple's `.p8` signing key, its
     * key id and the team's id — all three or none. Unset — the default, and
     * always in tests and dev — means push is off and nothing is sent. The key is
     * the file's contents, its line breaks as they are or written `\n`.
     */
    APNS_KEY_P8: blankIsUnset(
      z
        .string()
        .transform((key) => key.replace(/\\n/g, '\n'))
        .refine(isP256PrivateKey, 'is not a P-256 private key (the .p8 file’s contents)')
        .optional(),
    ),
    APNS_KEY_ID: blankIsUnset(z.string().regex(APPLE_ID, 'is 10 capitals or numerals').optional()),
    APNS_TEAM_ID: blankIsUnset(z.string().regex(APPLE_ID, 'is 10 capitals or numerals').optional()),
    /** The app's bundle id, the push's `apns-topic`; unset, `com.bali.Bali`. */
    APNS_TOPIC: blankIsUnset(z.string().min(1).optional()),
    /*
     * Deleting a deleted account's Cognito sign-in (cognito/, 2026-10-09): an IAM user's access
     * key, allowed only AdminGetUser and AdminDeleteUser on AUTH_ISSUER's pool — both or none.
     * Unset — the default, and always in tests and dev — the queue waits and nothing is deleted.
     */
    COGNITO_DELETER_ACCESS_KEY_ID: blankIsUnset(
      z
        .string()
        .regex(/^[A-Z0-9]{16,128}$/, 'is an AWS access key id')
        .optional(),
    ),
    COGNITO_DELETER_SECRET_ACCESS_KEY: blankIsUnset(z.string().min(16).optional()),
  })
  .superRefine((env, ctx) => {
    const set = [env.APNS_KEY_P8, env.APNS_KEY_ID, env.APNS_TEAM_ID].filter((v) => v !== undefined);
    if (set.length !== 0 && set.length !== 3) {
      ctx.addIssue({
        code: 'custom',
        path: ['APNS_KEY_P8'],
        message: 'APNS_KEY_P8, APNS_KEY_ID and APNS_TEAM_ID are set together or not at all',
      });
    }
    const keyed = [env.COGNITO_DELETER_ACCESS_KEY_ID, env.COGNITO_DELETER_SECRET_ACCESS_KEY].filter(
      (v) => v !== undefined,
    ).length;
    if (keyed === 1 || (keyed === 2 && !COGNITO_ISSUER.test(env.AUTH_ISSUER))) {
      ctx.addIssue({
        code: 'custom',
        path: ['COGNITO_DELETER_ACCESS_KEY_ID'],
        message:
          'COGNITO_DELETER_ACCESS_KEY_ID and COGNITO_DELETER_SECRET_ACCESS_KEY are set together, beside a Cognito pool’s AUTH_ISSUER, or not at all',
      });
    }
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
