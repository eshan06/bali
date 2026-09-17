import type { ExtractTablesWithRelations } from 'drizzle-orm';
import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core';

import type * as schema from './schema.js';

/**
 * A database handle that is either the connection pool or an open transaction —
 * both the production postgres.js client and the in-process PGlite client used
 * in tests satisfy it. The engine and queries accept this so they work at top
 * level or inside a transaction, against either backend.
 */
export type Database = PgDatabase<
  PgQueryResultHKT,
  typeof schema,
  ExtractTablesWithRelations<typeof schema>
>;
