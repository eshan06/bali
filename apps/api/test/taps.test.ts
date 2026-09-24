import {
  classes,
  type Database,
  endSession,
  enrollments,
  participations,
  startSession,
  users,
} from '@bali/db';
import type { TapResponse } from '@bali/shared';
import { and, eq, isNull } from 'drizzle-orm';
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

async function tap(
  token: string,
  payload: { tagId: string; eventId?: string; deviceTime?: string },
): Promise<{ status: number; body: TapResponse }> {
  const res = await authedInject(ctx.app, token, {
    method: 'POST',
    url: '/v1/taps',
    payload: {
      tagId: payload.tagId,
      eventId: payload.eventId ?? randomUUID(),
      deviceTime: payload.deviceTime ?? new Date().toISOString(),
    },
  });
  return { status: res.statusCode, body: res.json<TapResponse>() };
}

function one<T>(rows: T[]): T {
  const row = rows[0];
  if (row === undefined) throw new Error('expected a row');
  return row;
}

describe('POST /v1/taps', () => {
  it('joins the running session and returns the end time', async () => {
    const { student, klass, block } = await seedClassroom(db, 'tap-join');
    const { session } = await startSession(db, {
      classId: klass.id,
      startedAt: new Date(),
      endsAt: new Date(Date.now() + 25 * 60_000),
    });

    const { status, body } = await tap(await ctx.tokenFor(student.cognitoId), {
      tagId: block.tagId,
    });
    expect(status).toBe(200);
    expect(body.outcome).toBe('joined');
    expect(body.state).toBe('focused');
    expect(body.session?.id).toBe(session.id);
  });

  it('arms the tap when no session is running yet', async () => {
    const { student, block } = await seedClassroom(db, 'tap-arm');
    const { status, body } = await tap(await ctx.tokenFor(student.cognitoId), {
      tagId: block.tagId,
    });
    expect(status).toBe(200);
    expect(body.outcome).toBe('armed');
    expect(body.session).toBeNull();
  });

  it('a non-enrolled student cannot join — the tap arms, never joins someone else class', async () => {
    // Teacher A runs a session; an outsider student (enrolled elsewhere) taps A's block.
    const a = await seedClassroom(db, 'tap-idor-a');
    const outsider = await seedClassroom(db, 'tap-idor-b');
    await startSession(db, {
      classId: a.klass.id,
      startedAt: new Date(),
      endsAt: new Date(Date.now() + 25 * 60_000),
    });

    const { status, body } = await tap(await ctx.tokenFor(outsider.student.cognitoId), {
      tagId: a.block.tagId,
    });
    expect(status).toBe(200);
    expect(body.outcome).toBe('armed'); // NOT 'joined' — outsider isn't enrolled in A's class
    expect(body.session).toBeNull();
  });

  it('is idempotent on eventId (a retried join counts once)', async () => {
    const { student, klass, block } = await seedClassroom(db, 'tap-retry');
    await startSession(db, {
      classId: klass.id,
      startedAt: new Date(),
      endsAt: new Date(Date.now() + 25 * 60_000),
    });
    const token = await ctx.tokenFor(student.cognitoId);
    const eventId = randomUUID();
    const first = await tap(token, { tagId: block.tagId, eventId });
    const retry = await tap(token, { tagId: block.tagId, eventId });
    expect(first.body.outcome).toBe('joined');
    expect(retry.body.outcome).toBe('replay');
  });

  it('a retry the server re-resolves elsewhere replays the session it recorded', async () => {
    /*
     * The wire shape of the engine's cross-session replay, which the engine
     * tests pin only as a result object. One physical tap, one event id, and
     * the SERVER picks the session: the retry resolves at the teacher's newer
     * session, and the answer must still be 200 naming the session that
     * actually recorded the tap — not the 409 that used to send the phone
     * round the retry loop forever.
     */
    const { student, teacher, school, klass, block } = await seedClassroom(db, 'tap-reresolve');
    const second = one(
      await db
        .insert(classes)
        .values({
          teacherId: teacher.id,
          schoolId: school.id,
          name: 'Second period',
          joinCode: 'JOIN-tap-reresolve-2',
        })
        .returning(),
    );
    await db.insert(enrollments).values({ classId: second.id, studentId: student.id });

    const token = await ctx.tokenFor(student.cognitoId);
    const first = await startSession(db, {
      classId: klass.id,
      startedAt: new Date(Date.now() - 60_000),
      endsAt: new Date(Date.now() + 25 * 60_000),
    });
    const eventId = randomUUID();
    const landed = await tap(token, { tagId: block.tagId, eventId });
    expect(landed.body.outcome).toBe('joined');

    // The same teacher starts a second session the student is also in, so
    // resolveTapTarget (newest running session of the block's teacher) now
    // points the retry somewhere new.
    const later = await startSession(db, {
      classId: second.id,
      startedAt: new Date(),
      endsAt: new Date(Date.now() + 25 * 60_000),
    });
    const retry = await tap(token, { tagId: block.tagId, eventId });

    expect(retry.status).toBe(200);
    expect(retry.body.outcome).toBe('replay');
    expect(retry.body.session?.id).toBe(first.session.id);
    expect(retry.body.session?.id).not.toBe(later.session.id);
    expect(retry.body.state).toBe('focused');
  });

  it('a retry that resolves back to a session the student has left is 200 replay naming no session', async () => {
    /*
     * The wire half of A4, which corrects a shipped answer (API decision 2).
     * Before #28 this was a 200 naming period 1 — a session the student had
     * left; #28 made it a `409 not in this session`, which the tap outbox
     * keeps and retries forever though the tap is on record. Now it is the
     * true answer: recorded, and no window to shield to, so the phone deletes
     * the record and re-reads the truth.
     *
     * The student taps into period 1, the 200 is lost, they physically tap
     * period 2 (so decision 4 ends the period-1 row as
     * `left_for_other_session`), period 2 ends, and the stale outbox record
     * retries — re-resolving to period 1, which is still running.
     */
    const { student, teacher, school, klass, block } = await seedClassroom(db, 'tap-left');
    const second = one(
      await db
        .insert(classes)
        .values({
          teacherId: teacher.id,
          schoolId: school.id,
          name: 'Second period',
          joinCode: 'JOIN-tap-left-2',
        })
        .returning(),
    );
    await db.insert(enrollments).values({ classId: second.id, studentId: student.id });
    const token = await ctx.tokenFor(student.cognitoId);

    await startSession(db, {
      classId: klass.id,
      startedAt: new Date(Date.now() - 60_000),
      endsAt: new Date(Date.now() + 25 * 60_000),
    });
    const eventId = randomUUID();
    expect((await tap(token, { tagId: block.tagId, eventId })).body.outcome).toBe('joined');

    // A real second tap moves them out of period 1, then period 2 ends.
    const later = await startSession(db, {
      classId: second.id,
      startedAt: new Date(),
      endsAt: new Date(Date.now() + 25 * 60_000),
    });
    expect((await tap(token, { tagId: block.tagId })).body.outcome).toBe('switched');
    await endSession(db, { sessionId: later.session.id, at: new Date(), reason: 'ended' });

    // The stale retry, re-resolved back to period 1.
    const retry = await tap(token, { tagId: block.tagId, eventId });
    expect(retry.status).toBe(200);
    expect(retry.body).toEqual({ outcome: 'replay', session: null, state: null });
    // A replay, not a re-join under the spent id: nothing is live anywhere —
    // period 2 is over, and the period-1 row stays ended.
    const live = await db
      .select()
      .from(participations)
      .where(and(eq(participations.studentId, student.id), isNull(participations.endedAt)));
    expect(live).toHaveLength(0);
  });

  it('the retry of a tap still armed answers already_armed, so the phone keeps waiting', async () => {
    // A4: `replay` with no session told the phone only "recorded", and the
    // truth it then re-reads cannot say it waits for Start.
    const { student, block } = await seedClassroom(db, 'tap-armed-retry');
    const token = await ctx.tokenFor(student.cognitoId);
    const eventId = randomUUID();
    const first = await tap(token, { tagId: block.tagId, eventId });
    expect(first.body).toEqual({ outcome: 'armed', session: null, state: null });

    const retry = await tap(token, { tagId: block.tagId, eventId });
    expect(retry.status).toBe(200);
    expect(retry.body).toEqual({ outcome: 'already_armed', session: null, state: null });
  });

  it('an id held by a different event is still a 409 on the join path', async () => {
    // The genuine conflict A4 leaves alone: a classmate's tap id, or this
    // student's own unlock id, sent as a tap into a running session. A 200
    // would tell the phone to delete a tap the server never kept.
    const { student, school, klass, block } = await seedClassroom(db, 'tap-join-conflict');
    const [classmate] = await db
      .insert(users)
      .values({ cognitoId: 'student-tap-join-conflict-2', role: 'student', schoolId: school.id })
      .returning();
    if (!classmate) throw new Error('expected a classmate');
    await db.insert(enrollments).values({ classId: klass.id, studentId: classmate.id });
    const { session } = await startSession(db, {
      classId: klass.id,
      startedAt: new Date(Date.now() - 60_000),
      endsAt: new Date(Date.now() + 25 * 60_000),
    });
    const token = await ctx.tokenFor(student.cognitoId);
    const theirs = randomUUID();
    const joined = await tap(await ctx.tokenFor(classmate.cognitoId), {
      tagId: block.tagId,
      eventId: theirs,
    });
    expect(joined.body.outcome).toBe('joined');
    expect((await tap(token, { tagId: block.tagId })).body.outcome).toBe('joined');
    const unlockId = randomUUID();
    const unlocked = await authedInject(ctx.app, token, {
      method: 'POST',
      url: `/v1/sessions/${session.id}/unlock`,
      payload: { eventId: unlockId, deviceTime: new Date().toISOString() },
    });
    expect(unlocked.statusCode).toBe(200);

    for (const eventId of [theirs, unlockId]) {
      const res = await tap(token, { tagId: block.tagId, eventId });
      expect(res.status).toBe(409);
      expect(res.body).toMatchObject({
        error: { code: 'conflict', message: 'event_id already used by another event' },
      });
    }
  });

  it("is a 409 when the event_id belongs to another student's armed tap", async () => {
    // The status a phone actually sees, which no engine test can assert. The
    // engine refuses a stranger's id with EVENT_ID_CONFLICT, and that has to
    // reach the client as a 409 — a 500 reads to any outbox as a transient
    // server fault, so the phone would retry the same poisoned id forever as
    // if the server were down. The 409 says what is actually wrong, which is
    // what the tap-side disposition (Phase 3) needs in order to surface it.
    // The route gets this right for `tapIn` and got it wrong for `armTap`,
    // which is the half with no joinable session running.
    const a = await seedClassroom(db, 'tap-conflict-a');
    const b = await seedClassroom(db, 'tap-conflict-b');
    const eventId = randomUUID();

    // Nothing running, so both of these arm rather than join.
    const mine = await tap(await ctx.tokenFor(a.student.cognitoId), {
      tagId: a.block.tagId,
      eventId,
    });
    expect(mine.status).toBe(200);
    expect(mine.body.outcome).toBe('armed');

    const stranger = await tap(await ctx.tokenFor(b.student.cognitoId), {
      tagId: a.block.tagId,
      eventId,
    });
    expect(stranger.status).toBe(409);
    expect(stranger.body).toMatchObject({ error: { code: 'conflict' } });
  });

  it("is a 409 when the event_id was spent at another teacher's block", async () => {
    // Item 5 of the owner's 2026-09-22 ruling, at the status the phone sees.
    // An id already recorded as this student's tap_in under teacher A, sent
    // again at teacher B's block with nothing of B's running, was answered
    // `200 replay`: B armed nothing, and the outbox deleted a tap that was
    // never recorded for B. A /v1 200 -> 409, allowed by API decision 2's
    // note on correcting a wrong answer in place.
    const a = await seedClassroom(db, 'tap-xteacher-a');
    const b = await seedClassroom(db, 'tap-xteacher-b');
    await startSession(db, {
      classId: a.klass.id,
      startedAt: new Date(),
      endsAt: new Date(Date.now() + 25 * 60_000),
    });
    const token = await ctx.tokenFor(a.student.cognitoId);
    const eventId = randomUUID();

    const landed = await tap(token, { tagId: a.block.tagId, eventId });
    expect(landed.status).toBe(200);
    expect(landed.body.outcome).toBe('joined');

    const elsewhere = await tap(token, { tagId: b.block.tagId, eventId });
    expect(elsewhere.status).toBe(409);
    expect(elsewhere.body).toMatchObject({ error: { code: 'conflict' } });
  });

  it('is a 404 for an unknown tag', async () => {
    const { student } = await seedClassroom(db, 'tap-unknown');
    const res = await authedInject(ctx.app, await ctx.tokenFor(student.cognitoId), {
      method: 'POST',
      url: '/v1/taps',
      payload: {
        tagId: 'NOT-A-REAL-TAG',
        eventId: randomUUID(),
        deviceTime: new Date().toISOString(),
      },
    });
    expect(res.statusCode).toBe(404);
  });

  it('is a 400 for a malformed body', async () => {
    const { student } = await seedClassroom(db, 'tap-bad');
    const res = await authedInject(ctx.app, await ctx.tokenFor(student.cognitoId), {
      method: 'POST',
      url: '/v1/taps',
      payload: { tagId: '', eventId: 'not-a-uuid', deviceTime: 'nonsense' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('requires authentication', async () => {
    const res = await ctx.app.inject({ method: 'POST', url: '/v1/taps', payload: {} });
    expect(res.statusCode).toBe(401);
  });
});
