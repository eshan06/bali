import { config } from 'dotenv';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';

// Backend env lives at the repo root (legacy convention).
config({ path: resolve(fileURLToPath(new URL('.', import.meta.url)), '../../..', '.env') });

const envSchema = z
  .object({
    NODE_ENV: z.string().default('development'),
    DATABASE_URL: z.string().min(1),
    COGNITO_USER_POOL_ID: z.string().min(1),
    COGNITO_CLIENT_ID: z.string().min(1),
    PORT: z.coerce.number().int().default(3001),
    /** Comma-separated list of allowed web origins (CORS). */
    CORS_ORIGIN: z.string().default('http://localhost:3000'),
    DEFAULT_SCHOOL_ID: z.string().uuid(),
    /** Sweeper cadence; 15s default keeps bells honest without load. */
    SWEEP_INTERVAL_MS: z.coerce.number().int().min(1000).default(15_000),
    /** Dev-only auth bypass (`Bearer dev:...`). MUST be unset/0 in production; only '1' enables it. */
    ALLOW_DEV_TOKENS: z.string().optional(),
    /**
     * Which proxy hops may set X-Forwarded-For, in Fastify/proxy-addr syntax (a comma list of
     * IPs/CIDRs, a hop count, or `loopback`). Read directly in app.ts because it is needed to
     * build the server; declared here so it is validated and shows up with the rest of the env.
     * Default `loopback` covers a same-host tunnel; an off-host proxy (ALB) MUST be named or
     * every unauthenticated caller shares one rate-limit bucket.
     */
    TRUSTED_PROXIES: z.string().optional(),
  })
  // Defense in depth: even though devIdentity already disables itself when
  // NODE_ENV=production, refuse to boot a production process that asks for the bypass.
  .superRefine((e, ctx) => {
    if (e.NODE_ENV === 'production' && e.ALLOW_DEV_TOKENS === '1') {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'ALLOW_DEV_TOKENS=1 is forbidden in production — the dev-token bypass would be an open auth hole.',
        path: ['ALLOW_DEV_TOKENS'],
      });
    }
  });

function load(): z.infer<typeof envSchema> {
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    const lines = parsed.error.issues.map((i) => `  - ${i.path.join('.') || '(root)'}: ${i.message}`);
    // Fail fast with a readable summary instead of a raw ZodError stack.
    throw new Error(`Invalid backend environment:\n${lines.join('\n')}\n(copy .env.example to .env at the repo root)`);
  }
  return parsed.data;
}

export const env = load();

/** Parsed list of allowed CORS origins. */
export const corsOrigins = env.CORS_ORIGIN.split(',')
  .map((s) => s.trim())
  .filter(Boolean);
