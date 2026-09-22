import { randomUUID } from 'node:crypto';

import { and, eq, isNull } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';

import { MIGRATIONS_DIR } from './paths.js';
import * as schema from './schema.js';
import type { Database } from './types.js';

/*
 * The one test-database factory, shared by every suite (api and db) so the same
 * Vitest tests run on either backend:
 *
 *   - default: PGlite, an in-process Postgres — fast, no service needed. This is
 *     the fast CI lane and what `npm test` uses locally.
 *   - TEST_DATABASE_URL set: a real Postgres. Each call creates a throwaway
 *     database, migrates it, and drops it on close, so tests stay isolated. The
 *     driver is postgres.js with a real connection pool, so this lane is
 *     genuinely multi-connection — the only place the engine's FOR UPDATE
 *     serialization and LISTEN/NOTIFY can actually be exercised (Phase 1 left
 *     those "verified by reasoning" because PGlite is single-connection).
 *
 * Both return the shared `Database` type, so a suite never knows which backend
 * it is on. PGlite is loaded with a dynamic import, so the real lane (and
 * production, which never imports this module) never resolves the dev-only
 * PGlite dependency.
 */

/** A migrated, isolated test database and a closer that tears it down. */
export interface TestDb {
  db: Database;
  close: () => Promise<void>;
}

/** A postgres.js client instance, named without reaching into the package's namespace types. */
type Sql = ReturnType<typeof postgres>;

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

export async function makeTestDb(): Promise<TestDb> {
  const url = process.env.TEST_DATABASE_URL;
  return url ? makeRealPostgresDb(url) : makePgliteDb();
}

async function makePgliteDb(): Promise<TestDb> {
  const { PGlite } = await import('@electric-sql/pglite');
  const { drizzle: pgliteDrizzle } = await import('drizzle-orm/pglite');
  const { migrate: pgliteMigrate } = await import('drizzle-orm/pglite/migrator');

  const pg = new PGlite();
  const db = pgliteDrizzle(pg, { schema });
  await pgliteMigrate(db, { migrationsFolder: MIGRATIONS_DIR });
  return { db, close: () => pg.close() };
}

async function makeRealPostgresDb(baseUrl: string): Promise<TestDb> {
  // A fresh, uniquely-named database per call — the real-Postgres equivalent of
  // PGlite's per-call in-process instance, so tests never see each other's rows.
  const name = `bali_test_${randomUUID().replace(/-/g, '')}`;

  await withAdmin(baseUrl, (sql) => createDatabase(sql, name));

  // WITH (FORCE) terminates any lingering connections (Postgres 13+, and CI runs
  // 16), so a leaked stream connection can't keep the throwaway database alive.
  const dropDatabase = () =>
    withAdmin(baseUrl, (sql) => sql.unsafe(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`));

  let client: Sql | undefined;
  try {
    client = postgres(databaseUrl(baseUrl, name), { max: 5, onnotice: () => {} });
    const db = drizzle(client, { schema });
    await migrate(db, { migrationsFolder: MIGRATIONS_DIR });

    const pool = client;
    return {
      db,
      close: async () => {
        // Drop even if the pool teardown rejects, so a failed end() can't strand
        // the database (the forced drop closes any connection end() missed).
        await pool.end({ timeout: 5 }).catch(() => {});
        await dropDatabase();
      },
    };
  } catch (err) {
    // Setup failed after the database was created — a bad migration, or a
    // transient connect error under parallel load. Release the pool and drop the
    // database before rethrowing, so a failed setup strands neither a database
    // nor a connection. (makeTestDb still rejects, so a caller that destructures
    // `close` never assigns it — but everything close() would free is already
    // released here, so an afterEach calling the undefined `close` is only
    // harmless noise on an already-failing test, never a leak.)
    if (client) await client.end({ timeout: 5 }).catch(() => {});
    await dropDatabase().catch(() => {});
    throw err;
  }
}

/** Run one statement on the maintenance database, then close the connection. */
async function withAdmin<T>(baseUrl: string, fn: (sql: Sql) => Promise<T>): Promise<T> {
  const sql = postgres(baseUrl, { max: 1, onnotice: () => {} });
  try {
    return await fn(sql);
  } finally {
    await sql.end({ timeout: 5 });
  }
}

/**
 * CREATE DATABASE, retrying the transient collision that parallel Vitest workers
 * provoke: two CREATE DATABASE statements briefly holding the template database
 * at once raise 55006 ("source database is being accessed by other users"). It
 * clears on its own, so a short backoff is all it needs.
 */
async function createDatabase(sql: Sql, name: string): Promise<void> {
  for (let attempt = 0; ; attempt += 1) {
    try {
      await sql.unsafe(`CREATE DATABASE "${name}"`);
      return;
    } catch (err) {
      const code = (err as { code?: string }).code;
      const transient = code === '55006' || code === '53300';
      if (!transient || attempt >= 9) throw err;
      await sleep(50 * (attempt + 1));
    }
  }
}

/** The base connection URL with its database name swapped for the throwaway one. */
function databaseUrl(baseUrl: string, name: string): string {
  const url = new URL(baseUrl);
  url.pathname = `/${name}`;
  return url.toString();
}

/**
 * Refuse to run outside an explicitly non-production process. `@bali/db`
 * publishes this module on a public subpath (`@bali/db/testing`) and the
 * production image runs TypeScript straight from source under tsx, so nothing
 * structural stops runtime code importing it and writing `participations`
 * behind the transition engine's back. NODE_ENV is `production` in the image
 * and unset in a bare shell, so this denies by default exactly the way
 * `apps/api/src/env.ts` does: only an explicit 'test' or 'development' passes.
 */
function assertNotProduction(helper: string, writes: string): void {
  const env = process.env.NODE_ENV;
  if (env !== 'test' && env !== 'development') {
    throw new Error(
      `${helper} is a test-only helper: it writes ${writes} outside the transition ` +
        `engine and must not run with NODE_ENV=${env ?? '<unset>'}`,
    );
  }
}

/**
 * Move a live participation's last contact into the past — time compression for
 * the demo and tests, so a silence episode can be exercised without idling out
 * the real 90s threshold. It lives here, beside the other test-only helpers, so
 * the "only the transition engine writes participations" grep stays clean in
 * scripts; the sweep it sets up still does the real work through the engine.
 * Guarded, because "it's only ever called from tests" is a convention, not a
 * mechanism.
 */
export async function backdateLastSeen(
  db: Database,
  where: { sessionId: string; studentId: string },
  at: Date,
): Promise<void> {
  assertNotProduction('backdateLastSeen', 'participations');
  await db
    .update(schema.participations)
    .set({ lastSeenAt: at })
    .where(
      and(
        eq(schema.participations.sessionId, where.sessionId),
        eq(schema.participations.studentId, where.studentId),
        isNull(schema.participations.endedAt),
      ),
    );
}

/**
 * Move a running session's end time into the past — the expiry counterpart to
 * `backdateLastSeen`, so the demo and tests can prove a session expires without
 * idling out a real minute of wall clock. It writes only `sessions.ends_at`;
 * the expiry itself still happens in the sweep, through the engine, which is
 * what the assertion is actually about. Same guard, same reason: the subpath is
 * public and the production image runs this source directly.
 */
export async function backdateSessionEnd(
  db: Database,
  where: { sessionId: string },
  endsAt: Date,
): Promise<void> {
  assertNotProduction('backdateSessionEnd', 'sessions');
  await db
    .update(schema.sessions)
    .set({ endsAt })
    .where(and(eq(schema.sessions.id, where.sessionId), isNull(schema.sessions.endedAt)));
}
