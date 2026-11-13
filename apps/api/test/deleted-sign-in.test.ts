import {
  cognitoDeletions,
  type Database,
  events,
  findUserByCognitoId,
  formatInviteCode,
  mintTeacherInvite,
  recordAgreement,
  startSession,
  users,
} from '@bali/db';
import type { ApiErrorBody, UnlockResponse } from '@bali/shared';
import { eq } from 'drizzle-orm';
import type { LightMyRequestResponse } from 'fastify';
import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { makeAuthedApp, type AuthedApp } from './helpers/app.js';
import { makeTestDb, seedClassroom } from './helpers/db.js';

/*
 * C3d (the owner, 2026-11-11: "Now, on the server"): once DELETE /v1/me commits, no request under a
 * token its sign-in issued before the deletion makes an account, by Cognito's `auth_time`, which a
 * refresh keeps. Each route that would make one answers 409 account_deleted with nothing made; an
 * Emergency Unlock is recorded under a row born removed; the reads keep their answers. A sign-in
 * made after the deletion is served as any first call is. The deleter's own half, and the
 * regression, are sign-in-deletion.test.ts's.
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

const nowSeconds = () => Math.floor(Date.now() / 1000);

/** A token of `sub`'s sign-in, made at `authTime` (seconds), told apart from its others by `jti`. */
const tokenOf = (sub: string, authTime: number, jti = randomUUID()) =>
  ctx.issuer.sign({ sub, extraClaims: { auth_time: authTime, jti } });

function send(token: string, request: Request): Promise<LightMyRequestResponse> {
  return ctx.app.inject({
    method: request.method,
    url: request.url,
    headers: { authorization: `Bearer ${token}` },
    ...(request.payload === undefined ? {} : { payload: request.payload }),
  });
}

interface Request {
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  url: string;
  payload?: object;
}

/**
 * Ana, a student in a running lesson, signed in a minute ago, who deletes her account under that
 * token: the token, still valid, a refresh of it, and the classroom's ids.
 */
async function deletedStudent(tag: string) {
  const room = await seedClassroom(db, tag);
  await recordAgreement(db, { schoolId: room.school.id, signedOn: '2026-09-30' });
  const minted = await mintTeacherInvite(db, { schoolId: room.school.id });
  if (minted.outcome !== 'minted') throw new Error('mint');
  const now = Date.now();
  const { session } = await startSession(db, {
    classId: room.klass.id,
    startedAt: new Date(now - 60_000),
    endsAt: new Date(now + 25 * 60_000),
  });
  const signedIn = nowSeconds() - 60;
  const old = await tokenOf(room.student.cognitoId, signedIn);
  // What she sent before the deletion, each answered: a tap into the lesson and a rename.
  const tapped: Request = {
    method: 'POST',
    url: '/v1/taps',
    payload: { tagId: room.block.tagId, ...stamped() },
  };
  expect((await send(old, tapped)).json()).toMatchObject({ outcome: 'joined' });
  const renamed: Request = {
    method: 'PATCH',
    url: '/v1/me',
    payload: { displayName: 'Ana', eventId: randomUUID() },
  };
  expect((await send(old, renamed)).json()).toMatchObject({ outcome: 'applied' });
  const deletion = await send(old, {
    method: 'DELETE',
    url: '/v1/me',
    payload: { eventId: randomUUID() },
  });
  expect(deletion.json()).toEqual({ outcome: 'deleted' });
  return {
    ...room,
    sessionId: session.id,
    old,
    refreshed: await tokenOf(room.student.cognitoId, signedIn),
    code: formatInviteCode(minted.code),
    sentBefore: [tapped, renamed],
  };
}

type World = Awaited<ReturnType<typeof deletedStudent>>;
function deviceTime() {
  return new Date().toISOString();
}
function stamped() {
  return { eventId: randomUUID(), deviceTime: deviceTime() };
}
/** The refusal's reason an answer carries, if it is one. */
const reasonOf = (res: LightMyRequestResponse) =>
  res.json<{ error?: { reason?: string } }>().error?.reason;

/** Every route that makes the caller's account by its first call, as each is sent. */
const MAKING: Record<string, (w: World) => Request> = {
  'GET /v1/me': () => ({ method: 'GET', url: '/v1/me' }),
  'PATCH /v1/me': () => ({
    method: 'PATCH',
    url: '/v1/me',
    payload: { displayName: 'Ana', eventId: randomUUID() },
  }),
  'PUT /v1/me/age-check': () => ({
    method: 'PUT',
    url: '/v1/me/age-check',
    payload: { eventId: randomUUID() },
  }),
  'PUT /v1/me/push-token': () => ({
    method: 'PUT',
    url: '/v1/me/push-token',
    payload: { token: 'ab'.repeat(32), environment: 'sandbox', eventId: randomUUID() },
  }),
  'POST /v1/taps': (w) => ({
    method: 'POST',
    url: '/v1/taps',
    payload: { tagId: w.block.tagId, ...stamped() },
  }),
  'POST /v1/enrollments': (w) => ({
    method: 'POST',
    url: '/v1/enrollments',
    payload: { joinCode: w.klass.joinCode, ...stamped() },
  }),
  'POST /v1/teacher-invites/redeem': (w) => ({
    method: 'POST',
    url: '/v1/teacher-invites/redeem',
    payload: { code: w.code, eventId: randomUUID() },
  }),
  'POST /v1/sessions/:id/checkin': (w) => ({
    method: 'POST',
    url: `/v1/sessions/${w.sessionId}/checkin`,
    payload: { deviceTime: deviceTime() },
  }),
  'POST /v1/sessions/:id/refocus': (w) => ({
    method: 'POST',
    url: `/v1/sessions/${w.sessionId}/refocus`,
    payload: stamped(),
  }),
  'POST /v1/sessions/:id/protection-off': (w) => ({
    method: 'POST',
    url: `/v1/sessions/${w.sessionId}/protection-off`,
    payload: stamped(),
  }),
  'POST /v1/sessions/:id/protection-on': (w) => ({
    method: 'POST',
    url: `/v1/sessions/${w.sessionId}/protection-on`,
    payload: stamped(),
  }),
};

const accountDeleted = (res: LightMyRequestResponse) => {
  expect(res.statusCode).toBe(409);
  expect(res.json<ApiErrorBody>().error).toEqual({
    code: 'conflict',
    reason: 'account_deleted',
    message: 'this account was deleted',
  });
};

describe.each(Object.entries(MAKING))(
  '%s under a deleted sign-in’s old token (C3d)',
  (_, request) => {
    it('is 409 account_deleted, a refreshed token’s too, and makes no account', async () => {
      const w = await deletedStudent('c3d-route');
      const before = await db.select().from(users).orderBy(users.id);

      accountDeleted(await send(w.old, request(w)));
      accountDeleted(await send(w.refreshed, request(w)));

      expect(await db.select().from(users).orderBy(users.id)).toEqual(before);
      expect(await findUserByCognitoId(db, w.student.cognitoId)).toBeUndefined();
    });

    it('serves a sign-in made after the deletion, which makes its account as any first call does', async () => {
      const w = await deletedStudent('c3d-back');
      const back = await tokenOf(w.student.cognitoId, nowSeconds() + 1);

      const res = await send(back, request(w));

      expect(reasonOf(res)).not.toBe('account_deleted');
      const account = await findUserByCognitoId(db, w.student.cognitoId);
      expect(account).toMatchObject({ removedAt: null });
      expect(account?.id).not.toBe(w.student.id);
    });

    it('leaves other sign-ins as they were: a classmate signed in before it is served', async () => {
      const w = await deletedStudent('c3d-other');
      const classmate = await tokenOf(`classmate-${randomUUID()}`, nowSeconds() - 60);

      const res = await send(classmate, request(w));

      expect(reasonOf(res)).not.toBe('account_deleted');
    });
  },
);

describe('under a deleted sign-in’s old token, what is never account_deleted (C3d)', () => {
  it('checks a request first: a malformed one is still the 400 it was', async () => {
    const w = await deletedStudent('c3d-input');
    for (const [name, request] of Object.entries(MAKING)) {
      const sent = request(w);
      if (sent.payload === undefined) continue;
      const res = await send(w.old, { ...sent, payload: {} });
      expect(res.statusCode, name).toBe(400);
    }
  });

  it('answers the replay of what it sent before the deletion 409 account_deleted, naming nothing of it', async () => {
    const w = await deletedStudent('c3d-replay');
    const before = await db.select().from(users).orderBy(users.id);

    // Each landed before the deletion, its answer lost: sent again under its own id.
    for (const sent of w.sentBefore) accountDeleted(await send(w.old, sent));

    expect(await db.select().from(users).orderBy(users.id)).toEqual(before);
  });

  it('records an Emergency Unlock, under a row born removed: no account made, and its retry a replay', async () => {
    const w = await deletedStudent('c3d-unlock');
    const before = await db.select().from(users);
    const unlock = { eventId: randomUUID(), deviceTime: deviceTime(), reason: 'nurse' };
    const underSession = {
      method: 'POST',
      url: `/v1/sessions/${w.sessionId}/unlock`,
      payload: unlock,
    } as const;
    const tapUnlock = { ...stamped(), reason: 'bathroom' };
    const underTap = {
      method: 'POST',
      url: `/v1/taps/${randomUUID()}/unlock`,
      payload: tapUnlock,
    } as const;

    const first = await send(w.old, underSession);
    expect(first.statusCode).toBe(200);
    expect(first.json<UnlockResponse>()).toMatchObject({
      outcome: 'recorded',
      recordedAs: 'not_enrolled',
      session: null,
      state: null,
    });
    expect((await send(w.refreshed, underSession)).json<UnlockResponse>()).toMatchObject({
      outcome: 'replay',
      reason: 'nurse',
    });
    expect((await send(w.old, underTap)).json<UnlockResponse>()).toMatchObject({
      outcome: 'recorded',
      recordedAs: 'unknown_tap',
    });
    expect((await send(w.old, underTap)).json<UnlockResponse>()).toMatchObject({
      outcome: 'replay',
    });

    // Two rows born removed, one an unlock, each nobody's; Ana's row holds neither unlock.
    expect(await findUserByCognitoId(db, w.student.cognitoId)).toBeUndefined();
    const after = await db.select().from(users);
    expect(after).toHaveLength(before.length + 2);
    for (const eventId of [unlock.eventId, tapUnlock.eventId]) {
      const [recorded] = await db.select().from(events).where(eq(events.eventId, eventId));
      expect(recorded?.userId).not.toBe(w.student.id);
      const born = after.find((u) => u.id === recorded?.userId);
      expect(born).toMatchObject({ displayName: null, cognitoId: `deleted:${born?.id}` });
      expect(born?.removedAt).toEqual(born?.createdAt);
    }
    // Malformed, it is the 400 it was, and makes nothing.
    const bad = await send(w.old, { ...underSession, payload: { eventId: randomUUID() } });
    expect(bad.statusCode).toBe(400);
    expect(await db.select().from(users)).toHaveLength(after.length);
  });

  it('answers a change of an unlock’s reason 404 unlock_not_found, and makes no account', async () => {
    const w = await deletedStudent('c3d-reason');
    const before = await db.select().from(users).orderBy(users.id);
    const url = `/v1/unlocks/${randomUUID()}`;

    const res = await send(w.old, {
      method: 'PATCH',
      url,
      payload: { reason: 'nurse', eventId: randomUUID() },
    });

    expect(res.statusCode).toBe(404);
    expect(res.json<ApiErrorBody>().error.reason).toBe('unlock_not_found');
    expect(await db.select().from(users).orderBy(users.id)).toEqual(before);
    expect((await send(w.old, { method: 'PATCH', url, payload: {} })).statusCode).toBe(400);
  });

  it('keeps the reads’ answers, and DELETE /v1/me’s retry, each making nothing', async () => {
    const w = await deletedStudent('c3d-reads');
    const before = await db.select().from(users).orderBy(users.id);

    const ageCheck = await send(w.old, { method: 'GET', url: '/v1/me/age-check' });
    expect(ageCheck.json()).toEqual({ passed: false });
    const history = await send(w.old, { method: 'GET', url: '/v1/me/history' });
    expect(history.json()).toEqual({ events: [], nextBefore: null });
    const retry = await send(w.refreshed, {
      method: 'DELETE',
      url: '/v1/me',
      payload: { eventId: randomUUID() },
    });
    expect(retry.json()).toEqual({ outcome: 'already_deleted' });

    expect(await db.select().from(users).orderBy(users.id)).toEqual(before);
    expect(await db.select().from(cognitoDeletions)).toHaveLength(1);
  });
});
