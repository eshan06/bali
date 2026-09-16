import { defineConfig } from 'drizzle-kit';

/**
 * `drizzle-kit generate` diffs ./src/schema.ts against ./migrations and writes
 * the next SQL file — no database needed. Applying migrations to a real
 * database (`drizzle-kit migrate`) is wired up in the hosting step, where
 * DATABASE_URL first exists; tests apply them in-process via PGlite.
 */
export default defineConfig({
  dialect: 'postgresql',
  schema: './src/schema.ts',
  out: './migrations',
});
