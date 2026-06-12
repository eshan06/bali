import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { config } from 'dotenv';
import pg from 'pg';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as schema from './schema';

/** Backend env lives at the repo root (legacy convention carried over). */
export function loadRootEnv(): void {
  const root = resolve(fileURLToPath(new URL('.', import.meta.url)), '../../..');
  config({ path: resolve(root, '.env') });
}

export type Db = NodePgDatabase<typeof schema>;

let pool: pg.Pool | null = null;
let db: Db | null = null;

export function getPool(): pg.Pool {
  if (!pool) {
    loadRootEnv();
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error('DATABASE_URL missing — copy .env.example to .env at the repo root');
    pool = new pg.Pool({
      connectionString: url,
      max: 10,
      // Retire idle clients before RDS does — its idle timeout sends ECONNRESETs.
      idleTimeoutMillis: 30_000,
      keepAlive: true,
      // RDS requires TLS; the instance uses an AWS-managed cert not in the local trust store.
      ssl: url.includes('sslmode=disable') ? undefined : { rejectUnauthorized: false },
    });
    // An idle pooled client dropping (RDS timeout, network blip) emits 'error' on the
    // pool; without a listener Node kills the whole process. Log and let the pool
    // replace the client — in-flight queries get their own errors via their callers.
    pool.on('error', (err) => {
      console.error('pg pool: idle client error (recovering):', err.message);
    });
  }
  return pool;
}

export function getDb(): Db {
  if (!db) db = drizzle(getPool(), { schema });
  return db;
}

export async function closeDb(): Promise<void> {
  await pool?.end();
  pool = null;
  db = null;
}

export { schema };
