import {
  type Database,
  endEnrollment,
  endSession,
  enrollments,
  protectionOff,
  refocus,
  renameStudent,
  startSession,
  tapIn,
  unlock,
  users,
} from '@bali/db';
import type { EventsPage, SessionSnapshot, SnapshotStudent } from '@bali/shared';
import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { authedInject, makeAuthedApp, type AuthedApp } from './helpers/app.js';
import { makeTestDb, seedClassroom } from './helpers/db.js';

let db: Database;
let closeDb: () => Promise<void>;
let ctx: AuthedApp;

beforeEach(async () => {
  ({ db, close: closeDb } = await makeTestDb());
  ctx = await makeAuthedApp(db);
});

afterEach(async () => {
  await ctx.close();
  await closeDb();
});

function one<T>(rows: T[]): T {
  const row = rows[0];
  if (row === undefined) throw new Error('expected a row');
  return row;
}

async function seedRunning(tag: string) {
  const c = await seedClassroom(db, tag);
  const session = (
    await startSession(db, {
      classId: c.klass.id,
      startedAt: new Date(Date.now() - 60_000),
      endsAt: new Date(Date.now() + 25 * 60_000),
    })
  ).session;
  return { ...c, session };
}

function get(token: string, url: string) {
  return authedInject(ctx.app, token, { method: 'GET', url });
}

describe('GET /v1/sessions/:id (snapshot)', () => {
  it('the owning teacher gets the session, roster, and latest seq', async () => {
    const { teacher, student, session } = await seedRunning('snap');
    await tapIn(db, {
      sessionId: session.id,
      studentId: student.id,
      eventId: randomUUID(),
      deviceTime: new Date(),
    });
    const res = await get(await ctx.tokenFor(teacher.cognitoId), `/v1/sessions/${session.id}`);
    expect(res.statusCode).toBe(200);
    const body = res.json<SessionSnapshot>();
    expect(body.session.id).toBe(session.id);
    expect(body.ended).toBe(false);
    expect(body.latestSeq).toBeGreaterThan(0);
    expect(body.students).toHaveLength(1);
    expect(body.students[0]!.state).toBe('focused');
    expect(body.students[0]!.joinedAt).not.toBeNull();
  });

  it('an enrolled student who has not tapped in shows null participation', async () => {
    const { teacher, school, klass, session } = await seedRunning('snap-null');
    const other = one(
      await db
        .insert(users)
        .values({ cognitoId: 'snap-null-2', role: 'student', schoolId: school.id })
        .returning(),
    );
    await db.insert(enrollments).values({ classId: klass.id, studentId: other.id });

    const body = (
      await get(await ctx.tokenFor(teacher.cognitoId), `/v1/sessions/${session.id}`)
    ).json<SessionSnapshot>();
    const entry = body.students.find((s) => s.studentId === other.id);
    expect(entry?.state).toBeNull();
    expect(entry?.joinedAt).toBeNull();
    expect(entry?.lastSeenAt).toBeNull();
  });

  it("does not leak a student's participation from another (ended) session", async () => {
    const { teacher, student, klass } = await seedClassroom(db, 'snap-scope');
    const token = await ctx.tokenFor(teacher.cognitoId);
    // Session 1: the student taps in, then it ends.
    const s1 = (
      await startSession(db, {
        classId: klass.id,
        startedAt: new Date(Date.now() - 120_000),
        endsAt: new Date(Date.now() + 25 * 60_000),
      })
    ).session;
    await tapIn(db, {
      sessionId: s1.id,
      studentId: student.id,
      eventId: randomUUID(),
      deviceTime: new Date(),
    });
    await endSession(db, { sessionId: s1.id, at: new Date(), reason: 'ended' });
    // Session 2 on the same class; the student has NOT tapped into it.
    const s2 = (
      await startSession(db, {
        classId: klass.id,
        startedAt: new Date(Date.now() - 60_000),
        endsAt: new Date(Date.now() + 25 * 60_000),
      })
    ).session;

    const body = (await get(token, `/v1/sessions/${s2.id}`)).json<SessionSnapshot>();
    const rows = body.students.filter((x) => x.studentId === student.id);
    // Exactly one roster row — a wrong (unscoped) join would duplicate it — and
    // session 1's participation must not leak into session 2's snapshot.
    expect(rows).toHaveLength(1);
    expect(rows[0]!.state).toBeNull();
    expect(rows[0]!.joinedAt).toBeNull();
  });

  it('another teacher cannot read it (403)', async () => {
    const { session } = await seedRunning('snap-owner');
    const other = await seedClassroom(db, 'snap-other');
    const res = await get(
      await ctx.tokenFor(other.teacher.cognitoId),
      `/v1/sessions/${session.id}`,
    );
    expect(res.statusCode).toBe(403);
  });

  it('a student cannot read it (403)', async () => {
    const { student, session } = await seedRunning('snap-student');
    const res = await get(await ctx.tokenFor(student.cognitoId), `/v1/sessions/${session.id}`);
    expect(res.statusCode).toBe(403);
  });

  it('is a 404 for an unknown session', async () => {
    const { teacher } = await seedClassroom(db, 'snap-404');
    const res = await get(await ctx.tokenFor(teacher.cognitoId), `/v1/sessions/${randomUUID()}`);
    expect(res.statusCode).toBe(404);
  });

  it('requires authentication', async () => {
    const { session } = await seedRunning('snap-auth');
    const res = await ctx.app.inject({ method: 'GET', url: `/v1/sessions/${session.id}` });
    expect(res.statusCode).toBe(401);
  });
});

describe('GET /v1/sessions/:id — what the row does not show (A9)', () => {
  const change = (sessionId: string, studentId: string) => ({
    sessionId,
    studentId,
    eventId: randomUUID(),
    deviceTime: new Date(),
  });

  /** Another student of `klass`, enrolled now. */
  async function classmate(tag: string, schoolId: string, classId: string) {
    const row = one(
      await db
        .insert(users)
        .values({ cognitoId: `student-${tag}`, role: 'student', schoolId })
        .returning(),
    );
    const enrollment = one(
      await db.insert(enrollments).values({ classId, studentId: row.id }).returning(),
    );
    return { ...row, enrollmentId: enrollment.id };
  }

  async function snapshotOf(teacherCognitoId: string, sessionId: string) {
    const res = await get(await ctx.tokenFor(teacherCognitoId), `/v1/sessions/${sessionId}`);
    expect(res.statusCode).toBe(200);
    return res.json<SessionSnapshot>();
  }
  function row(snap: SessionSnapshot, studentId: string): SnapshotStudent | undefined {
    return snap.students.find((s) => s.studentId === studentId);
  }

  it("carries an unlock's reason until the student is back in focus", async () => {
    const { teacher, student, session } = await seedRunning('a9-reason');
    await tapIn(db, change(session.id, student.id));
    await unlock(db, { ...change(session.id, student.id), reason: 'bathroom' });

    const unlocked = row(await snapshotOf(teacher.cognitoId, session.id), student.id);
    expect(unlocked).toMatchObject({
      state: 'unlocked',
      unlock: { reason: 'bathroom', recordedAs: null },
      protectionOffAfterEnd: false,
    });
    expect(Date.parse(unlocked!.unlock!.occurredAt)).not.toBeNaN();

    await refocus(db, change(session.id, student.id));
    expect(row(await snapshotOf(teacher.cognitoId, session.id), student.id)).toMatchObject({
      state: 'focused',
      unlock: null,
    });
  });

  it('carries an unlock recorded against protection off, and the state stays protection off', async () => {
    const { teacher, student, session } = await seedRunning('a9-off');
    await tapIn(db, change(session.id, student.id));
    await protectionOff(db, change(session.id, student.id));
    const res = await unlock(db, { ...change(session.id, student.id), reason: 'nurse' });
    expect(res.recordedAs).toBe('protection_off');

    expect(row(await snapshotOf(teacher.cognitoId, session.id), student.id)).toMatchObject({
      state: 'protection_off',
      unlock: { reason: 'nurse', recordedAs: 'protection_off' },
    });

    // A re-tap returns to focus: the unlock is history.
    await tapIn(db, change(session.id, student.id));
    expect(row(await snapshotOf(teacher.cognitoId, session.id), student.id)).toMatchObject({
      state: 'focused',
      unlock: null,
    });
  });

  it('carries the late records a session end leaves the row without', async () => {
    const { teacher, student, school, klass, session } = await seedRunning('a9-late');
    const ben = await classmate('a9-late-ben', school.id, klass.id);
    await tapIn(db, change(session.id, student.id));
    await tapIn(db, change(session.id, ben.id));
    await endSession(db, { sessionId: session.id, at: new Date(), reason: 'ended' });

    const before = await snapshotOf(teacher.cognitoId, session.id);
    expect(row(before, student.id)).toMatchObject({ unlock: null, protectionOffAfterEnd: false });

    // After the end: recorded with a note, and the ended row left as it was.
    await unlock(db, { ...change(session.id, student.id), reason: 'other' });
    const off = await protectionOff(db, change(session.id, ben.id));
    expect(off.outcome).toBe('recorded');

    const after = await snapshotOf(teacher.cognitoId, session.id);
    expect(row(after, student.id)).toMatchObject({
      state: 'focused',
      endedAt: row(before, student.id)!.endedAt,
      unlock: { reason: 'other', recordedAs: 'after_session_end' },
      protectionOffAfterEnd: false,
    });
    expect(row(after, ben.id)).toMatchObject({
      state: 'focused',
      endedAt: row(before, ben.id)!.endedAt,
      unlock: null,
      protectionOffAfterEnd: true,
    });
    expect(row(before, ben.id)!.endedAt).not.toBeNull();
  });

  it('carries a student removed mid-session, with their unlock, and a rename of theirs', async () => {
    // Removed: the active roster no longer has them, but the session's record
    // does — so every tab shows the same chip, and its name keeps refreshing.
    const { teacher, student, school, klass, session } = await seedRunning('a9-removed');
    const cal = await classmate('a9-removed-cal', school.id, klass.id);
    const dan = await classmate('a9-removed-dan', school.id, klass.id);
    await tapIn(db, change(session.id, cal.id));
    await endEnrollment(db, {
      enrollmentId: cal.enrollmentId,
      reason: 'removed_from_class',
      at: new Date(),
    });
    await unlock(db, change(session.id, cal.id));
    // Dan never tapped in and left: nothing on record here, so not carried.
    await endEnrollment(db, {
      enrollmentId: dan.enrollmentId,
      reason: 'left_class',
      at: new Date(),
    });
    await renameStudent(db, { studentId: cal.id, displayName: 'Cal R.', eventId: randomUUID() });

    const snap = await snapshotOf(teacher.cognitoId, session.id);
    // In enrollment order, Cal's removed enrollment keeping his place.
    expect(snap.students.map((s) => s.studentId)).toEqual([student.id, cal.id]);
    expect(row(snap, cal.id)).toMatchObject({
      enrollmentId: cal.enrollmentId,
      displayName: 'Cal R.',
      state: 'focused',
      unlock: { reason: null, recordedAs: 'no_live_participation' },
    });
    expect(row(snap, cal.id)!.endedAt).not.toBeNull();
  });

  it('carries a re-enrolled student once, on their live enrollment and in its place', async () => {
    const { teacher, student, school, klass, session } = await seedRunning('a9-rejoin');
    const eve = await classmate('a9-rejoin-eve', school.id, klass.id);
    const fay = await classmate('a9-rejoin-fay', school.id, klass.id);
    await tapIn(db, change(session.id, eve.id));
    await endEnrollment(db, {
      enrollmentId: eve.enrollmentId,
      reason: 'removed_from_class',
      at: new Date(),
    });
    const again = one(
      await db.insert(enrollments).values({ classId: klass.id, studentId: eve.id }).returning(),
    );

    const snap = await snapshotOf(teacher.cognitoId, session.id);
    expect(snap.students.map((s) => s.studentId)).toEqual([student.id, fay.id, eve.id]);
    expect(row(snap, eve.id)!.enrollmentId).toBe(again.id);
  });

  it("keeps another session's records out", async () => {
    const { teacher, student, klass } = await seedClassroom(db, 'a9-scope');
    const first = (
      await startSession(db, {
        classId: klass.id,
        startedAt: new Date(Date.now() - 120_000),
        endsAt: new Date(Date.now() + 25 * 60_000),
      })
    ).session;
    await tapIn(db, change(first.id, student.id));
    await unlock(db, { ...change(first.id, student.id), reason: 'nurse' });
    await endSession(db, { sessionId: first.id, at: new Date(), reason: 'ended' });
    await protectionOff(db, change(first.id, student.id));
    const second = (
      await startSession(db, {
        classId: klass.id,
        startedAt: new Date(Date.now() - 60_000),
        endsAt: new Date(Date.now() + 25 * 60_000),
      })
    ).session;

    expect(row(await snapshotOf(teacher.cognitoId, second.id), student.id)).toMatchObject({
      state: null,
      unlock: null,
      protectionOffAfterEnd: false,
    });
  });
});

describe('GET /v1/sessions/:id/events', () => {
  it('returns the session events in seq order, and after= filters', async () => {
    const { teacher, student, session } = await seedRunning('events');
    await tapIn(db, {
      sessionId: session.id,
      studentId: student.id,
      eventId: randomUUID(),
      deviceTime: new Date(),
    });
    const token = await ctx.tokenFor(teacher.cognitoId);

    const all = (await get(token, `/v1/sessions/${session.id}/events`)).json<EventsPage>();
    const types = all.events.map((e) => e.type);
    expect(types).toContain('session_started');
    expect(types).toContain('tap_in');
    const seqs = all.events.map((e) => e.seq);
    expect(seqs).toEqual([...seqs].sort((a, b) => a - b));
    expect(all.nextAfter).toBe(seqs[seqs.length - 1]);

    const after = (
      await get(token, `/v1/sessions/${session.id}/events?after=${all.events[0]!.seq}`)
    ).json<EventsPage>();
    expect(after.events.every((e) => e.seq > all.events[0]!.seq)).toBe(true);
  });

  it("does not leak another session's events into this feed", async () => {
    const a = await seedRunning('events-scope-a');
    await tapIn(db, {
      sessionId: a.session.id,
      studentId: a.student.id,
      eventId: randomUUID(),
      deviceTime: new Date(),
    });
    const b = await seedRunning('events-scope-b');
    const bTapId = randomUUID();
    await tapIn(db, {
      sessionId: b.session.id,
      studentId: b.student.id,
      eventId: bTapId,
      deviceTime: new Date(),
    });

    const page = (
      await get(await ctx.tokenFor(a.teacher.cognitoId), `/v1/sessions/${a.session.id}/events`)
    ).json<EventsPage>();
    const ids = page.events.map((e) => e.eventId);
    expect(ids).not.toContain(bTapId); // b's event must never appear in a's feed
    expect(page.events.some((e) => e.type === 'tap_in')).toBe(true); // a's own tap is there
  });

  it('another teacher cannot read the events (403)', async () => {
    const { session } = await seedRunning('events-owner');
    const other = await seedClassroom(db, 'events-other');
    const res = await get(
      await ctx.tokenFor(other.teacher.cognitoId),
      `/v1/sessions/${session.id}/events`,
    );
    expect(res.statusCode).toBe(403);
  });

  it('is a 404 for an unknown session', async () => {
    const { teacher } = await seedClassroom(db, 'events-404');
    const res = await get(
      await ctx.tokenFor(teacher.cognitoId),
      `/v1/sessions/${randomUUID()}/events`,
    );
    expect(res.statusCode).toBe(404);
  });

  it('rejects a non-numeric after (400)', async () => {
    const { teacher, session } = await seedRunning('events-badafter');
    const res = await get(
      await ctx.tokenFor(teacher.cognitoId),
      `/v1/sessions/${session.id}/events?after=nope`,
    );
    expect(res.statusCode).toBe(400);
  });
});
