import {
  classes,
  type Database,
  endEnrollment,
  endSession,
  enrollments,
  startSession,
} from '@bali/db';
import { stateChangeDisposition, tapDisposition } from '@bali/shared';
import { and, eq } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { authedInject, makeAuthedApp, type AuthedApp } from './helpers/app.js';
import { makeTestDb, seedClassroom } from './helpers/db.js';

/*
 * The outbox tables in @bali/shared bound to the server's real answers. Each
 * case drives an actual tap, refocus or protection-off report through the
 * app and asserts the disposition of the status and body that came back — so
 * a server change that would send a phone the wrong way (shield to a session
 * that is over, resend a refusal, drop a tap it never kept) goes red here,
 * not on a student's phone.
 */

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

/** A 2xx body or the error shape — whatever came back. */
interface Answer {
  outcome?: string;
  session?: { id: string } | null;
  state?: string | null;
  error?: { code: string; message: string };
}

const now = () => new Date().toISOString();

async function start(classId: string) {
  const { session } = await startSession(db, {
    classId,
    startedAt: new Date(Date.now() - 60_000),
    endsAt: new Date(Date.now() + 25 * 60_000),
  });
  return session;
}

async function post(token: string, url: string, payload: object) {
  const res = await authedInject(ctx.app, token, { method: 'POST', url, payload });
  return { status: res.statusCode, body: res.json<Answer>() };
}

async function tap(token: string, tagId: string, eventId: string = randomUUID()) {
  const { status, body } = await post(token, '/v1/taps', { tagId, eventId, deviceTime: now() });
  return { status, body, disposition: tapDisposition(status, body) };
}

async function change(
  token: string,
  sessionId: string,
  route: 'refocus' | 'protection-off',
  eventId: string = randomUUID(),
) {
  const { status, body } = await post(token, `/v1/sessions/${sessionId}/${route}`, {
    eventId,
    deviceTime: now(),
  });
  return { status, body, disposition: stateChangeDisposition(status, body) };
}

async function unlock(token: string, sessionId: string) {
  const res = await post(token, `/v1/sessions/${sessionId}/unlock`, {
    eventId: randomUUID(),
    deviceTime: now(),
  });
  expect(res.status).toBe(200);
}

/** A second class of the same teacher, with the classroom's student enrolled in it too. */
async function secondClass(c: Awaited<ReturnType<typeof seedClassroom>>, code: string) {
  const [second] = await db
    .insert(classes)
    .values({ teacherId: c.teacher.id, schoolId: c.school.id, name: 'Second', joinCode: code })
    .returning();
  if (!second) throw new Error('expected a class');
  await db.insert(enrollments).values({ classId: second.id, studentId: c.student.id });
  return second;
}

describe('tapDisposition, against POST /v1/taps', () => {
  it('joined, switched and the replay of a live tap apply the session they name', async () => {
    const a = await seedClassroom(db, 'oc-join-a');
    const b = await seedClassroom(db, 'oc-join-b');
    await db.insert(enrollments).values({ classId: b.klass.id, studentId: a.student.id });
    const token = await ctx.tokenFor(a.student.cognitoId);
    const first = await start(a.klass.id);

    const eventId = randomUUID();
    const joined = await tap(token, a.block.tagId, eventId);
    expect(joined.body).toMatchObject({ outcome: 'joined', state: 'focused' });
    expect(joined.body.session?.id).toBe(first.id);
    expect(joined.disposition).toBe('apply_session');

    // A replay answers the CURRENT state: after an unlock, a phone that lost
    // the first answer learns it is unlocked, not that it should shield.
    await unlock(token, first.id);
    const replay = await tap(token, a.block.tagId, eventId);
    expect(replay.body).toMatchObject({ outcome: 'replay', state: 'unlocked' });
    expect(replay.body.session?.id).toBe(first.id);
    expect(replay.disposition).toBe('apply_session');

    const other = await start(b.klass.id);
    const switched = await tap(token, b.block.tagId);
    expect(switched.body).toMatchObject({ outcome: 'switched', state: 'focused' });
    expect(switched.body.session?.id).toBe(other.id);
    expect(switched.disposition).toBe('apply_session');
  });

  it('armed and already_armed wait for the start, with no window', async () => {
    const c = await seedClassroom(db, 'oc-arm');
    const token = await ctx.tokenFor(c.student.cognitoId);

    const armed = await tap(token, c.block.tagId);
    expect(armed.body).toEqual({ outcome: 'armed', session: null, state: null });
    expect(armed.disposition).toBe('wait_for_start');

    const again = await tap(token, c.block.tagId);
    expect(again.body).toEqual({ outcome: 'already_armed', session: null, state: null });
    expect(again.disposition).toBe('wait_for_start');
  });

  it('a recorded tap retried with nothing running names no session: delete it and re-read', async () => {
    // The replay that is correct today and after A4 alike: recorded, nothing
    // to shield to. Two shapes reach it now — a tap that landed in a session
    // since over, and the retry of a tap still armed (whose waiting row
    // stands, so deleting is right; the answer cannot say it is waiting).
    const c = await seedClassroom(db, 'oc-over');
    const token = await ctx.tokenFor(c.student.cognitoId);
    const session = await start(c.klass.id);
    const landed = randomUUID();
    expect((await tap(token, c.block.tagId, landed)).disposition).toBe('apply_session');
    await endSession(db, { sessionId: session.id, at: new Date(), reason: 'ended' });

    const retry = await tap(token, c.block.tagId, landed);
    expect(retry.body).toEqual({ outcome: 'replay', session: null, state: null });
    expect(retry.disposition).toBe('reread');

    const waiting = randomUUID();
    expect((await tap(token, c.block.tagId, waiting)).disposition).toBe('wait_for_start');
    const armedRetry = await tap(token, c.block.tagId, waiting);
    expect(armedRetry.body).toEqual({ outcome: 'replay', session: null, state: null });
    expect(armedRetry.disposition).toBe('reread');
  });

  it('a retry recorded but no longer current is a 409 today: kept, retried and surfaced', async () => {
    // A4 answers both of these `200 replay` with no session, which the table
    // already reads as 'reread' — these are the assertions A4 changes.
    const c = await seedClassroom(db, 'oc-stale');
    const second = await secondClass(c, 'JOIN-oc-stale-2');
    const token = await ctx.tokenFor(c.student.cognitoId);

    // Left: tapped into period 1, then a real tap moved them to period 2,
    // which ended; the stale retry resolves back to period 1, still running.
    const period1 = await start(c.klass.id);
    const left = randomUUID();
    expect((await tap(token, c.block.tagId, left)).body.outcome).toBe('joined');
    const period2 = await start(second.id);
    expect((await tap(token, c.block.tagId)).body.outcome).toBe('switched');
    await endSession(db, { sessionId: period2.id, at: new Date(), reason: 'ended' });
    const leftRetry = await tap(token, c.block.tagId, left);
    expect(leftRetry.status).toBe(409);
    expect(leftRetry.body.error?.message).toBe('not in this session');
    expect(leftRetry.disposition).toBe('retry_and_surface');

    // Over: period 1 ends and a period 3 starts, so the retry of a tap
    // recorded in period 1 is re-resolved to period 3.
    const over = randomUUID();
    expect((await tap(token, c.block.tagId, over)).body.outcome).toBe('joined');
    await endSession(db, { sessionId: period1.id, at: new Date(), reason: 'ended' });
    await start(second.id);
    const overRetry = await tap(token, c.block.tagId, over);
    expect(overRetry.status).toBe(409);
    expect(overRetry.body.error?.message).toBe('event_id already used by another event');
    expect(overRetry.disposition).toBe('retry_and_surface');
  });

  it('an id held by a different event is a 409 that never lands: kept and surfaced', async () => {
    const a = await seedClassroom(db, 'oc-held-a');
    const b = await seedClassroom(db, 'oc-held-b');
    const eventId = randomUUID();
    expect(
      (await tap(await ctx.tokenFor(a.student.cognitoId), a.block.tagId, eventId)).status,
    ).toBe(200);

    const stranger = await ctx.tokenFor(b.student.cognitoId);
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const res = await tap(stranger, a.block.tagId, eventId);
      expect(res.status).toBe(409);
      expect(res.disposition).toBe('retry_and_surface');
    }
  });

  it('an unknown block and a malformed tap are kept and surfaced; no token re-authenticates', async () => {
    const c = await seedClassroom(db, 'oc-tap-refused');
    const token = await ctx.tokenFor(c.student.cognitoId);

    const unknown = await tap(token, 'NOT-A-BLOCK');
    expect(unknown.status).toBe(404);
    expect(unknown.disposition).toBe('retry_and_surface');

    const malformed = await post(token, '/v1/taps', {
      tagId: c.block.tagId,
      eventId: 'not-a-uuid',
      deviceTime: now(),
    });
    expect(malformed.status).toBe(400);
    expect(tapDisposition(malformed.status, malformed.body)).toBe('retry_and_surface');

    const res = await ctx.app.inject({ method: 'POST', url: '/v1/taps', payload: {} });
    expect(res.statusCode).toBe(401);
    expect(tapDisposition(res.statusCode, res.json<Answer>())).toBe('reauth');
  });
});

describe('stateChangeDisposition, against refocus and protection off', () => {
  async function running(tag: string) {
    const c = await seedClassroom(db, tag);
    const session = await start(c.klass.id);
    const token = await ctx.tokenFor(c.student.cognitoId);
    expect((await tap(token, c.block.tagId)).body.outcome).toBe('joined');
    return { ...c, session, token };
  }

  it('applied, and a replay while the session runs, apply the session they name', async () => {
    const { session, token } = await running('oc-sc-live');
    await unlock(token, session.id);

    const refocusId = randomUUID();
    for (const outcome of ['applied', 'replay']) {
      const res = await change(token, session.id, 'refocus', refocusId);
      expect(res.body).toMatchObject({ outcome, state: 'focused' });
      expect(res.body.session?.id).toBe(session.id);
      expect(res.disposition).toBe('apply_session');
    }

    const reportId = randomUUID();
    for (const outcome of ['applied', 'replay']) {
      const res = await change(token, session.id, 'protection-off', reportId);
      expect(res.body).toMatchObject({ outcome, state: 'protection_off' });
      expect(res.body.session?.id).toBe(session.id);
      expect(res.disposition).toBe('apply_session');
    }
  });

  it('a protection off recorded after the end, and its replay, carry no session: delete and re-read', async () => {
    const { teacher, session, token } = await running('oc-sc-late');
    await post(await ctx.tokenFor(teacher.cognitoId), `/v1/sessions/${session.id}/end`, {});

    const reportId = randomUUID();
    for (const outcome of ['recorded', 'replay']) {
      const res = await change(token, session.id, 'protection-off', reportId);
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ outcome, session: null, state: null });
      expect(res.disposition).toBe('reread');
    }
  });

  it('every refusal is dropped and never resent; no token re-authenticates', async () => {
    const { klass, student, session, token } = await running('oc-sc-refused');
    const refusals: { res: Awaited<ReturnType<typeof change>>; message: string }[] = [];

    // A report lands, so the student is in protection off.
    const landed = randomUUID();
    expect((await change(token, session.id, 'protection-off', landed)).status).toBe(200);
    // Out of protection off, only a re-tap returns: refocus is refused.
    refusals.push({
      res: await change(token, session.id, 'refocus'),
      message: 'Screen Time permission is off: tap the block to rejoin',
    });
    // An id already held by another event (the report's).
    refusals.push({
      res: await change(token, session.id, 'refocus', landed),
      message: 'event_id already used by another event',
    });
    // Removed mid-session: the report's retry, and a fresh refocus, find
    // nothing live.
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
    refusals.push({
      res: await change(token, session.id, 'protection-off', landed),
      message: 'not in this session',
    });
    refusals.push({
      res: await change(token, session.id, 'refocus'),
      message: 'not in this session',
    });

    // After the end: any refocus, and the retry of a report that landed
    // while the session ran.
    const other = await running('oc-sc-ended');
    const ranReport = randomUUID();
    expect((await change(other.token, other.session.id, 'protection-off', ranReport)).status).toBe(
      200,
    );
    await post(
      await ctx.tokenFor(other.teacher.cognitoId),
      `/v1/sessions/${other.session.id}/end`,
      {},
    );
    refusals.push({
      res: await change(other.token, other.session.id, 'protection-off', ranReport),
      message: 'session has ended',
    });
    refusals.push({
      res: await change(other.token, other.session.id, 'refocus'),
      message: 'session has ended',
    });

    for (const { res, message } of refusals) {
      expect(res.status, message).toBe(409);
      expect(res.body.error?.message).toBe(message);
      expect(res.disposition, message).toBe('drop');
    }

    const unknown = await change(token, randomUUID(), 'refocus');
    expect(unknown.status).toBe(404);
    expect(unknown.disposition).toBe('drop');

    const malformed = await post(token, `/v1/sessions/${session.id}/protection-off`, {
      eventId: 'not-a-uuid',
      deviceTime: now(),
    });
    expect(malformed.status).toBe(400);
    expect(stateChangeDisposition(malformed.status, malformed.body)).toBe('drop');

    const res = await ctx.app.inject({
      method: 'POST',
      url: `/v1/sessions/${session.id}/refocus`,
      payload: { eventId: randomUUID(), deviceTime: now() },
    });
    expect(res.statusCode).toBe(401);
    expect(stateChangeDisposition(res.statusCode, res.json<Answer>())).toBe('reauth');
  });

  it('a refused refocus is final for its id: the server keeps no trace, so a resend would land as new', async () => {
    // Why the table drops a refusal instead of retrying it (A2's entry, from
    // #54's review): the refused refocus records nothing, so after a re-tap
    // and a fresh unlock the same id is applied as new — green over a phone
    // the student just unlocked.
    const { block, session, token } = await running('oc-sc-final');
    expect((await change(token, session.id, 'protection-off')).status).toBe(200);
    const refocusId = randomUUID();
    const refused = await change(token, session.id, 'refocus', refocusId);
    expect(refused.status).toBe(409);
    expect(refused.disposition).toBe('drop');

    expect((await tap(token, block.tagId)).body).toMatchObject({ state: 'focused' });
    await unlock(token, session.id);

    const resent = await change(token, session.id, 'refocus', refocusId);
    expect(resent.body).toMatchObject({ outcome: 'applied', state: 'focused' });
  });

  it('the refocus replay A4 settles: after a removal it still names the running session', async () => {
    // Pre-existing (A2's entry): a refocus replayed after its participation
    // ended while the session runs answers that ended row's last state with
    // the session, which the table reads as 'apply_session'. The outbox's
    // superseded-refocus rule covers a switch (a later tap), not a removal,
    // so A4 settles this on the server before a phone ships — and this
    // assertion is the one it changes.
    const { klass, student, session, token } = await running('oc-sc-a4');
    await unlock(token, session.id);
    const refocusId = randomUUID();
    expect((await change(token, session.id, 'refocus', refocusId)).status).toBe(200);
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

    const replay = await change(token, session.id, 'refocus', refocusId);
    expect(replay.body).toMatchObject({ outcome: 'replay', state: 'focused' });
    expect(replay.body.session?.id).toBe(session.id);
    expect(replay.disposition).toBe('apply_session');
  });
});
