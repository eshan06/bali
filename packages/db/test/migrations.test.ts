import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { PGlite } from '@electric-sql/pglite';
import { eq, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { newUuidV7 } from '../src/ids.js';
import { MIGRATIONS_DIR } from '../src/paths.js';
import * as schema from '../src/schema.js';
import { armedTaps, events, users } from '../src/schema.js';

/*
 * A migration that rewrites rows already there, run as a deploy runs it: on a database
 * migrated up to the one before it and holding rows, then migrated the rest of the way.
 * PGlite, on both lanes: the rows are the test's own, and nothing here races.
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
