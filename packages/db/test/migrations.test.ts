import { randomBytes, randomUUID } from 'node:crypto';
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { PGlite } from '@electric-sql/pglite';
import { eq, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { drizzle as drizzlePostgres } from 'drizzle-orm/postgres-js';
import { migrate as migratePostgres } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { newUuidV7 } from '../src/ids.js';
import { MIGRATIONS_DIR } from '../src/paths.js';
import * as schema from '../src/schema.js';
import { armedTaps, deviceTokens, events, users } from '../src/schema.js';
import { createDatabase, databaseUrl, dropDatabase } from '../src/testing.js';
import type { Database } from '../src/types.js';

/*
 * A migration that changes rows or rules already there, run as a deploy runs it: on a database
 * migrated up to the one before it and holding rows, then migrated the rest of the way.
 * PGlite on both lanes, the rows the test's own and nothing racing; a migration whose rules are
 * Postgres's own to judge runs on real Postgres too, where TEST_DATABASE_URL names one.
 */

/** A copy of the migrations folder whose journal stops before `tag`. */
async function migrationsBefore(tag: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'bali-migrations-'));
  await cp(MIGRATIONS_DIR, dir, { recursive: true });
  const path = join(dir, 'meta', '_journal.json');
  const journal = JSON.parse(await readFile(path, 'utf8')) as { entries: { tag: string }[] };
  const at = journal.entries.findIndex((entry) => entry.tag === tag);
  if (at < 0) throw new Error(`no migration ${tag} in the journal`);
  journal.entries = journal.entries.slice(0, at);
  await writeFile(path, JSON.stringify(journal));
  return dir;
}

describe('migration 0029: the phone’s order emptied on records made nameless before it (A12)', () => {
  let pg: PGlite;
  let db: ReturnType<typeof drizzle<typeof schema>>;
  let before: string;

  beforeAll(async () => {
    pg = new PGlite();
    db = drizzle(pg, { schema });
    before = await migrationsBefore('0029_deidentified_order');
    await migrate(db, { migrationsFolder: before });
  });

  afterAll(async () => {
    await pg?.close();
    if (before) await rm(before, { recursive: true, force: true });
  });

  it('empties it on a removed account’s events and taps, and leaves every other row as it was', async () => {
    const [gone, live, teacher] = await db
      .insert(users)
      .values([
        // De-identified before this migration: removed, every record still ordered.
        { cognitoId: 'deleted:gone', role: 'student', removedAt: new Date() },
        { cognitoId: 'live', role: 'student', displayName: 'Live' },
        { cognitoId: 'teacher', role: 'teacher' },
      ])
      .returning();
    if (!gone || !live || !teacher) throw new Error('seed');
    const [hers, theirs] = [newUuidV7(), newUuidV7()];
    const event = (
      userId: string | null,
      type: (typeof events.$inferInsert)['type'],
      order: { install: string; seq: number } | null,
    ) => ({
      eventId: newUuidV7(),
      type,
      userId,
      occurredAt: new Date(),
      payload: type === 'unlock' ? { reason: 'nurse', recorded_as: 'no_live_participation' } : null,
      orderInstall: order?.install ?? null,
      orderSeq: order?.seq ?? null,
    });
    await db
      .insert(events)
      .values([
        event(gone.id, 'tap_in', { install: hers, seq: 1 }),
        event(gone.id, 'unlock', { install: hers, seq: 2 }),
        event(gone.id, 'account_deleted', null),
        event(live.id, 'tap_in', { install: theirs, seq: 1 }),
        event(live.id, 'unlock', { install: theirs, seq: 2 }),
        event(null, 'school_disposed', null),
      ]);
    const tap = (
      studentId: string,
      order: { install: string; seq: number },
      consumed: boolean,
    ) => ({
      studentId,
      teacherId: teacher.id,
      eventId: newUuidV7(),
      deviceTime: new Date(),
      orderInstall: order.install,
      orderSeq: order.seq,
      expiresAt: new Date(Date.now() + 3_600_000),
      consumedAt: consumed ? new Date() : null,
    });
    await db
      .insert(armedTaps)
      .values([
        tap(gone.id, { install: hers, seq: 3 }, true),
        tap(live.id, { install: theirs, seq: 3 }, false),
      ]);
    const rows = async () => ({
      events: await db.select().from(events).orderBy(events.seq),
      armed: await db.select().from(armedTaps).orderBy(armedTaps.createdAt, armedTaps.id),
      users: await db.select().from(users).orderBy(users.id),
    });
    const was = await rows();

    await migrate(db, { migrationsFolder: MIGRATIONS_DIR });

    const now = await rows();
    const emptied = <T extends { orderInstall: string | null; orderSeq: number | null }>(
      row: T,
      owner: string,
    ) => (owner === gone.id ? { ...row, orderInstall: null, orderSeq: null } : row);
    expect(now.events).toEqual(was.events.map((e) => emptied(e, e.userId ?? '')));
    expect(now.armed).toEqual(was.armed.map((a) => emptied(a, a.studentId)));
    expect(now.users).toEqual(was.users);
    expect(await db.select().from(events).where(eq(events.orderInstall, hers))).toEqual([]);
    expect(await db.select().from(armedTaps).where(eq(armedTaps.orderInstall, hers))).toEqual([]);
    // Behind it the history is append-only as ever: a live account's order stays.
    const err = await db
      .execute(
        sql`update ${events} set order_install = null, order_seq = null
          where ${events.userId} = ${live.id}`,
      )
      .then(
        () => null,
        (e: unknown) => e,
      );
    const messages: string[] = [];
    for (let e = err; e instanceof Error; e = e.cause) messages.push(e.message);
    expect(messages.join('\n')).toMatch(/events is append-only/);
  });
});

/** A database migrated up to the one before a migration, and how to run the rest of the way. */
interface Staged {
  db: Database;
  rest: () => Promise<void>;
  close: () => Promise<void>;
}

/** On PGlite, in process. */
async function stagedOnPglite(tag: string): Promise<Staged> {
  const pg = new PGlite();
  const db = drizzle(pg, { schema });
  const before = await migrationsBefore(tag);
  await migrate(db, { migrationsFolder: before });
  return {
    db,
    rest: () => migrate(db, { migrationsFolder: MIGRATIONS_DIR }),
    close: async () => {
      await pg.close();
      await rm(before, { recursive: true, force: true });
    },
  };
}

/** On the real Postgres at `url`, in a database of its own, dropped at the close. */
async function stagedOnPostgres(url: string, tag: string): Promise<Staged> {
  const name = `bali_test_${randomUUID().replace(/-/g, '')}`;
  const admin = postgres(url, { max: 1, onnotice: () => {} });
  try {
    await createDatabase(admin, name);
  } finally {
    await admin.end({ timeout: 5 });
  }
  const client = postgres(databaseUrl(url, name), { max: 1, onnotice: () => {} });
  const db = drizzlePostgres(client, { schema });
  const before = await migrationsBefore(tag);
  await migratePostgres(db, { migrationsFolder: before });
  return {
    db,
    rest: () => migratePostgres(db, { migrationsFolder: MIGRATIONS_DIR }),
    close: async () => {
      await client.end({ timeout: 5 }).catch(() => {});
      await dropDatabase(url, name);
      await rm(before, { recursive: true, force: true });
    },
  };
}

const REAL_PG = process.env.TEST_DATABASE_URL;
const lanes: [string, (tag: string) => Promise<Staged>][] = [['PGlite', stagedOnPglite]];
if (REAL_PG) lanes.push(['real Postgres', (tag) => stagedOnPostgres(REAL_PG, tag)]);

/** Why `write` was refused: every message down its causes, or '' when it was not. */
async function refusal(write: Promise<unknown>): Promise<string> {
  const err = await write.then(
    () => null,
    (e: unknown) => e,
  );
  const messages: string[] = [];
  for (let e = err; e instanceof Error; e = e.cause) messages.push(e.message);
  return messages.join('\n');
}

describe.each(lanes)('migration 0031 on %s: the push token’s service (AN11a)', (_, stage) => {
  it('makes every token before it APNs’s, changing nothing else, and holds each service to its own format', async () => {
    const staged = await stage('0031_push_token_service');
    try {
      const { db } = staged;
      const [ana] = await db
        .insert(users)
        .values({ cognitoId: `an11a-migration-${newUuidV7()}`, role: 'student' })
        .returning();
      if (!ana) throw new Error('seed');
      const apns = newUuidV7().replace(/-/g, '').repeat(2);
      // As the API wrote a token before AN11a: no service, a column there was not.
      await db.execute(
        sql`insert into device_tokens (token, user_id, environment, event_id)
          values (${apns}, ${ana.id}, 'sandbox', ${newUuidV7()})`,
      );
      const was = await db
        .select({
          token: deviceTokens.token,
          userId: deviceTokens.userId,
          environment: deviceTokens.environment,
          eventId: deviceTokens.eventId,
          createdAt: deviceTokens.createdAt,
          updatedAt: deviceTokens.updatedAt,
        })
        .from(deviceTokens);

      await staged.rest();

      expect(await db.select().from(deviceTokens)).toEqual(
        was.map((row) => ({ ...row, service: 'apns' })),
      );
      // From here each service has its own format: FCM's kept as written, case and all.
      const fcmToken = () =>
        `fAb${randomBytes(8).toString('base64url')}:APA91b-${randomBytes(90).toString('base64url')}`;
      const row = (token: string, service: 'apns' | 'fcm') => ({
        token,
        userId: ana.id,
        service,
        environment: 'production' as const,
        eventId: newUuidV7(),
      });
      const fcm = fcmToken();
      await db.insert(deviceTokens).values(row(fcm, 'fcm'));
      const [kept] = await db.select().from(deviceTokens).where(eq(deviceTokens.token, fcm));
      expect(kept).toMatchObject({ token: fcm, service: 'fcm' });
      const format = /device_tokens_token_format/;
      const hex = newUuidV7().replace(/-/g, '').repeat(2);
      expect(await refusal(db.insert(deviceTokens).values(row(fcmToken(), 'apns')))).toMatch(
        format,
      );
      expect(await refusal(db.insert(deviceTokens).values(row(hex, 'fcm')))).toMatch(format);
    } finally {
      await staged.close();
    }
  });
});
