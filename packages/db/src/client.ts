import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';

import * as schema from './schema.js';

export type Db = ReturnType<typeof createDb>;

/**
 * The production client: postgres.js under Drizzle. postgres.js is the driver
 * that also speaks LISTEN/NOTIFY, which the live-update doorbell needs later.
 * The caller owns the URL (the API's env module validates it); this module
 * never reads process.env itself.
 */
export function createDb(databaseUrl: string) {
  const sql = postgres(databaseUrl);
  return drizzle(sql, { schema });
}
