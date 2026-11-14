import { randomBytes } from 'node:crypto';

import { and, asc, eq, gt, sql } from 'drizzle-orm';
import { validate, version } from 'uuid';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { newUuidV7 } from '../src/ids.js';
import { makeTestDb } from '../src/testing.js';
import type { Database } from '../src/types.js';
import {
  blocks,
  classes,
  deviceTokens,
  enrollments,
  events,
  participations,
  schools,
  sessions,
  users,
} from '../src/schema.js';

/*
 * These tests run the committed migrations against the test database (PGlite by
 * default, real Postgres when TEST_DATABASE_URL is set — both are Postgres) and
 * then try to break every rule the database is supposed to enforce. Each test
 * seeds its own rows, so they share one instance.
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

let db: Database;
let close: () => Promise<void>;

beforeAll(async () => {
  ({ db, close } = await makeTestDb());
});

afterAll(async () => {
  await close();
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
    // Row triggers don't see TRUNCATE — the statement trigger must catch it.
    await expectRefused(db.execute(sql`TRUNCATE TABLE events`), /events is append-only: TRUNCATE/);
  });

  it('numbers the stream so the catch-up read works: after seq N, one session, in order', async () => {
    const a = await seedClassroom('ev-catchup-a');
    const b = await seedClassroom('ev-catchup-b');
    const [sessionA, sessionB] = [
      one(
        await db
          .insert(sessions)
          .values({ classId: a.klass.id, ...sessionWindow() })
          .returning(),
      ),
      one(
        await db
          .insert(sessions)
          .values({ classId: b.klass.id, ...sessionWindow() })
          .returning(),
      ),
    ];

    // Interleave events across the two sessions, remembering where A's stream was.
    const insertEvent = async (sessionId: string, userId: string, type: 'tap_in' | 'unlock') =>
      one(
        await db
          .insert(events)
          .values({ eventId: newUuidV7(), type, sessionId, userId, occurredAt: new Date() })
          .returning(),
      );
    const seen = await insertEvent(sessionA.id, a.student.id, 'tap_in');
    await insertEvent(sessionB.id, b.student.id, 'tap_in');
    const later1 = await insertEvent(sessionA.id, a.student.id, 'unlock');
    await insertEvent(sessionB.id, b.student.id, 'unlock');
    const later2 = await insertEvent(sessionA.id, a.student.id, 'tap_in');

    // The reconnect read: everything for session A after the last seq the screen saw.
    const caughtUp = await db
      .select()
      .from(events)
      .where(and(eq(events.sessionId, sessionA.id), gt(events.seq, seen.seq)))
      .orderBy(asc(events.seq));

    expect(caughtUp.map((row) => row.eventId)).toEqual([later1.eventId, later2.eventId]);
    expect(caughtUp.every((row) => row.seq > seen.seq)).toBe(true);
  });
});

describe('natural keys', () => {
  it('one users row per Cognito account — total, so the account always reuses its row', async () => {
    await db.insert(users).values({ cognitoId: 'cognito-dup', role: 'student' });
    await expectRefused(
      db.insert(users).values({ cognitoId: 'cognito-dup', role: 'student' }),
      /duplicate key.*users_cognito_id_unique/,
    );
  });

  it('a physical tag has one active block, and can be re-registered after removal', async () => {
    const { teacher } = await seedClassroom('tag');
    const block = one(
      await db.insert(blocks).values({ tagId: 'TAG-recycled', teacherId: teacher.id }).returning(),
    );

    await expectRefused(
      db.insert(blocks).values({ tagId: 'TAG-recycled', teacherId: teacher.id }),
      /duplicate key.*blocks_tag_active_unique/,
    );

    // The block is handed to another teacher: soft-remove, then re-register.
    await db.update(blocks).set({ removedAt: new Date() }).where(eq(blocks.id, block.id));
    const other = await seedClassroom('tag-other');
    await expect(
      db.insert(blocks).values({ tagId: 'TAG-recycled', teacherId: other.teacher.id }),
    ).resolves.toBeDefined();
  });

  it('a join code is unique among live classes, and freed when a class is archived', async () => {
    const { teacher, school, klass } = await seedClassroom('code');

    await expectRefused(
      db.insert(classes).values({
        teacherId: teacher.id,
        schoolId: school.id,
        name: 'Copycat',
        joinCode: klass.joinCode,
      }),
      /duplicate key.*classes_join_code_active_unique/,
    );

    await db.update(classes).set({ removedAt: new Date() }).where(eq(classes.id, klass.id));
    await expect(
      db.insert(classes).values({
        teacherId: teacher.id,
        schoolId: school.id,
        name: 'Next year',
        joinCode: klass.joinCode,
      }),
    ).resolves.toBeDefined();
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
      endedReason: 'session_ended',
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

describe('foreign keys', () => {
  it('a referenced row cannot be hard-deleted — removal means removed_at, not DELETE', async () => {
    const { school } = await seedClassroom('fk');
    await expectRefused(
      db.delete(schools).where(eq(schools.id, school.id)),
      /violates foreign key constraint/,
    );
  });
});

describe('device tokens: each service its own format, one token one key (AN11a)', () => {
  const student = async (tag: string) =>
    one(
      await db
        .insert(users)
        .values({ cognitoId: `an11a-${tag}-${newUuidV7()}`, role: 'student' })
        .returning(),
    );
  /** An APNs token as stored: lower-case hex. */
  const hex = () => newUuidV7().replace(/-/g, '').repeat(2);
  /** An FCM token, shaped as FCM's are: mixed case, `:`, `-` and `_`. */
  const fcm = () => `fAb${randomBytes(8).toString('base64url')}:APA91b-${randomBytes(90).toString('base64url')}_`;
  const row = (userId: string, token: string, more: Record<string, unknown> = {}) => ({
    token,
    userId,
    environment: 'production' as const,
    eventId: newUuidV7(),
    ...more,
  });
  const tokenRow = async (token: string) =>
    one(await db.select().from(deviceTokens).where(eq(deviceTokens.token, token)));

  it('keeps an FCM token as written, case and all, and reads a row naming no service as APNs’s', async () => {
    const s = await student('kept');
    const token = fcm();
    await db.insert(deviceTokens).values(row(s.id, token, { service: 'fcm' }));
    expect(await tokenRow(token)).toMatchObject({ token, service: 'fcm', environment: 'production' });
    // Written as before AN11a, naming no service: the column's default, APNs's.
    const apns = hex();
    await db.execute(
      sql`insert into device_tokens (token, user_id, environment, event_id)
        values (${apns}, ${s.id}, 'sandbox', ${newUuidV7()})`,
    );
    expect(await tokenRow(apns)).toMatchObject({ service: 'apns', environment: 'sandbox' });
  });

  it('holds the longest FCM token the API reads as the table’s key', async () => {
    const s = await student('longest');
    // Random, so nothing compresses it: the key holds it as it is.
    const token = randomBytes(1536).toString('base64url');
    expect(token).toHaveLength(2048);
    await db.insert(deviceTokens).values(row(s.id, token, { service: 'fcm' }));
    expect((await tokenRow(token)).service).toBe('fcm');
  });

  it('refuses a token its service has not, an environment FCM has not, and a service there is not', async () => {
    const s = await student('refused');
    const refused = (token: string, more: Record<string, unknown>, reason: RegExp) =>
      expectRefused(db.insert(deviceTokens).values(row(s.id, token, more)), reason);
    const format = /device_tokens_token_format/;
    // An FCM-shaped token marked APNs's, and every token an APNs token could be marked FCM's.
    await refused(fcm(), { service: 'apns' }, format);
    await refused(hex(), { service: 'fcm' }, format);
    await refused(hex().toUpperCase(), { service: 'fcm' }, format);
    await refused(`${fcm()}.x`, { service: 'fcm' }, format);
    await refused('', { service: 'fcm' }, format);
    await refused('A'.repeat(2049), { service: 'fcm' }, format);
    await refused(fcm(), { service: 'fcm', environment: 'sandbox' }, /device_tokens_environment/);
    await refused(hex(), { service: 'gcm' }, /device_tokens_service/);
    expect(await db.select().from(deviceTokens).where(eq(deviceTokens.userId, s.id))).toEqual([]);
  });

  it('lets no token be both services’: an APNs token and an FCM token can’t be equal, so a token keys one row', async () => {
    const s = await student('one-key');
    const apns = hex();
    await db.insert(deviceTokens).values(row(s.id, apns));
    // The same token marked the other service's is refused by its format, before the key.
    await expectRefused(
      db.insert(deviceTokens).values(row(s.id, apns, { service: 'fcm' })),
      /device_tokens_token_format/,
    );
    const token = fcm();
    await db.insert(deviceTokens).values(row(s.id, token, { service: 'fcm' }));
    await expectRefused(
      db.insert(deviceTokens).values(row(s.id, token, { service: 'apns' })),
      /device_tokens_token_format/,
    );
    expect(await tokenRow(apns)).toMatchObject({ service: 'apns' });
    expect(await tokenRow(token)).toMatchObject({ service: 'fcm' });
    expect(await db.$count(deviceTokens, eq(deviceTokens.userId, s.id))).toBe(2);
  });
});
