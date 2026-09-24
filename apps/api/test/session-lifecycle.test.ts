import {
  type Database,
  endEnrollment,
  enrollments,
  events,
  participations,
  startSession,
  tapIn,
  users,
} from '@bali/db';
import { and, eq, isNull } from 'drizzle-orm';
import type {
  CheckInResponse,
  EndSessionResponse,
  ExtendSessionResponse,
  ProtectionOffResponse,
  RefocusResponse,
  TapResponse,
  UnlockResponse,
} from '@bali/shared';
import { tapDisposition, unlockDisposition } from '@bali/shared';
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

async function tap(sessionId: string, studentId: string, eventId: string = randomUUID()) {
  await tapIn(db, { sessionId, studentId, eventId, deviceTime: new Date() });
}

function post(token: string, url: string, body: object = {}) {
  return authedInject(ctx.app, token, { method: 'POST', url, payload: body });
}
const now = () => new Date().toISOString();

describe('POST /v1/sessions/:id/end', () => {
  it('the owning teacher ends a running session, then it is idempotent', async () => {
    const { teacher, student, session } = await seedRunning('end-ok');
    await tap(session.id, student.id);
    const token = await ctx.tokenFor(teacher.cognitoId);

    const first = await post(token, `/v1/sessions/${session.id}/end`);
    expect(first.statusCode).toBe(200);
    const body = first.json<EndSessionResponse>();
    expect(body.outcome).toBe('ended');
    expect(body.endedParticipations).toBe(1);

    const again = await post(token, `/v1/sessions/${session.id}/end`);
    expect(again.json<EndSessionResponse>().outcome).toBe('already_ended');
    expect(again.json<EndSessionResponse>().endedParticipations).toBe(0);
  });

  it("a non-owner teacher cannot end someone else's session (403)", async () => {
    const { session } = await seedRunning('end-owner');
    const other = await seedClassroom(db, 'end-other');
    const res = await post(
      await ctx.tokenFor(other.teacher.cognitoId),
      `/v1/sessions/${session.id}/end`,
    );
    expect(res.statusCode).toBe(403);
  });

  it('a student cannot end a session (403)', async () => {
    const { student, session } = await seedRunning('end-student');
    const res = await post(await ctx.tokenFor(student.cognitoId), `/v1/sessions/${session.id}/end`);
    expect(res.statusCode).toBe(403);
  });

  it('is a 404 for an unknown session', async () => {
    const { teacher } = await seedClassroom(db, 'end-404');
    const res = await post(
      await ctx.tokenFor(teacher.cognitoId),
      `/v1/sessions/${randomUUID()}/end`,
    );
    expect(res.statusCode).toBe(404);
    // The owner check finds the engine's condition itself, so it answers with
    // the engine's refusal: one condition, one shape (A5).
    expect(res.json()).toEqual({
      error: { code: 'not_found', reason: 'session_not_found', message: 'session not found' },
    });
  });

  it('requires authentication', async () => {
    const { session } = await seedRunning('end-auth');
    const res = await ctx.app.inject({ method: 'POST', url: `/v1/sessions/${session.id}/end` });
    expect(res.statusCode).toBe(401);
  });
});

describe('POST /v1/sessions/:id/extend', () => {
  it('the owning teacher moves the end time later', async () => {
    const { teacher, session } = await seedRunning('extend-ok');
    const res = await post(
      await ctx.tokenFor(teacher.cognitoId),
      `/v1/sessions/${session.id}/extend`,
      {
        durationMinutes: 10,
        eventId: randomUUID(),
      },
    );
    expect(res.statusCode).toBe(200);
    const body = res.json<ExtendSessionResponse>();
    expect(body.outcome).toBe('extended');
    expect(new Date(body.session.endsAt).getTime()).toBeGreaterThan(session.endsAt.getTime());
  });

  it('reusing an event id already spent on another event is a 409, not a phantom extend', async () => {
    const { teacher, student, session } = await seedRunning('extend-id-reuse');
    const eventId = randomUUID();
    await tap(session.id, student.id, eventId);
    const res = await post(
      await ctx.tokenFor(teacher.cognitoId),
      `/v1/sessions/${session.id}/extend`,
      { durationMinutes: 10, eventId },
    );
    expect(res.statusCode).toBe(409);
    expect(res.json<{ error: { code: string } }>().error.code).toBe('conflict');
  });

  it('a retried extend with the same event id adds the time once (rule 4)', async () => {
    // The new end is relative to the current one, so a retry after a lost
    // response would shield the class a second increment past the bell and
    // write a second session_extended into permanent history.
    const { teacher, session } = await seedRunning('extend-replay');
    const token = await ctx.tokenFor(teacher.cognitoId);
    const eventId = randomUUID();

    const first = await post(token, `/v1/sessions/${session.id}/extend`, {
      durationMinutes: 10,
      eventId,
    });
    expect(first.statusCode).toBe(200);
    const firstEnd = first.json<ExtendSessionResponse>().session.endsAt;

    const replayed = await post(token, `/v1/sessions/${session.id}/extend`, {
      durationMinutes: 10,
      eventId,
    });
    expect(replayed.statusCode).toBe(200);
    expect(replayed.json<ExtendSessionResponse>().session.endsAt).toBe(firstEnd);

    const extended = await db
      .select()
      .from(events)
      .where(and(eq(events.sessionId, session.id), eq(events.type, 'session_extended')));
    expect(extended).toHaveLength(1);
  });

  it('rejects an extend with no event id (400) — rule 4 is not optional', async () => {
    const { teacher, session } = await seedRunning('extend-no-id');
    const res = await post(
      await ctx.tokenFor(teacher.cognitoId),
      `/v1/sessions/${session.id}/extend`,
      { durationMinutes: 10 },
    );
    expect(res.statusCode).toBe(400);
  });

  it('rejects a duration outside the zod bound, and no longer says "end time"', async () => {
    /*
     * A JOINT drift detector, and worth being precise about what it can and
     * cannot see. `INVALID_EXTENSION` is unreachable through /v1 — the route's
     * `int().positive().max(480)` accepts only durations the engine never
     * refuses — so no wire test can assert the engine's message. What this
     * pins is the pair: zod still rejects the shape, AND the message the
     * mapper would produce no longer talks about an end time the route does
     * not send. Measured: reverting the mapper's message alone leaves this
     * green, relaxing `.positive()` alone leaves it green, doing both turns it
     * red.
     */
    const { teacher, session } = await seedRunning('extend-bad-duration');
    const res = await post(
      await ctx.tokenFor(teacher.cognitoId),
      `/v1/sessions/${session.id}/extend`,
      { durationMinutes: 0, eventId: randomUUID() },
    );
    expect(res.statusCode).toBe(400);
    const body = res.json<{ error: { code: string; message: string } }>();
    expect(body.error.code).toBe('bad_input');
    expect(body.error.message).not.toContain('end time');
  });

  it('a non-owner teacher cannot extend (403)', async () => {
    const { session } = await seedRunning('extend-owner');
    const other = await seedClassroom(db, 'extend-other');
    const res = await post(
      await ctx.tokenFor(other.teacher.cognitoId),
      `/v1/sessions/${session.id}/extend`,
      {
        durationMinutes: 10,
        eventId: randomUUID(),
      },
    );
    expect(res.statusCode).toBe(403);
  });

  it('cannot extend an ended session (409)', async () => {
    const { teacher, session } = await seedRunning('extend-ended');
    const token = await ctx.tokenFor(teacher.cognitoId);
    await post(token, `/v1/sessions/${session.id}/end`);
    const res = await post(token, `/v1/sessions/${session.id}/extend`, {
      durationMinutes: 10,
      eventId: randomUUID(),
    });
    expect(res.statusCode).toBe(409);
  });

  it('rejects a bad duration (400)', async () => {
    const { teacher, session } = await seedRunning('extend-baddur');
    const res = await post(
      await ctx.tokenFor(teacher.cognitoId),
      `/v1/sessions/${session.id}/extend`,
      {
        durationMinutes: 0,
      },
    );
    expect(res.statusCode).toBe(400);
  });

  it('a student cannot extend (403)', async () => {
    const { student, session } = await seedRunning('extend-student');
    const res = await post(
      await ctx.tokenFor(student.cognitoId),
      `/v1/sessions/${session.id}/extend`,
      { durationMinutes: 10 },
    );
    expect(res.statusCode).toBe(403);
  });

  it('requires authentication', async () => {
    const { session } = await seedRunning('extend-auth');
    const res = await ctx.app.inject({
      method: 'POST',
      url: `/v1/sessions/${session.id}/extend`,
      payload: { durationMinutes: 10 },
    });
    expect(res.statusCode).toBe(401);
  });

  it('is a 404 for an unknown session', async () => {
    const { teacher } = await seedClassroom(db, 'extend-404');
    const res = await post(
      await ctx.tokenFor(teacher.cognitoId),
      `/v1/sessions/${randomUUID()}/extend`,
      {
        durationMinutes: 10,
        eventId: randomUUID(),
      },
    );
    expect(res.statusCode).toBe(404);
  });
});

describe('POST /v1/sessions/:id/checkin', () => {
  it('a live student checks in and reads live with their state', async () => {
    const { student, session } = await seedRunning('checkin-live');
    await tap(session.id, student.id);
    const res = await post(
      await ctx.tokenFor(student.cognitoId),
      `/v1/sessions/${session.id}/checkin`,
      {
        deviceTime: now(),
      },
    );
    expect(res.statusCode).toBe(200);
    const body = res.json<CheckInResponse>();
    expect(body.status).toBe('live');
    expect(body.state).toBe('focused');
    expect(body.session?.id).toBe(session.id);
  });

  it('a student not in the session reads gone', async () => {
    const { student, session } = await seedRunning('checkin-gone');
    const res = await post(
      await ctx.tokenFor(student.cognitoId),
      `/v1/sessions/${session.id}/checkin`,
      {
        deviceTime: now(),
      },
    );
    expect(res.json<CheckInResponse>().status).toBe('gone');
    expect(res.json<CheckInResponse>().state).toBeNull();
    // Knowing a session id must not reveal that class's id and bell window.
    expect(res.json<CheckInResponse>().session).toBeNull();
  });

  it('is a 404 for an unknown session', async () => {
    const { student } = await seedClassroom(db, 'checkin-404');
    const res = await post(
      await ctx.tokenFor(student.cognitoId),
      `/v1/sessions/${randomUUID()}/checkin`,
      {
        deviceTime: now(),
      },
    );
    expect(res.statusCode).toBe(404);
  });

  it('requires authentication', async () => {
    const { session } = await seedRunning('checkin-auth');
    const res = await ctx.app.inject({
      method: 'POST',
      url: `/v1/sessions/${session.id}/checkin`,
      payload: { deviceTime: now() },
    });
    expect(res.statusCode).toBe(401);
  });
});

describe('POST /v1/sessions/:id/unlock', () => {
  it('flips a live participation to unlocked (applied)', async () => {
    const { student, session } = await seedRunning('unlock-live');
    await tap(session.id, student.id);
    const res = await post(
      await ctx.tokenFor(student.cognitoId),
      `/v1/sessions/${session.id}/unlock`,
      {
        eventId: randomUUID(),
        deviceTime: now(),
      },
    );
    expect(res.statusCode).toBe(200);
    const body = res.json<UnlockResponse>();
    expect(body.outcome).toBe('applied');
    expect(body.state).toBe('unlocked');
    expect(body).toHaveProperty('reason', null);
  });

  it('records the reason the phone sends, and says so', async () => {
    const { student, session } = await seedRunning('unlock-reason');
    await tap(session.id, student.id);
    const res = await post(
      await ctx.tokenFor(student.cognitoId),
      `/v1/sessions/${session.id}/unlock`,
      { eventId: randomUUID(), deviceTime: now(), reason: 'nurse' },
    );
    expect(res.statusCode).toBe(200);
    expect(res.json<UnlockResponse>()).toMatchObject({ outcome: 'applied', reason: 'nurse' });

    const recorded = await db
      .select()
      .from(events)
      .where(and(eq(events.sessionId, session.id), eq(events.type, 'unlock')));
    expect(recorded.map((e) => e.payload)).toEqual([{ reason: 'nurse' }]);
  });

  it('an unrecognised reason is recorded as none instead of refusing the unlock', async () => {
    // The standing rule for the unlock body (docs/PLAN.md, 2026-09-20): a 400
    // here keeps the record out forever, because the outbox retries the
    // identical body. A newer app's reason, a wrong type or plain garbage must
    // all still land — without a reason, and the response says none landed.
    // (Fastify's whole-body guards — the 1 MiB limit, prototype-poisoning keys
    // — run before any route and predate this field; no honest client trips them.)
    const { student, session } = await seedRunning('unlock-reason-unknown');
    await tap(session.id, student.id);
    const token = await ctx.tokenFor(student.cognitoId);
    const odd: unknown[] = [
      'skateboard',
      'BATHROOM',
      '',
      42,
      true,
      null,
      { why: 'nurse' },
      ['nurse'],
      'x'.repeat(10_000),
    ];
    for (const reason of odd) {
      const res = await post(token, `/v1/sessions/${session.id}/unlock`, {
        eventId: randomUUID(),
        deviceTime: now(),
        reason,
      });
      expect(res.statusCode, JSON.stringify(reason).slice(0, 40)).toBe(200);
      const body = res.json<UnlockResponse>();
      expect(unlockDisposition(res.statusCode, body)).toBe('recorded');
      expect(body.reason).toBeNull();
    }

    const recorded = await db
      .select()
      .from(events)
      .where(and(eq(events.sessionId, session.id), eq(events.type, 'unlock')));
    expect(recorded.map((e) => e.payload)).toEqual(odd.map(() => null));
  });

  it('a retried unlock answers with the reason on record, not the one it carries', async () => {
    const { student, session } = await seedRunning('unlock-reason-replay');
    await tap(session.id, student.id);
    const token = await ctx.tokenFor(student.cognitoId);
    const eventId = randomUUID();
    await post(token, `/v1/sessions/${session.id}/unlock`, {
      eventId,
      deviceTime: now(),
      reason: 'bathroom',
    });
    const retry = await post(token, `/v1/sessions/${session.id}/unlock`, {
      eventId,
      deviceTime: now(),
      reason: 'other',
    });
    expect(retry.json<UnlockResponse>()).toMatchObject({ outcome: 'replay', reason: 'bathroom' });
  });

  it('records with a note when there is no live participation (ISSUES #2)', async () => {
    const { student, session } = await seedRunning('unlock-note');
    const res = await post(
      await ctx.tokenFor(student.cognitoId),
      `/v1/sessions/${session.id}/unlock`,
      {
        eventId: randomUUID(),
        deviceTime: now(),
      },
    );
    expect(res.statusCode).toBe(200);
    const body = res.json<UnlockResponse>();
    expect(body.outcome).toBe('recorded');
    expect(body.recordedAs).toBe('no_live_participation');
  });

  it('records an unknown session id rather than 404ing (never discards)', async () => {
    await seedClassroom(db, 'unlock-unknown');
    const res = await post(
      await ctx.tokenFor('some-student'),
      `/v1/sessions/${randomUUID()}/unlock`,
      {
        eventId: randomUUID(),
        deviceTime: now(),
      },
    );
    expect(res.statusCode).toBe(200);
    const body = res.json<UnlockResponse>();
    expect(body.outcome).toBe('recorded');
    expect(body.recordedAs).toBe('unknown_session');
  });

  it('a reused event_id is a 409 the outbox keeps retrying, never a swallowed unlock', async () => {
    // insertEvent de-dupes on event_id alone, so an unlock carrying an id the
    // phone already spent on its own tap_in used to come back outcome
    // 'replay' — a recorded outcome — telling the outbox to delete a record
    // that was never written. A 409 maps to 'retry_and_surface', so the phone
    // keeps the record and the client bug is visible instead.
    const { student, session } = await seedRunning('unlock-id-reuse-api');
    const eventId = randomUUID();
    await tap(session.id, student.id, eventId);

    const res = await post(
      await ctx.tokenFor(student.cognitoId),
      `/v1/sessions/${session.id}/unlock`,
      { eventId, deviceTime: now() },
    );
    expect(res.statusCode).toBe(409);
    expect(res.json<{ error: { code: string } }>().error.code).toBe('conflict');
    expect(unlockDisposition(res.statusCode, res.json())).toBe('retry_and_surface');

    const unlocks = await db
      .select()
      .from(events)
      .where(and(eq(events.sessionId, session.id), eq(events.type, 'unlock')));
    expect(unlocks).toHaveLength(0);
  });

  it("records a stranger's unlock as an orphan rather than writing into a foreign session", async () => {
    const { session } = await seedRunning('unlock-stranger');
    // A valid, fully authenticated account with no enrollment in this class —
    // it has only learned (or guessed) the session id, which is a plain path
    // parameter. Without an authorization check this wrote permanent rows into
    // another teacher's history and put a phantom chip on their live grid.
    const res = await post(await ctx.tokenFor('outsider'), `/v1/sessions/${session.id}/unlock`, {
      eventId: randomUUID(),
      deviceTime: now(),
      reason: 'nurse',
    });

    // Never a refusal (rule 6) — but not attached, and no session handed back.
    expect(res.statusCode).toBe(200);
    const body = res.json<UnlockResponse>();
    expect(body.outcome).toBe('recorded');
    expect(body.recordedAs).toBe('not_enrolled');
    expect(body.session).toBeNull();
    // The orphan keeps the reason like any other unlock.
    expect(body.reason).toBe('nurse');
    const orphans = await db
      .select()
      .from(events)
      .where(and(isNull(events.sessionId), eq(events.type, 'unlock')));
    expect(orphans.map((e) => e.payload)).toEqual([
      expect.objectContaining({ recorded_as: 'not_enrolled', reason: 'nurse' }),
    ]);

    // The teacher's session feed never sees it.
    const attached = await db
      .select()
      .from(events)
      .where(and(eq(events.sessionId, session.id), eq(events.type, 'unlock')));
    expect(attached).toHaveLength(0);
  });

  it('a retried unlock replays', async () => {
    const { student, session } = await seedRunning('unlock-replay');
    await tap(session.id, student.id);
    const token = await ctx.tokenFor(student.cognitoId);
    const eventId = randomUUID();
    await post(token, `/v1/sessions/${session.id}/unlock`, { eventId, deviceTime: now() });
    const second = await post(token, `/v1/sessions/${session.id}/unlock`, {
      eventId,
      deviceTime: now(),
    });
    expect(second.json<UnlockResponse>().outcome).toBe('replay');
  });

  it('a late unlock — the student came back to focus after it — is recorded, never applied (A10)', async () => {
    // Stuck on the phone while the student unlocked again and refocused: it
    // lands last, and the refocus stands. Recorded, so the outbox deletes it,
    // and answered with the session and the state it left alone.
    const { student, session } = await seedRunning('unlock-late');
    const token = await ctx.tokenFor(student.cognitoId);
    const ago = (seconds: number) => new Date(Date.now() - seconds * 1000).toISOString();
    const send = (route: string, deviceTime: string, extra: object = {}, eventId = randomUUID()) =>
      post(token, `/v1/sessions/${session.id}/${route}`, { eventId, deviceTime, ...extra });
    await tapIn(db, {
      sessionId: session.id,
      studentId: student.id,
      eventId: randomUUID(),
      deviceTime: new Date(ago(50)),
    });
    expect((await send('unlock', ago(40))).json<UnlockResponse>().outcome).toBe('applied');
    expect((await send('refocus', ago(30))).statusCode).toBe(200);

    const lateId = randomUUID();
    const res = await send('unlock', ago(45), { reason: 'nurse' }, lateId);
    expect(res.statusCode).toBe(200);
    const body = res.json<UnlockResponse>();
    expect(body).toMatchObject({
      outcome: 'recorded',
      recordedAs: 'superseded',
      state: 'focused',
      session: { id: session.id, classId: session.classId },
      reason: 'nurse',
    });
    expect(unlockDisposition(res.statusCode, body)).toBe('recorded');
    const [row] = await db
      .select()
      .from(participations)
      .where(eq(participations.sessionId, session.id));
    expect(row?.state).toBe('focused');

    const retry = await send('unlock', ago(45), { reason: 'other' }, lateId);
    expect(retry.json<UnlockResponse>()).toMatchObject({
      outcome: 'replay',
      state: 'focused',
      reason: 'nurse',
    });
  });

  it('requires authentication', async () => {
    const { session } = await seedRunning('unlock-auth');
    const res = await ctx.app.inject({
      method: 'POST',
      url: `/v1/sessions/${session.id}/unlock`,
      payload: { eventId: randomUUID(), deviceTime: now() },
    });
    expect(res.statusCode).toBe(401);
  });
});

describe('POST /v1/taps/:eventId/unlock', () => {
  // Owner decision 11: an unlock made while the phone's own tap is unanswered,
  // sent under that tap's id — filed wherever the tap landed, or kept
  // unattached with a note. Never refused.
  const ago = (seconds: number) => new Date(Date.now() - seconds * 1000).toISOString();
  const tapBlock = (token: string, tagId: string, eventId: string) =>
    post(token, '/v1/taps', { tagId, eventId, deviceTime: ago(20) });
  const underTap = (token: string, tapId: string, body: object = {}) =>
    post(token, `/v1/taps/${tapId}/unlock`, {
      eventId: randomUUID(),
      deviceTime: ago(10),
      ...body,
    });
  const unlocksIn = (sessionId: string) =>
    db
      .select()
      .from(events)
      .where(and(eq(events.sessionId, sessionId), eq(events.type, 'unlock')));

  it('files the unlock in the session its tap landed in, and its retry replays', async () => {
    const { student, block, session } = await seedRunning('tap-unlock-api');
    const token = await ctx.tokenFor(student.cognitoId);
    const tapId = randomUUID();
    expect((await tapBlock(token, block.tagId, tapId)).json<TapResponse>().outcome).toBe('joined');

    const eventId = randomUUID();
    const res = await underTap(token, tapId, { eventId, reason: 'bathroom' });
    expect(res.statusCode).toBe(200);
    const body = res.json<UnlockResponse>();
    expect(body).toMatchObject({
      outcome: 'applied',
      recordedAs: null,
      state: 'unlocked',
      session: { id: session.id, classId: session.classId },
      reason: 'bathroom',
    });
    expect(unlockDisposition(res.statusCode, body)).toBe('recorded');

    const retry = await underTap(token, tapId, { eventId, reason: 'other' });
    expect(retry.json<UnlockResponse>()).toMatchObject({
      outcome: 'replay',
      state: 'unlocked',
      session: { id: session.id },
      reason: 'bathroom',
    });
    expect((await unlocksIn(session.id)).map((e) => e.payload)).toEqual([
      { tap_event_id: tapId, reason: 'bathroom' },
    ]);
  });

  it('keeps it unattached, noted, when its tap was only armed or never arrived', async () => {
    const { student, block } = await seedClassroom(db, 'tap-unlock-api-kept');
    const token = await ctx.tokenFor(student.cognitoId);
    const armedId = randomUUID();
    expect((await tapBlock(token, block.tagId, armedId)).json<TapResponse>().outcome).toBe('armed');

    for (const [tapId, note] of [
      [armedId, 'tap_armed'],
      [randomUUID(), 'unknown_tap'],
    ] as const) {
      const res = await underTap(token, tapId, { reason: 'nurse' });
      expect(res.statusCode, note).toBe(200);
      expect(res.json<UnlockResponse>(), note).toEqual({
        outcome: 'recorded',
        recordedAs: note,
        state: null,
        session: null,
        reason: 'nurse',
      });
      expect(unlockDisposition(res.statusCode, res.json())).toBe('recorded');
    }
  });

  it('a tap reaching the server after its unlock answers with the unlock filed there', async () => {
    const { student, block, session } = await seedRunning('tap-unlock-api-late-tap');
    const token = await ctx.tokenFor(student.cognitoId);
    const tapId = randomUUID();
    const kept = await underTap(token, tapId);
    expect(kept.json<UnlockResponse>().recordedAs).toBe('unknown_tap');

    const tapped = await tapBlock(token, block.tagId, tapId);
    expect(tapped.json<TapResponse>()).toMatchObject({
      outcome: 'joined',
      state: 'unlocked',
      session: { id: session.id },
    });
    // A window to reconcile to, and a state that is not focused: no shields.
    expect(tapDisposition(tapped.statusCode, tapped.json())).toBe('apply_session');
    expect(await unlocksIn(session.id)).toHaveLength(1);
  });

  it('files nothing under a tap that is not the caller’s: a stranger’s or a teacher’s is kept unattached', async () => {
    const { teacher, student, block, session } = await seedRunning('tap-unlock-api-theirs');
    const tapId = randomUUID();
    await tapBlock(await ctx.tokenFor(student.cognitoId), block.tagId, tapId);

    for (const who of ['outsider', teacher.cognitoId]) {
      const res = await underTap(await ctx.tokenFor(who), tapId);
      expect(res.statusCode, who).toBe(200);
      expect(res.json<UnlockResponse>(), who).toMatchObject({
        outcome: 'recorded',
        recordedAs: 'unknown_tap',
        session: null,
      });
    }
    const [row] = await db
      .select()
      .from(participations)
      .where(eq(participations.sessionId, session.id));
    expect(row?.state).toBe('focused');
    expect(await unlocksIn(session.id)).toHaveLength(0);
  });

  it('a malformed tap id or body is a 400 the outbox keeps; an unknown reason is recorded as none', async () => {
    const { student } = await seedRunning('tap-unlock-api-400');
    const token = await ctx.tokenFor(student.cognitoId);
    const badTap = await post(token, '/v1/taps/not-a-uuid/unlock', {
      eventId: randomUUID(),
      deviceTime: ago(10),
    });
    expect(badTap.statusCode).toBe(400);
    const badBody = await underTap(token, randomUUID(), { eventId: 'x' });
    expect(badBody.statusCode).toBe(400);
    expect(unlockDisposition(badBody.statusCode, badBody.json())).toBe('retry_and_surface');

    const odd = await underTap(token, randomUUID(), { reason: 'skateboard' });
    expect(odd.statusCode).toBe(200);
    expect(odd.json<UnlockResponse>()).toMatchObject({ outcome: 'recorded', reason: null });
  });

  it('an id another event holds is a 409 the outbox keeps retrying', async () => {
    const { student, block } = await seedRunning('tap-unlock-api-409');
    const token = await ctx.tokenFor(student.cognitoId);
    const tapId = randomUUID();
    await tapBlock(token, block.tagId, tapId);
    const res = await underTap(token, tapId, { eventId: tapId });
    expect(res.statusCode).toBe(409);
    expect(res.json<{ error: { reason: string } }>().error.reason).toBe('event_id_conflict');
    expect(unlockDisposition(res.statusCode, res.json())).toBe('retry_and_surface');
  });

  it('requires authentication', async () => {
    const res = await ctx.app.inject({
      method: 'POST',
      url: `/v1/taps/${randomUUID()}/unlock`,
      payload: { eventId: randomUUID(), deviceTime: now() },
    });
    expect(res.statusCode).toBe(401);
  });
});

describe('POST /v1/sessions/:id/protection-off', () => {
  it('marks a live student as protection off, and a retry replays', async () => {
    const { student, session } = await seedRunning('protoff-live');
    await tap(session.id, student.id);
    const token = await ctx.tokenFor(student.cognitoId);
    const body = { eventId: randomUUID(), deviceTime: now() };

    const res = await post(token, `/v1/sessions/${session.id}/protection-off`, body);
    expect(res.statusCode).toBe(200);
    const first = res.json<ProtectionOffResponse>();
    expect(first.outcome).toBe('applied');
    expect(first.recordedAs).toBeNull();
    expect(first.state).toBe('protection_off');
    expect(first.session?.id).toBe(session.id);

    const retry = await post(token, `/v1/sessions/${session.id}/protection-off`, body);
    expect(retry.json<ProtectionOffResponse>()).toMatchObject({
      outcome: 'replay',
      recordedAs: null,
      state: 'protection_off',
    });
    const recorded = await db
      .select()
      .from(events)
      .where(and(eq(events.sessionId, session.id), eq(events.type, 'protection_off')));
    expect(recorded).toHaveLength(1);

    // A replay answers the CURRENT truth, not the state it once set: after a
    // re-tap the same retry says "focused", so a phone that tapped back in is
    // never sent back to the tap-the-block screen by its own stale record.
    await tap(session.id, student.id);
    const afterRetap = await post(token, `/v1/sessions/${session.id}/protection-off`, body);
    expect(afterRetap.json<ProtectionOffResponse>()).toMatchObject({
      outcome: 'replay',
      state: 'focused',
    });
  });

  it('a change retried after an early end is a 409, never a replay naming the ended session', async () => {
    // The teacher ends the lesson early, so the session's endsAt is still ahead:
    // a 200 replay would hand a phone that already heard "gone" a window to
    // shield to (a refocus answer turns shields back on). The phone drops the
    // refusal and re-reads the truth instead. The report landed while the
    // session ran, so decision 10 (a report FIRST arriving after the end is
    // recorded) does not cover its retry: it is on record, and keeps the 409.
    const { teacher, student, session } = await seedRunning('protoff-after-bell');
    await tap(session.id, student.id);
    const token = await ctx.tokenFor(student.cognitoId);
    await post(token, `/v1/sessions/${session.id}/unlock`, {
      eventId: randomUUID(),
      deviceTime: now(),
    });
    const refocusBody = { eventId: randomUUID(), deviceTime: now() };
    expect((await post(token, `/v1/sessions/${session.id}/refocus`, refocusBody)).statusCode).toBe(
      200,
    );
    const reportBody = { eventId: randomUUID(), deviceTime: now() };
    expect(
      (await post(token, `/v1/sessions/${session.id}/protection-off`, reportBody)).statusCode,
    ).toBe(200);
    await post(await ctx.tokenFor(teacher.cognitoId), `/v1/sessions/${session.id}/end`);

    for (const [route, body] of [
      ['refocus', refocusBody],
      ['protection-off', reportBody],
    ] as const) {
      const retry = await post(token, `/v1/sessions/${session.id}/${route}`, body);
      expect(retry.statusCode).toBe(409);
      expect(retry.json<{ error: { message: string } }>().error.message).toBe('session has ended');
    }
  });

  it('a report that first arrives after the session ended is recorded with a note: 200, no session', async () => {
    // Owner decision 10: saved like a late unlock, so the history says why the
    // phone went quiet. The teacher ended this lesson early, so its endsAt is
    // still ahead: the answer carries no session and no state, so the phone is
    // never handed a window to shield to.
    const { teacher, student, session } = await seedRunning('protoff-late');
    await tap(session.id, student.id);
    await post(await ctx.tokenFor(teacher.cognitoId), `/v1/sessions/${session.id}/end`);
    const token = await ctx.tokenFor(student.cognitoId);
    const url = `/v1/sessions/${session.id}/protection-off`;
    const body = { eventId: randomUUID(), deviceTime: now() };
    const recorded = () =>
      db
        .select()
        .from(events)
        .where(and(eq(events.sessionId, session.id), eq(events.type, 'protection_off')));

    const res = await post(token, url, body);
    expect(res.statusCode).toBe(200);
    expect(res.json<ProtectionOffResponse>()).toEqual({
      outcome: 'recorded',
      recordedAs: 'after_session_end',
      state: null,
      session: null,
    });
    const retry = await post(token, url, body);
    expect(retry.statusCode).toBe(200);
    expect(retry.json<ProtectionOffResponse>()).toEqual({
      outcome: 'replay',
      recordedAs: null,
      state: null,
      session: null,
    });
    expect((await recorded()).map((e) => e.payload)).toEqual([
      { recorded_as: 'after_session_end' },
    ]);

    // Validation still comes first: a malformed report is a 400 and records nothing.
    for (const bad of [{ eventId: 'not-a-uuid', deviceTime: now() }, { eventId: randomUUID() }]) {
      expect((await post(token, url, bad)).statusCode).toBe(400);
    }
    expect(await recorded()).toHaveLength(1);
  });

  it('after the end, anyone who was not in the session at its end is still a 409, and nothing is recorded', async () => {
    // Decision 10 covers a student who was in the session when it ended. An
    // outsider, the teacher, an enrolled student who never tapped in, and one
    // removed before the end keep the refusal they had: no one writes into a
    // session they were not in at its end.
    const { school, klass, teacher, student, session } = await seedRunning('protoff-late-who');
    const [absent, removed] = await db
      .insert(users)
      .values(
        ['absent', 'removed'].map((who) => ({
          cognitoId: `student-protoff-late-${who}`,
          role: 'student' as const,
          schoolId: school.id,
        })),
      )
      .returning();
    if (!absent || !removed) throw new Error('expected two students');
    const [, removedEnrollment] = await db
      .insert(enrollments)
      .values([absent, removed].map((s) => ({ classId: klass.id, studentId: s.id })))
      .returning();
    await tap(session.id, student.id);
    await tap(session.id, removed.id);
    await endEnrollment(db, {
      enrollmentId: removedEnrollment!.id,
      reason: 'removed_from_class',
      at: new Date(),
    });
    await post(await ctx.tokenFor(teacher.cognitoId), `/v1/sessions/${session.id}/end`);

    for (const sub of ['outsider', teacher.cognitoId, absent.cognitoId, removed.cognitoId]) {
      const res = await post(await ctx.tokenFor(sub), `/v1/sessions/${session.id}/protection-off`, {
        eventId: randomUUID(),
        deviceTime: now(),
      });
      expect(res.statusCode, sub).toBe(409);
      expect(res.json<{ error: { message: string } }>().error.message).toBe('session has ended');
    }
    const recorded = await db
      .select()
      .from(events)
      .where(and(eq(events.sessionId, session.id), eq(events.type, 'protection_off')));
    expect(recorded).toHaveLength(0);
  });

  it('a report retried after the student was removed mid-session is a 409, never a replay naming the session', async () => {
    // The session still runs, so the bell's guard does not catch this, and the
    // ended row's last state ("focused", after a re-tap) is not the truth for a
    // removed student. The phone drops the refusal and re-reads the truth.
    const { klass, student, session } = await seedRunning('protoff-removed');
    await tap(session.id, student.id);
    const token = await ctx.tokenFor(student.cognitoId);
    const body = { eventId: randomUUID(), deviceTime: now() };
    expect((await post(token, `/v1/sessions/${session.id}/protection-off`, body)).statusCode).toBe(
      200,
    );
    await tap(session.id, student.id);
    const [enrollment] = await db
      .select()
      .from(enrollments)
      .where(and(eq(enrollments.classId, klass.id), eq(enrollments.studentId, student.id)));
    if (!enrollment) throw new Error('expected an enrollment');
    await endEnrollment(db, {
      enrollmentId: enrollment.id,
      reason: 'removed_from_class',
      at: new Date(),
    });

    const retry = await post(token, `/v1/sessions/${session.id}/protection-off`, body);
    expect(retry.statusCode).toBe(409);
    expect(retry.json<{ error: { message: string } }>().error.message).toBe('not in this session');
    const recorded = await db
      .select()
      .from(events)
      .where(and(eq(events.sessionId, session.id), eq(events.type, 'protection_off')));
    expect(recorded).toHaveLength(1);
  });

  it('is a 409 for a student with nothing live here, and records nothing', async () => {
    const { student, session } = await seedRunning('protoff-none');
    const res = await post(
      await ctx.tokenFor(student.cognitoId),
      `/v1/sessions/${session.id}/protection-off`,
      { eventId: randomUUID(), deviceTime: now() },
    );
    expect(res.statusCode).toBe(409);
    const recorded = await db
      .select()
      .from(events)
      .where(and(eq(events.sessionId, session.id), eq(events.type, 'protection_off')));
    expect(recorded).toHaveLength(0);
  });

  it('nobody else can mark a live student: an outsider or the teacher gets 409', async () => {
    // The student IS live here, so a report that resolved anyone's row but
    // the caller's would have someone to mark — this is what fails if the
    // engine ever loads a participation that is not the caller's own.
    const { teacher, student, session } = await seedRunning('protoff-authz');
    await tap(session.id, student.id);
    for (const sub of ['outsider', teacher.cognitoId]) {
      const res = await post(await ctx.tokenFor(sub), `/v1/sessions/${session.id}/protection-off`, {
        eventId: randomUUID(),
        deviceTime: now(),
      });
      expect(res.statusCode).toBe(409);
    }
    const recorded = await db
      .select()
      .from(events)
      .where(and(eq(events.sessionId, session.id), eq(events.type, 'protection_off')));
    expect(recorded).toHaveLength(0);
    const [row] = await db
      .select()
      .from(participations)
      .where(
        and(eq(participations.sessionId, session.id), eq(participations.studentId, student.id)),
      );
    expect(row?.state).toBe('focused');
  });

  it('is a 404 for an unknown session', async () => {
    await seedClassroom(db, 'protoff-404');
    const res = await post(
      await ctx.tokenFor('lost-student'),
      `/v1/sessions/${randomUUID()}/protection-off`,
      { eventId: randomUUID(), deviceTime: now() },
    );
    expect(res.statusCode).toBe(404);
  });

  it('rejects a malformed body (400)', async () => {
    const { student, session } = await seedRunning('protoff-400');
    await tap(session.id, student.id);
    const token = await ctx.tokenFor(student.cognitoId);
    for (const body of [
      { eventId: 'not-a-uuid', deviceTime: now() },
      { eventId: randomUUID() },
      { eventId: randomUUID(), deviceTime: '2026-09-20T09:15:00' },
    ]) {
      const res = await post(token, `/v1/sessions/${session.id}/protection-off`, body);
      expect(res.statusCode).toBe(400);
    }
  });

  it('requires authentication', async () => {
    const { session } = await seedRunning('protoff-auth');
    const res = await ctx.app.inject({
      method: 'POST',
      url: `/v1/sessions/${session.id}/protection-off`,
      payload: { eventId: randomUUID(), deviceTime: now() },
    });
    expect(res.statusCode).toBe(401);
  });

  it('afterwards, refocus is refused and an unlock is recorded without softening it', async () => {
    const { student, session } = await seedRunning('protoff-after');
    await tap(session.id, student.id);
    const token = await ctx.tokenFor(student.cognitoId);
    await post(token, `/v1/sessions/${session.id}/protection-off`, {
      eventId: randomUUID(),
      deviceTime: now(),
    });

    const refocused = await post(token, `/v1/sessions/${session.id}/refocus`, {
      eventId: randomUUID(),
      deviceTime: now(),
    });
    expect(refocused.statusCode).toBe(409);
    expect(refocused.json<{ error: { message: string } }>().error.message).toBe(
      'Screen Time permission is off: tap the block to rejoin',
    );

    const unlocked = await post(token, `/v1/sessions/${session.id}/unlock`, {
      eventId: randomUUID(),
      deviceTime: now(),
    });
    expect(unlocked.statusCode).toBe(200);
    const body = unlocked.json<UnlockResponse>();
    expect(body).toMatchObject({
      outcome: 'recorded',
      recordedAs: 'protection_off',
      state: 'protection_off',
    });
    expect(unlockDisposition(unlocked.statusCode, body)).toBe('recorded');
  });
});

describe('POST /v1/sessions/:id/refocus', () => {
  it('returns an unlocked student to focus', async () => {
    const { student, session } = await seedRunning('refocus-ok');
    await tap(session.id, student.id);
    const token = await ctx.tokenFor(student.cognitoId);
    await post(token, `/v1/sessions/${session.id}/unlock`, {
      eventId: randomUUID(),
      deviceTime: now(),
    });
    const res = await post(token, `/v1/sessions/${session.id}/refocus`, {
      eventId: randomUUID(),
      deviceTime: now(),
    });
    expect(res.statusCode).toBe(200);
    const body = res.json<RefocusResponse>();
    expect(body.outcome).toBe('applied');
    expect(body.state).toBe('focused');
  });

  it('nobody else can refocus a live student: an outsider or the teacher gets 409', async () => {
    const { teacher, student, session } = await seedRunning('refocus-authz');
    await tap(session.id, student.id);
    await post(await ctx.tokenFor(student.cognitoId), `/v1/sessions/${session.id}/unlock`, {
      eventId: randomUUID(),
      deviceTime: now(),
    });
    for (const sub of ['outsider', teacher.cognitoId]) {
      const res = await post(await ctx.tokenFor(sub), `/v1/sessions/${session.id}/refocus`, {
        eventId: randomUUID(),
        deviceTime: now(),
      });
      expect(res.statusCode).toBe(409);
    }
    const refocuses = await db
      .select()
      .from(events)
      .where(and(eq(events.sessionId, session.id), eq(events.type, 'refocus')));
    expect(refocuses).toHaveLength(0);
    const [row] = await db
      .select()
      .from(participations)
      .where(
        and(eq(participations.sessionId, session.id), eq(participations.studentId, student.id)),
      );
    expect(row?.state).toBe('unlocked');
  });

  it('a retried refocus replays the current truth while the student is live', async () => {
    const { student, session } = await seedRunning('refocus-replay');
    await tap(session.id, student.id);
    const token = await ctx.tokenFor(student.cognitoId);
    await post(token, `/v1/sessions/${session.id}/unlock`, {
      eventId: randomUUID(),
      deviceTime: now(),
    });
    const body = { eventId: randomUUID(), deviceTime: now() };
    expect((await post(token, `/v1/sessions/${session.id}/refocus`, body)).statusCode).toBe(200);

    const retry = await post(token, `/v1/sessions/${session.id}/refocus`, body);
    expect(retry.statusCode).toBe(200);
    expect(retry.json<RefocusResponse>()).toEqual({
      outcome: 'replay',
      state: 'focused',
      session: {
        id: session.id,
        classId: session.classId,
        endsAt: session.endsAt.toISOString(),
      },
    });
    const refocuses = await db
      .select()
      .from(events)
      .where(and(eq(events.sessionId, session.id), eq(events.type, 'refocus')));
    expect(refocuses).toHaveLength(1);
  });

  it('a refocus retried after the student was removed replays naming no session and no state', async () => {
    // A4: answered with the session until now — the ended row's last state
    // and a window the phone would shield to, in a session the student is no
    // longer in. The session still runs, so the bell's guard never saw it.
    const { klass, student, session } = await seedRunning('refocus-removed');
    await tap(session.id, student.id);
    const token = await ctx.tokenFor(student.cognitoId);
    await post(token, `/v1/sessions/${session.id}/unlock`, {
      eventId: randomUUID(),
      deviceTime: now(),
    });
    const body = { eventId: randomUUID(), deviceTime: now() };
    expect((await post(token, `/v1/sessions/${session.id}/refocus`, body)).statusCode).toBe(200);
    const [enrollment] = await db
      .select()
      .from(enrollments)
      .where(and(eq(enrollments.classId, klass.id), eq(enrollments.studentId, student.id)));
    if (!enrollment) throw new Error('expected an enrollment');
    await endEnrollment(db, {
      enrollmentId: enrollment.id,
      reason: 'removed_from_class',
      at: new Date(),
    });

    const retry = await post(token, `/v1/sessions/${session.id}/refocus`, body);
    expect(retry.statusCode).toBe(200);
    expect(retry.json<RefocusResponse>()).toEqual({
      outcome: 'replay',
      state: null,
      session: null,
    });
  });

  it("another student's refocus id is a 409, never a replay of theirs", async () => {
    // The replay answers only the caller's own event: a classmate sending an
    // id already recorded as someone else's refocus learns nothing about it.
    const { school, klass, student, session } = await seedRunning('refocus-theirs');
    const [classmate] = await db
      .insert(users)
      .values({ cognitoId: 'student-refocus-theirs-2', role: 'student', schoolId: school.id })
      .returning();
    if (!classmate) throw new Error('expected a classmate');
    await db.insert(enrollments).values({ classId: klass.id, studentId: classmate.id });
    for (const who of [student, classmate]) await tap(session.id, who.id);
    const token = await ctx.tokenFor(student.cognitoId);
    await post(token, `/v1/sessions/${session.id}/unlock`, {
      eventId: randomUUID(),
      deviceTime: now(),
    });
    const body = { eventId: randomUUID(), deviceTime: now() };
    expect((await post(token, `/v1/sessions/${session.id}/refocus`, body)).statusCode).toBe(200);

    const res = await post(
      await ctx.tokenFor(classmate.cognitoId),
      `/v1/sessions/${session.id}/refocus`,
      body,
    );
    expect(res.statusCode).toBe(409);
    expect(res.json<{ error: { message: string } }>().error.message).toBe(
      'event_id already used by another event',
    );
  });

  it('rejects a malformed body (400)', async () => {
    const { student, session } = await seedRunning('refocus-400');
    await tap(session.id, student.id);
    const token = await ctx.tokenFor(student.cognitoId);
    for (const body of [
      { eventId: 'not-a-uuid', deviceTime: now() },
      { eventId: randomUUID() },
      { eventId: randomUUID(), deviceTime: '2026-09-20T09:15:00' },
    ]) {
      const res = await post(token, `/v1/sessions/${session.id}/refocus`, body);
      expect(res.statusCode).toBe(400);
    }
  });

  it('requires authentication', async () => {
    const { session } = await seedRunning('refocus-auth');
    const res = await ctx.app.inject({
      method: 'POST',
      url: `/v1/sessions/${session.id}/refocus`,
      payload: { eventId: randomUUID(), deviceTime: now() },
    });
    expect(res.statusCode).toBe(401);
  });

  it('is a 409 with no live participation to refocus', async () => {
    const { student, session } = await seedRunning('refocus-none');
    const res = await post(
      await ctx.tokenFor(student.cognitoId),
      `/v1/sessions/${session.id}/refocus`,
      {
        eventId: randomUUID(),
        deviceTime: now(),
      },
    );
    expect(res.statusCode).toBe(409);
  });

  it('is a 404 for an unknown session', async () => {
    await seedClassroom(db, 'refocus-404');
    const res = await post(
      await ctx.tokenFor('lost-student'),
      `/v1/sessions/${randomUUID()}/refocus`,
      {
        eventId: randomUUID(),
        deviceTime: now(),
      },
    );
    expect(res.statusCode).toBe(404);
  });
});
