/**
 * @bali/db — Drizzle schema, migrations, and the Postgres client.
 * The schema is the data model from docs/ARCHITECTURE.md; migrations live in
 * ./migrations and are generated (`npm run db:generate -w @bali/db`), never
 * hand-edited.
 */

export { createDb, type Db } from './client.js';
export { newUuidV7 } from './ids.js';
export { runMigrations } from './migrate.js';
export * from './management.js';
export { MIGRATIONS_DIR } from './paths.js';
export * from './queries.js';
export * from './schema.js';
export * as schema from './schema.js';
export * from './transitions.js';
export type { Database } from './types.js';
