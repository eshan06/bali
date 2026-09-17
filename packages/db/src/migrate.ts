import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';

import { MIGRATIONS_DIR } from './paths.js';

/**
 * Apply the committed migrations to a real database, using drizzle-orm's
 * migrator (a production dependency) — so a deploy needs no drizzle-kit. The
 * migrator records applied migrations and skips them, so this is safe to run on
 * every deploy. A single dedicated connection is opened and closed.
 */
export async function runMigrations(databaseUrl: string): Promise<void> {
  const sql = postgres(databaseUrl, { max: 1 });
  try {
    await migrate(drizzle(sql), { migrationsFolder: MIGRATIONS_DIR });
  } finally {
    await sql.end();
  }
}
