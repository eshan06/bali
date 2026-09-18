import { and, eq } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  checkIn,
  endSession,
  markSilentParticipations,
  startSession,
  tapIn,
  unlock,
} from '../src/transitions.js';
import { classes, enrollments, events, participations, schools, users } from '../src/schema.js';
import { makeTestDb } from '../src/testing.js';
import type { Database } from '../src/types.js';

let db: Database;
let close: () => Promise<void>;

beforeAll(async () => {
  ({ db, close } = await makeTestDb());
});

afterAll(async () => {
  await close();
});

function one<T>(rows: T[]): T {
  const row = rows[0];
  if (rows.length !== 1 || row === undefined) throw new Error('expected exactly one row');
  return row;
}

/** A running session with one enrolled, tapped-in (focused) student. */
async function seed(tag: string) {
  const school = one(
    await db
      .insert(schools)
      .values({ name: `S ${tag}` })
      .returning(),
  );
  const teacher = one(
    await db
      .insert(users)
      .values({ cognitoId: `t-${tag}`, role: 'teacher', schoolId: school.id })
      .returning(),
  );
  const student = one(
    await db
      .insert(users)
      .values({ cognitoId: `s-${tag}`, role: 'student', schoolId: school.id })
      .returning(),
  );
  const klass = one(
    await db
      .insert(classes)
      .values({
        teacherId: teacher.id,
        schoolId: school.id,
        name: `C ${tag}`,
        joinCode: `J-${tag}`,
      })
      .returning(),
  );
  await db.insert(enrollments).values({ classId: klass.id, studentId: student.id });
  const session = (
    await startSession(db, {
      classId: klass.id,
      startedAt: new Date(Date.now() - 60_000),
      endsAt: new Date(Date.now() + 25 * 60_000),
    })
  ).session;
  await tapIn(db, {
    sessionId: session.id,
    studentId: student.id,
    eventId: randomUUID(),
    deviceTime: new Date(),
  });
  return { session, studentId: student.id };
}

async function backdateContact(sessionId: string, studentId: string, agoMs: number) {
  await db
    .update(participations)
    .set({ lastSeenAt: new Date(Date.now() - agoMs) })
    .where(and(eq(participations.sessionId, sessionId), eq(participations.studentId, studentId)));
}

async function eventsOf(sessionId: string, type: string) {
  return db
    .select()
    .from(events)
    .where(and(eq(events.sessionId, sessionId), eq(events.type, type as 'went_silent')));
}

async function participationOf(sessionId: string, studentId: string) {
  return one(
    await db
      .select()
      .from(participations)
      .where(and(eq(participations.sessionId, sessionId), eq(participations.studentId, studentId))),
  );
}

const SILENT_AGO = 5 * 60_000; // well past the 90s threshold

describe('markSilentParticipations', () => {
  it('opens an episode for a focused phone gone quiet, exactly once', async () => {
    const { session, studentId } = await seed('sil-open');
    await backdateContact(session.id, studentId, SILENT_AGO);

    expect(await markSilentParticipations(db, new Date())).toBe(1);
    expect(await eventsOf(session.id, 'went_silent')).toHaveLength(1);
    expect((await participationOf(session.id, studentId)).silentSince).not.toBeNull();

    // Already open — a second sweep opens nothing and emits nothing.
    expect(await markSilentParticipations(db, new Date())).toBe(0);
    expect(await eventsOf(session.id, 'went_silent')).toHaveLength(1);
  });

  it('leaves a phone still in contact alone', async () => {
    const { session } = await seed('sil-fresh'); // lastSeenAt null, joinedAt just now
    expect(await markSilentParticipations(db, new Date())).toBe(0);
    expect(await eventsOf(session.id, 'went_silent')).toHaveLength(0);
  });

  it('never marks an unlocked phone silent — only focused goes silent', async () => {
    const { session, studentId } = await seed('sil-unlocked');
    await unlock(db, {
      sessionId: session.id,
      studentId,
      eventId: randomUUID(),
      deviceTime: new Date(),
    });
    await backdateContact(session.id, studentId, SILENT_AGO);
    expect(await markSilentParticipations(db, new Date())).toBe(0);
    expect(await eventsOf(session.id, 'went_silent')).toHaveLength(0);
  });

  it('never marks an ended participation silent', async () => {
    const { session, studentId } = await seed('sil-ended');
    await backdateContact(session.id, studentId, SILENT_AGO);
    await endSession(db, { sessionId: session.id, at: new Date(), reason: 'ended' });
    expect(await markSilentParticipations(db, new Date())).toBe(0);
    expect(await eventsOf(session.id, 'went_silent')).toHaveLength(0);
  });
});

describe('checkIn and silence episodes', () => {
  it('a normal heartbeat writes no history (decision 7)', async () => {
    const { session, studentId } = await seed('sil-heartbeat');
    const res = await checkIn(db, { sessionId: session.id, studentId, deviceTime: new Date() });
    expect(res.status).toBe('live');
    expect(await eventsOf(session.id, 'went_silent')).toHaveLength(0);
    expect(await eventsOf(session.id, 'came_back')).toHaveLength(0);
  });

  it('a check-in that ends a silence episode emits exactly one came_back', async () => {
    const { session, studentId } = await seed('sil-return');
    await backdateContact(session.id, studentId, SILENT_AGO);
    await markSilentParticipations(db, new Date());
    expect((await participationOf(session.id, studentId)).silentSince).not.toBeNull();

    const res = await checkIn(db, { sessionId: session.id, studentId, deviceTime: new Date() });
    expect(res.status).toBe('live');
    expect((await participationOf(session.id, studentId)).silentSince).toBeNull();
    expect(await eventsOf(session.id, 'came_back')).toHaveLength(1);

    // The episode is closed — a further heartbeat adds no second came_back.
    await checkIn(db, { sessionId: session.id, studentId, deviceTime: new Date() });
    expect(await eventsOf(session.id, 'came_back')).toHaveLength(1);
  });
});
