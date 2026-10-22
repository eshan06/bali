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
 * `max` sizes the pool (the load harness's runs, #336); unset, postgres.js's
 * own 10. Only ever a number here: postgres.js 3.4.9 reads `?max=` in the URL
 * and PGMAX as text, and a pool of "20" is one connection, as is a `max` key
 * passed undefined.
 */
export function createDb(databaseUrl: string, { max }: { max?: number } = {}) {
  const sql = postgres(databaseUrl, max === undefined ? {} : { max });
  return drizzle(sql, { schema });
}
