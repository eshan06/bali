import { type Database, endSession, events, refocus, startSession, tapIn, unlock } from '@bali/db';
import type {
  ApiErrorBody,
  EventsPage,
  HistoryPage,
  SessionSnapshot,
  UnlockReasonResponse,
} from '@bali/shared';
import { and, eq } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { authedInject, makeAuthedApp, type AuthedApp } from './helpers/app.js';
import { makeTestDb, seedClassroom } from './helpers/db.js';

/*
 * PATCH /v1/unlocks/{eventId} (A20): the student changes the reason of their
 * own unlock, and the teacher sees the latest — on the grid's snapshot and its
 * stream, and in the student's own history. The engine's rules are pinned in
 * packages/db/test/unlock-reason.test.ts; this is the wire: the answer, the
 * refusals and their reasons, authorization, validation, and the replay.
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

/** A student tapped in to a running lesson, then unlocked with `reason`. */
async function unlocked(tag: string, reason: 'bathroom' | null = 'bathroom') {
  const c = await seedClassroom(db, tag);
  const { session } = await startSession(db, {
    classId: c.klass.id,
    startedAt: new Date(Date.now() - 60_000),
    endsAt: new Date(Date.now() + 25 * 60_000),
  });
  const act = () => ({
    sessionId: session.id,
    studentId: c.student.id,
    eventId: randomUUID(),
    deviceTime: new Date(),
  });
  await tapIn(db, act());
  const unlockId = randomUUID();
  await unlock(db, { ...act(), eventId: unlockId, reason });
  return { ...c, session, unlockId, act, token: await ctx.tokenFor(c.student.cognitoId) };
}

async function patch(token: string | null, unlockId: string, body: object) {
  const res = await ctx.app.inject({
    method: 'PATCH',
    url: `/v1/unlocks/${unlockId}`,
    headers: token === null ? {} : { authorization: `Bearer ${token}` },
    payload: body,
  });
  return { status: res.statusCode, body: res.json<UnlockReasonResponse & ApiErrorBody>() };
}

const changesIn = (sessionId: string) =>
  db
    .select()
    .from(events)
    .where(and(eq(events.sessionId, sessionId), eq(events.type, 'unlock_reason_changed')));

describe('PATCH /v1/unlocks/:eventId', () => {
  it('changes the caller’s unlock’s reason: the grid, its stream and the history read the latest', async () => {
    const { teacher, session, unlockId, token } = await unlocked('reason-wire');

    const res = await patch(token, unlockId, { reason: 'nurse', eventId: randomUUID() });
    expect(res).toEqual({ status: 200, body: { outcome: 'applied', reason: 'nurse' } });

    const teacherToken = await ctx.tokenFor(teacher.cognitoId);
    const snap = await authedInject(ctx.app, teacherToken, {
      method: 'GET',
      url: `/v1/sessions/${session.id}`,
    });
    expect(snap.json<SessionSnapshot>().students[0]?.unlock).toMatchObject({
      eventId: unlockId,
      reason: 'nurse',
    });
    const feed = await authedInject(ctx.app, teacherToken, {
      method: 'GET',
      url: `/v1/sessions/${session.id}/events?after=0`,
    });
    const streamed = feed.json<EventsPage>().events.find((e) => e.type === 'unlock_reason_changed');
    expect(streamed?.payload).toEqual({ unlock_event_id: unlockId, reason: 'nurse' });
    const history = await authedInject(ctx.app, token, { method: 'GET', url: '/v1/me/history' });
    const moment = history.json<HistoryPage>().events.find((e) => e.eventId === unlockId);
    expect(moment?.reason).toBe('nurse');
  });

  it('answers a retry as its replay, with the reason now', async () => {
    const { session, unlockId, token } = await unlocked('reason-wire-replay');
    const first = { reason: 'nurse', eventId: randomUUID() };
    await patch(token, unlockId, first);
    await patch(token, unlockId, { reason: 'other', eventId: randomUUID() });

    const retried = await patch(token, unlockId, first);
    expect(retried).toEqual({ status: 200, body: { outcome: 'replay', reason: 'other' } });
    expect(await changesIn(session.id)).toHaveLength(2);
  });

  it('names only the caller’s own unlock: anyone else’s is not found, and no token is a 401', async () => {
    const { teacher, session, unlockId } = await unlocked('reason-wire-authz');
    const stranger = await unlocked('reason-wire-authz-other');
    const body = { reason: 'nurse', eventId: randomUUID() };

    for (const as of [stranger.token, await ctx.tokenFor(teacher.cognitoId)]) {
      const res = await patch(as, unlockId, body);
      expect(res.status).toBe(404);
      expect(res.body.error).toMatchObject({ code: 'not_found', reason: 'unlock_not_found' });
    }
    const unknown = await patch(stranger.token, randomUUID(), body);
    expect(unknown.body.error?.reason).toBe('unlock_not_found');
    expect((await patch(null, unlockId, body)).status).toBe(401);
    expect(await changesIn(session.id)).toHaveLength(0);
  });

  it('refuses a reason it does not know, a malformed id and a body with none, recording nothing', async () => {
    const { session, unlockId, token } = await unlocked('reason-wire-input');
    for (const [id, body] of [
      [unlockId, { reason: 'skateboard', eventId: randomUUID() }],
      [unlockId, { reason: null, eventId: randomUUID() }],
      [unlockId, { reason: 'nurse', eventId: 'x' }],
      [unlockId, { reason: 'nurse' }],
      ['not-a-uuid', { reason: 'nurse', eventId: randomUUID() }],
    ] as const) {
      const res = await patch(token, id, body);
      expect(res.status, JSON.stringify(body)).toBe(400);
      expect(res.body.error?.code).toBe('bad_input');
    }
    expect(await changesIn(session.id)).toHaveLength(0);
  });

  it('refuses an unlock a return to focus ended, and one once the class is over, with their reasons', async () => {
    const back = await unlocked('reason-wire-over');
    await refocus(db, back.act());
    const superseded = await patch(back.token, back.unlockId, {
      reason: 'nurse',
      eventId: randomUUID(),
    });
    expect(superseded.status).toBe(409);
    expect(superseded.body.error?.reason).toBe('unlock_superseded');

    const ended = await unlocked('reason-wire-ended');
    await endSession(db, { sessionId: ended.session.id, at: new Date(), reason: 'ended' });
    const over = await patch(ended.token, ended.unlockId, {
      reason: 'nurse',
      eventId: randomUUID(),
    });
    expect(over.status).toBe(409);
    expect(over.body.error?.reason).toBe('session_not_running');
    expect(await changesIn(back.session.id)).toHaveLength(0);
    expect(await changesIn(ended.session.id)).toHaveLength(0);
  });

  it('refuses an id another event holds', async () => {
    const { unlockId, token } = await unlocked('reason-wire-conflict');
    const res = await patch(token, unlockId, { reason: 'nurse', eventId: unlockId });
    expect(res.status).toBe(409);
    expect(res.body.error?.reason).toBe('event_id_conflict');
  });
});
