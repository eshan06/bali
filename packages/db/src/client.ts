import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';

import * as schema from './schema.js';

export type Db = ReturnType<typeof createDb>;

/**
 * The production client: postgres.js under Drizzle. postgres.js is the driver
 * that also speaks LISTEN/NOTIFY, which the live-update doorbell needs later.
 * The caller owns the URL (the API's env module validates it); this module
 * never reads process.env itself.
 *
 * `max` sizes the pool (the load harness's runs, #336); unset, 10, postgres.js's
 * own default. Always passed, and always a number (DECISIONS 2026-10-22): passed
 * none, postgres.js 3.4.9 sizes the pool by PGMAX or a `max` in the URL, read
 * as text, and a pool of "20" is one connection, as is a `max` key passed
 * undefined. Passed one, it reads neither.
 */
export function createDb(databaseUrl: string, { max = 10 }: { max?: number } = {}) {
  const sql = postgres(databaseUrl, { max });
  return drizzle(sql, { schema });
}
