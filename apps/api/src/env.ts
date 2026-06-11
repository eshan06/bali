import { config } from 'dotenv';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';

// Backend env lives at the repo root (legacy convention).
config({ path: resolve(fileURLToPath(new URL('.', import.meta.url)), '../../..', '.env') });

const envSchema = z.object({
  DATABASE_URL: z.string().min(1),
  COGNITO_USER_POOL_ID: z.string().min(1),
  COGNITO_CLIENT_ID: z.string().min(1),
  PORT: z.coerce.number().int().default(3001),
  CORS_ORIGIN: z.string().default('http://localhost:3000'),
  DEFAULT_SCHOOL_ID: z.string().uuid(),
  /** Sweeper cadence; 15s default keeps bells honest without load. */
  SWEEP_INTERVAL_MS: z.coerce.number().int().min(1000).default(15_000),
});

export const env = envSchema.parse(process.env);
