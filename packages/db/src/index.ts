/**
 * @bali/db — Drizzle schema, migrations, and the Postgres client.
 * The schema is the data model from docs/ARCHITECTURE.md; migrations live in
 * ./migrations and are generated (`npm run db:generate -w @bali/db`), never
 * hand-edited.
 */

export { createDb, type Db } from './client.js';
export { newUuidV7 } from './ids.js';
export * from './schema.js';
export * from './transitions.js';
