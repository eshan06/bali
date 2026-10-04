import { and, eq, isNull } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import * as schema from '../src/schema.js';
import {
  backdateLastSeen,
  backdateSessionEnd,
  dropDatabase,
  makeTestDb,
  recreateDatabase,
} from '../src/testing.js';
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

describe('dropDatabase', () => {
  // The name is quoted into SQL, so anything but a plain one is refused before any connection:
  // nothing listens at this port, and a check after connecting would fail on that instead.
  it('refuses a name that is not a plain lower-case one', async () => {
    const server = 'postgres://unused@127.0.0.1:1/postgres';
    for (const name of ['bali_load"; DROP DATABASE postgres; --', 'Bali', '', '1st']) {
      await expect(dropDatabase(server, name)).rejects.toThrow(/not a plain database name/);
    }
  });
});

/*
 * The helpers that drop databases carry the same guard, checked before any connection: nothing
 * listens at this port, so a helper that connected first would fail on that instead.
 */
describe('the helpers that drop databases', () => {
  const server = 'postgres://unused@127.0.0.1:1/postgres';
  const helpers = {
    dropDatabase: () => dropDatabase(server, 'bali_load'),
    recreateDatabase: () => recreateDatabase(server, 'bali_load'),
    // On the real-Postgres path: it makes a database that its close() drops.
    makeTestDb: () => {
      const saved = process.env.TEST_DATABASE_URL;
      process.env.TEST_DATABASE_URL = server;
      return makeTestDb().finally(() => {
        if (saved === undefined) delete process.env.TEST_DATABASE_URL;
        else process.env.TEST_DATABASE_URL = saved;
      });
    },
  };

  for (const [name, run] of Object.entries(helpers)) {
    for (const env of ['production', undefined]) {
      it(`${name} refuses to run with NODE_ENV=${env ?? '<unset>'}, before connecting`, async () => {
        const saved = process.env.NODE_ENV;
        try {
          if (env === undefined) delete process.env.NODE_ENV;
          else process.env.NODE_ENV = env;
          await expect(run()).rejects.toThrow(`${name} is a test-only helper`);
        } finally {
          if (saved === undefined) delete process.env.NODE_ENV;
          else process.env.NODE_ENV = saved;
        }
      });
    }
  }
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
