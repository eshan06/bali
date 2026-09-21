import { and, eq, isNull } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import * as schema from '../src/schema.js';
import { backdateLastSeen, backdateSessionEnd, makeTestDb } from '../src/testing.js';
import type { Database } from '../src/types.js';

/*
 * `@bali/db/testing` is a public subpath and the production image runs this
 * package's TypeScript straight from source, so "only tests call it" is a
 * convention, not a mechanism. These helpers write `participations` and
 * `sessions` behind the transition engine, so each carries its own guard —
 * these pin them.
 */
describe('backdateLastSeen', () => {
  // An unusable handle: the guard must reject before anything touches the
  // database, so no query can be attempted on it.
  const unusable = {} as Database;
  const where = { sessionId: 'session', studentId: 'student' };

  it('refuses to run with NODE_ENV=production', async () => {
    const saved = process.env.NODE_ENV;
    try {
      process.env.NODE_ENV = 'production';
      await expect(backdateLastSeen(unusable, where, new Date())).rejects.toThrow(
        /test-only helper/,
      );
    } finally {
      process.env.NODE_ENV = saved;
    }
  });

  it('refuses to run with NODE_ENV unset — the image default, so it denies by default', async () => {
    const saved = process.env.NODE_ENV;
    try {
      delete process.env.NODE_ENV;
      await expect(backdateLastSeen(unusable, where, new Date())).rejects.toThrow(
        /test-only helper/,
      );
    } finally {
      process.env.NODE_ENV = saved;
    }
  });
});

describe('backdateSessionEnd', () => {
  const unusable = {} as Database;
  const where = { sessionId: 'session' };

  it('refuses to run with NODE_ENV=production', async () => {
    const saved = process.env.NODE_ENV;
    try {
      process.env.NODE_ENV = 'production';
      await expect(backdateSessionEnd(unusable, where, new Date())).rejects.toThrow(
        /test-only helper/,
      );
    } finally {
      process.env.NODE_ENV = saved;
    }
  });

  it('refuses to run with NODE_ENV unset — the image default, so it denies by default', async () => {
    const saved = process.env.NODE_ENV;
    try {
      delete process.env.NODE_ENV;
      await expect(backdateSessionEnd(unusable, where, new Date())).rejects.toThrow(
        /test-only helper/,
      );
    } finally {
      process.env.NODE_ENV = saved;
    }
  });

  it('names the table it writes, so the guard message stays specific', async () => {
    const saved = process.env.NODE_ENV;
    try {
      process.env.NODE_ENV = 'production';
      await expect(backdateSessionEnd(unusable, where, new Date())).rejects.toThrow(/sessions/);
      await expect(
        backdateLastSeen(unusable, { sessionId: 's', studentId: 'x' }, new Date()),
      ).rejects.toThrow(/participations/);
    } finally {
      process.env.NODE_ENV = saved;
    }
  });
});

/*
 * The guard is only half of it: backdateSessionEnd's single consumer is the
 * demo, which CI does not run, so a wrong where-clause would ship green. These
 * pin what it actually does.
 */
describe('backdateSessionEnd, against a database', () => {
  // In a hook, like every other db suite: standing up PGlite (or creating and
  // migrating a throwaway database on the real-Postgres lane) costs seconds,
  // and only hooks get vitest's 10s budget — inside `it` it shares the 5s one
  // and goes red under a loaded full-suite run.
  let db: Awaited<ReturnType<typeof makeTestDb>>['db'];
  let close: () => Promise<void>;

  beforeAll(async () => {
    ({ db, close } = await makeTestDb());
  });

  afterAll(async () => {
    await close();
  });

  it('moves a running session end time and leaves an already-ended one alone', async () => {
    {
      const [school] = await db.insert(schema.schools).values({ name: 'S' }).returning();
      const [teacher] = await db
        .insert(schema.users)
        .values({ cognitoId: 'tt', role: 'teacher', schoolId: school!.id })
        .returning();
      const [klass] = await db
        .insert(schema.classes)
        .values({ teacherId: teacher!.id, schoolId: school!.id, name: 'C', joinCode: 'JC1' })
        .returning();

      const startedAt = new Date(Date.now() - 60_000);
      const farFuture = new Date(Date.now() + 600_000);
      const [running] = await db
        .insert(schema.sessions)
        .values({ classId: klass!.id, startedAt, endsAt: farFuture })
        .returning();
      const [ended] = await db
        .insert(schema.sessions)
        .values({ classId: klass!.id, startedAt, endsAt: farFuture, endedAt: new Date() })
        .returning();
      // A second RUNNING session, in its own class so the one-running-per-class
      // index allows it. Without this, a where-clause of only isNull(endedAt) —
      // which would backdate every live session on the deployment — passes.
      const [other] = await db
        .insert(schema.classes)
        .values({ teacherId: teacher!.id, schoolId: school!.id, name: 'C2', joinCode: 'JC2' })
        .returning();
      const [bystander] = await db
        .insert(schema.sessions)
        .values({ classId: other!.id, startedAt, endsAt: farFuture })
        .returning();

      const target = new Date(startedAt.getTime() + 1);
      await backdateSessionEnd(db, { sessionId: running!.id }, target);
      await backdateSessionEnd(db, { sessionId: ended!.id }, target);

      const rows = await db
        .select()
        .from(schema.sessions)
        .where(eq(schema.sessions.classId, klass!.id));
      const after = new Map(rows.map((r) => [r.id, r]));

      expect(after.get(running!.id)?.endsAt.getTime()).toBe(target.getTime());
      // Scoped by id, not just by "is running".
      const untouched = await db
        .select()
        .from(schema.sessions)
        .where(eq(schema.sessions.id, bystander!.id));
      expect(untouched[0]?.endsAt.getTime()).toBe(farFuture.getTime());
      // The isNull(endedAt) guard must skip a session that already ended.
      expect(after.get(ended!.id)?.endsAt.getTime()).toBe(farFuture.getTime());

      const stillLive = await db
        .select()
        .from(schema.sessions)
        .where(and(eq(schema.sessions.id, ended!.id), isNull(schema.sessions.endedAt)));
      expect(stillLive).toHaveLength(0);
    }
  });
});
