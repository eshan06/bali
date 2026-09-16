import { PGlite } from '@electric-sql/pglite';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { validate, version } from 'uuid';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { newUuidV7 } from '../src/ids.js';
import {
  classes,
  enrollments,
  events,
  participations,
  schools,
  sessions,
  users,
} from '../src/schema.js';

/*
 * These tests run the committed migrations against PGlite — real Postgres,
 * in-process — and then try to break every rule the database is supposed to
 * enforce. Each test seeds its own rows, so they share one instance.
 */

/**
 * Asserts a write is refused by the database for the expected reason. Drizzle
 * wraps driver errors ("Failed query: …") with the real Postgres error in
 * `cause`, so the assertion digs the message out of the cause chain.
 */
async function expectRefused(promise: Promise<unknown>, reason: RegExp) {
  const outcome = await promise.then(
    () => null,
    (error: unknown) => error,
  );
  expect(outcome, 'expected the database to refuse this write').not.toBeNull();
  const messages: string[] = [];
  for (let err = outcome; err instanceof Error; err = err.cause) {
    messages.push(err.message);
  }
  expect(messages.join('\n')).toMatch(reason);
}

/** Unwraps a single-row `.returning()` under noUncheckedIndexedAccess. */
function one<T>(rows: T[]): T {
  const row = rows[0];
  if (rows.length !== 1 || row === undefined) throw new Error('expected exactly one row');
  return row;
}

let pg: PGlite;
let db: ReturnType<typeof drizzle>;

beforeAll(async () => {
  pg = new PGlite();
  db = drizzle(pg);
  await migrate(db, { migrationsFolder: new URL('../migrations', import.meta.url).pathname });
});

afterAll(async () => {
  await pg.close();
});

/** One school, one teacher, one student, one class with the student enrolled. */
async function seedClassroom(tag: string) {
  const school = one(
    await db
      .insert(schools)
      .values({ name: `School ${tag}` })
      .returning(),
  );
  const teacher = one(
    await db
      .insert(users)
      .values({ cognitoId: `teacher-${tag}`, role: 'teacher', schoolId: school.id })
      .returning(),
  );
  const student = one(
    await db
      .insert(users)
      .values({ cognitoId: `student-${tag}`, role: 'student', schoolId: school.id })
      .returning(),
  );
  const klass = one(
    await db
      .insert(classes)
      .values({
        teacherId: teacher.id,
        schoolId: school.id,
        name: `Class ${tag}`,
        joinCode: `JOIN-${tag}`,
      })
      .returning(),
  );
  await db.insert(enrollments).values({ classId: klass.id, studentId: student.id });
  return { school, teacher, student, klass };
}

function sessionWindow() {
  const startedAt = new Date();
  return { startedAt, endsAt: new Date(startedAt.getTime() + 25 * 60 * 1000) };
}

describe('ids', () => {
  it('rows minted server-side get UUIDv7 ids', async () => {
    const school = one(await db.insert(schools).values({ name: 'ID School' }).returning());
    expect(validate(school.id)).toBe(true);
    expect(version(school.id)).toBe(7);
  });
});

describe('events', () => {
  it('refuses a duplicate event_id — a retry counts once', async () => {
    const { klass, student } = await seedClassroom('ev-dup');
    const eventId = newUuidV7();
    const row = {
      eventId,
      type: 'tap_in' as const,
      classId: klass.id,
      userId: student.id,
      occurredAt: new Date(),
    };

    await db.insert(events).values(row);
    await expectRefused(db.insert(events).values(row), /duplicate key.*events_event_id_unique/);

    // The retry-safe write path: same insert with ON CONFLICT DO NOTHING.
    await db.insert(events).values(row).onConflictDoNothing();
    const stored = await db.select().from(events).where(eq(events.eventId, eventId));
    expect(stored).toHaveLength(1);
  });

  it('is append-only: the database refuses UPDATE and DELETE', async () => {
    const { klass, student } = await seedClassroom('ev-frozen');
    const eventId = newUuidV7();
    await db.insert(events).values({
      eventId,
      type: 'unlock',
      classId: klass.id,
      userId: student.id,
      occurredAt: new Date(),
    });

    await expectRefused(
      db.update(events).set({ type: 'refocus' }).where(eq(events.eventId, eventId)),
      /events is append-only: UPDATE/,
    );
    await expectRefused(
      db.delete(events).where(eq(events.eventId, eventId)),
      /events is append-only: DELETE/,
    );
  });

  it('hands out increasing stream numbers', async () => {
    const { klass, student } = await seedClassroom('ev-seq');
    const inserted = [];
    for (const type of ['tap_in', 'unlock', 'refocus'] as const) {
      const row = one(
        await db
          .insert(events)
          .values({
            eventId: newUuidV7(),
            type,
            classId: klass.id,
            userId: student.id,
            occurredAt: new Date(),
          })
          .returning(),
      );
      inserted.push(row);
    }
    const seqs = inserted.map((row) => row.seq);
    expect(seqs).toHaveLength(3);
    expect(new Set(seqs).size).toBe(3);
    expect(seqs).toEqual([...seqs].sort((a, b) => a - b));
  });
});

describe('sessions', () => {
  it('one class cannot have two sessions running', async () => {
    const { klass } = await seedClassroom('sess-dup');
    const first = one(
      await db
        .insert(sessions)
        .values({ classId: klass.id, ...sessionWindow() })
        .returning(),
    );

    await expectRefused(
      db.insert(sessions).values({ classId: klass.id, ...sessionWindow() }),
      /duplicate key.*sessions_one_running_per_class/,
    );

    // Once the first session has ended, a new one is fine.
    await db.update(sessions).set({ endedAt: new Date() }).where(eq(sessions.id, first.id));
    await expect(
      db.insert(sessions).values({ classId: klass.id, ...sessionWindow() }),
    ).resolves.toBeDefined();
  });
});

describe('enrollments', () => {
  it('a student is enrolled once while active, and can re-join after removal', async () => {
    const { klass, student } = await seedClassroom('enr');

    // seedClassroom already enrolled the student — a second active row is refused.
    await expectRefused(
      db.insert(enrollments).values({ classId: klass.id, studentId: student.id }),
      /duplicate key.*enrollments_active_unique/,
    );

    // Soft-remove (never DELETE), then re-joining creates a fresh row.
    await db
      .update(enrollments)
      .set({ removedAt: new Date() })
      .where(eq(enrollments.studentId, student.id));
    await expect(
      db.insert(enrollments).values({ classId: klass.id, studentId: student.id }),
    ).resolves.toBeDefined();
  });
});

describe('participations', () => {
  it('a student can be in only one live session at a time', async () => {
    const a = await seedClassroom('part-a');
    const b = await seedClassroom('part-b');
    const sessionA = one(
      await db
        .insert(sessions)
        .values({ classId: a.klass.id, ...sessionWindow() })
        .returning(),
    );
    const sessionB = one(
      await db
        .insert(sessions)
        .values({ classId: b.klass.id, ...sessionWindow() })
        .returning(),
    );

    const live = one(
      await db
        .insert(participations)
        .values({
          sessionId: sessionA.id,
          studentId: a.student.id,
          state: 'focused',
          joinedAt: new Date(),
        })
        .returning(),
    );

    // Same student, second live participation (other session) — refused.
    await expectRefused(
      db.insert(participations).values({
        sessionId: sessionB.id,
        studentId: a.student.id,
        state: 'focused',
        joinedAt: new Date(),
      }),
      /duplicate key.*participations_one_live_per_student/,
    );

    // End the first (the left_for_other_session flow) — now joining B works.
    await db
      .update(participations)
      .set({ endedAt: new Date(), endedReason: 'left_for_other_session' })
      .where(eq(participations.id, live.id));
    await expect(
      db.insert(participations).values({
        sessionId: sessionB.id,
        studentId: a.student.id,
        state: 'focused',
        joinedAt: new Date(),
      }),
    ).resolves.toBeDefined();
  });

  it('one row per student per session, even after it ended', async () => {
    const { klass, student } = await seedClassroom('part-one-row');
    const session = one(
      await db
        .insert(sessions)
        .values({ classId: klass.id, ...sessionWindow() })
        .returning(),
    );
    await db.insert(participations).values({
      sessionId: session.id,
      studentId: student.id,
      state: 'focused',
      joinedAt: new Date(),
      endedAt: new Date(),
    });

    // Re-joining the same session must update the row, never add a second one.
    await expectRefused(
      db.insert(participations).values({
        sessionId: session.id,
        studentId: student.id,
        state: 'focused',
        joinedAt: new Date(),
      }),
      /duplicate key.*participations_session_student_unique/,
    );
  });
});

describe('soft delete', () => {
  it('a referenced row cannot be hard-deleted', async () => {
    const { school } = await seedClassroom('fk');
    await expectRefused(
      db.delete(schools).where(eq(schools.id, school.id)),
      /violates foreign key constraint/,
    );
  });
});
