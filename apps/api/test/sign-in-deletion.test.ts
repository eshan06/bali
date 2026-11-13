import {
  cognitoDeletions,
  type Database,
  enrollments,
  findUserByCognitoId,
  parseSchoolCommand,
  queueCognitoDeletion,
  schools,
  SIGN_IN_MARK_MS,
  users,
} from '@bali/db';
import type { ApiErrorBody, DeleteMeResponse, MeResponse } from '@bali/shared';
import { and, eq, isNotNull, isNull } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import { Writable } from 'node:stream';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { buildApp } from '../src/app.js';
import { createVerifier } from '../src/auth/verify.js';
import type { Env } from '../src/env.js';
import { captureFailure } from '../src/monitoring.js';
import { joinCodeFor, makeTestDb, seedClassroom } from './helpers/db.js';
import { testEnv } from './helpers/env.js';
import { makeTestIssuer, TEST_AUDIENCE, type TestIssuer } from './helpers/test-issuer.js';

vi.mock('../src/monitoring.js', async (actual) => ({
  ...(await actual<typeof import('../src/monitoring.js')>()),
  captureFailure: vi.fn(),
}));

/*
 * A deleted account's Cognito sign-in, deleted by the API (the owner's decision, 2026-10-09):
 * queued with the deletion, tried once after it commits, retried by the sweep, and never another
 * sign-in that has its username now. Cognito is a fake pool behind the injected fetch.
 */

const POOL = 'https://cognito-idp.us-east-1.amazonaws.com/us-east-1_testpool';
const KEY = {
  COGNITO_DELETER_ACCESS_KEY_ID: 'AKIAIOSFODNN7EXAMPLE',
  COGNITO_DELETER_SECRET_ACCESS_KEY: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
};
const deleterOff: Env = { ...testEnv, LOG_LEVEL: 'info', AUTH_ISSUER: POOL };
const deleterOn: Env = { ...deleterOff, ...KEY };
const MIN = 60_000;

let db: Database;
let closeDb: () => Promise<void>;
let issuer: TestIssuer;
let app: FastifyInstance;
let lines: string[];
/** The fake pool: each username's sub. */
let pool: Map<string, string>;
let calls: { action: string; username: string }[];
/** How Cognito answers every call, while set: a refusal's type, or `network`, a failed fetch. */
let failing: string | undefined;
/** Cognito's next call of one action, held unanswered while set (`hold`). */
let held: { action: string; reached: () => void; answered: Promise<void> } | undefined;

const cognitoFetch = ((_url: string, init: { headers: Record<string, string>; body: string }) => {
  const action = init.headers['x-amz-target']!.replace('AWSCognitoIdentityProviderService.', '');
  const { Username: username } = JSON.parse(init.body) as { Username: string };
  calls.push({ action, username });
  if (held?.action !== action) return answer(action, username);
  const { reached, answered } = held;
  held = undefined;
  reached();
  return answered.then(() => answer(action, username));
}) as unknown as typeof fetch;

/** The fake pool's answer to one call, and what the call does there. */
function answer(action: string, username: string): Promise<Response> {
  if (failing === 'network') return Promise.reject(new TypeError('fetch failed'));
  if (failing) return Promise.resolve(Response.json({ __type: failing }, { status: 400 }));
  const sub = pool.get(username);
  if (sub === undefined) {
    return Promise.resolve(Response.json({ __type: 'UserNotFoundException' }, { status: 400 }));
  }
  if (action === 'AdminGetUser') {
    return Promise.resolve(Response.json({ UserAttributes: [{ Name: 'sub', Value: sub }] }));
  }
  pool.delete(username);
  return Promise.resolve(new Response('', { status: 200 }));
}

/**
 * Holds Cognito's next `action` call: `made` once a try makes it, and the call answered (and done
 * in the pool) only once `release()` is called. The try waits there, between its claim and its
 * finish, for as long as the test needs: no window of time.
 */
function hold(action: string) {
  let release!: () => void;
  const answered = new Promise<void>((resolve) => {
    release = resolve;
  });
  let reached!: () => void;
  const made = new Promise<void>((resolve) => {
    reached = resolve;
  });
  held = { action, reached, answered };
  return { made, release };
}

function build(env: Env, clock?: () => Date): FastifyInstance {
  const logStream = new Writable({
    write(chunk: Buffer, _encoding, done) {
      lines.push(chunk.toString());
      done();
    },
  });
  const verifyToken = createVerifier({
    issuer: POOL,
    clientIds: [TEST_AUDIENCE],
    getKey: issuer.getKey,
  });
  return buildApp(env, { db, verifyToken, logStream, cognitoFetch, clock });
}

beforeEach(async () => {
  ({ db, close: closeDb } = await makeTestDb());
  issuer = await makeTestIssuer();
  lines = [];
  pool = new Map();
  calls = [];
  failing = undefined;
  held = undefined;
  vi.mocked(captureFailure).mockClear();
  app = build(deleterOn);
});

afterEach(async () => {
  await app.close();
  await closeDb();
});

/** DELETE /v1/me from the sign-in `sub`, its access token naming `username` as Cognito's do. */
async function deleteMe(sub: string, username?: string) {
  const token = await issuer.sign({
    sub,
    issuer: POOL,
    ...(username === undefined ? {} : { extraClaims: { username } }),
  });
  return app.inject({
    method: 'DELETE',
    url: '/v1/me',
    headers: { authorization: `Bearer ${token}` },
    payload: { eventId: randomUUID() },
  });
}

/** Wait out the tries the requests started: app.close() drains them, as shutdown does. */
async function settle(next: Env = deleterOn, clock?: () => Date) {
  await app.close();
  app = build(next, clock);
}

/** The rows still queued for a try. */
const queue = () => db.select().from(cognitoDeletions).where(isNull(cognitoDeletions.finishedAt));
/** The rows whose try finished, kept as their sign-in's mark for a day (C3d). */
const marks = () =>
  db.select().from(cognitoDeletions).where(isNotNull(cognitoDeletions.finishedAt));
/** An `auth_time` just after now: a sign-in made after anything this test did so far (C3d). */
const secondsAfterNow = () => Math.floor(Date.now() / 1000) + 1;
const log = () => lines.join('');
const logged = (msg: string) =>
  lines.map((line) => JSON.parse(line) as Record<string, unknown>).filter((l) => l.msg === msg);

describe('a deleted account’s Cognito sign-in (2026-10-09)', () => {
  it('is deleted once the deletion commits: read, then deleted, by the token’s username', async () => {
    const { student } = await seedClassroom(db, 'gone-now');
    pool.set('Google_1001', student.cognitoId);

    const res = await deleteMe(student.cognitoId, 'Google_1001');
    expect(res.json<DeleteMeResponse>()).toEqual({ outcome: 'deleted' });
    await settle();

    expect(calls).toEqual([
      { action: 'AdminGetUser', username: 'Google_1001' },
      { action: 'AdminDeleteUser', username: 'Google_1001' },
    ]);
    expect(pool.has('Google_1001')).toBe(false);
    expect(await queue()).toEqual([]);
    // Kept as the sign-in's mark (C3d), with nothing the deleter needed but its pool and sub.
    expect(await marks()).toMatchObject([
      {
        issuer: POOL,
        sub: student.cognitoId,
        username: null,
        finishedAt: expect.any(Date) as Date,
      },
    ]);
    expect(logged('Cognito sign-in deletion done')).toMatchObject([
      { outcome: 'deleted', attempts: 1 },
    ]);
    // No log line names the person: a row is named by its own id.
    expect(log()).not.toContain('Google_1001');
    expect(log()).not.toContain(student.cognitoId);
  });

  it('is never a sign-in its username names now under another sub: that one stays', async () => {
    // A Google sign-in's username comes back when its person signs up again, with a new sub.
    const { student } = await seedClassroom(db, 'reborn');
    pool.set('Google_2002', 'a-new-sign-in');

    await deleteMe(student.cognitoId, 'Google_2002');
    await settle();

    expect(calls).toEqual([{ action: 'AdminGetUser', username: 'Google_2002' }]);
    expect(pool.get('Google_2002')).toBe('a-new-sign-in');
    expect(await queue()).toEqual([]);
    expect(logged('Cognito sign-in deletion done')).toMatchObject([{ outcome: 'not_theirs' }]);
  });

  it('is done when it is gone already: the phone’s own DeleteUser got there first', async () => {
    const { student } = await seedClassroom(db, 'phone-first');

    await deleteMe(student.cognitoId, 'Google_3003');
    await settle();

    expect(calls).toEqual([{ action: 'AdminGetUser', username: 'Google_3003' }]);
    expect(await queue()).toEqual([]);
    expect(logged('Cognito sign-in deletion done')).toMatchObject([{ outcome: 'gone' }]);
  });

  it('goes for a sign-in with no account here too, and no account is made (C7’s under-13 fallback)', async () => {
    // A token naming no username (no pool's does) is deleted by its sub.
    pool.set('never-called', 'never-called');
    const before = await db.select().from(users);

    const res = await deleteMe('never-called');
    expect(res.json<DeleteMeResponse>()).toEqual({ outcome: 'already_deleted' });
    await settle();

    expect(pool.size).toBe(0);
    expect(await db.select().from(users)).toEqual(before);
    expect(await queue()).toEqual([]);
  });

  it('is deleted once, however often the deletion is sent', async () => {
    const { student } = await seedClassroom(db, 'twice');
    pool.set('Google_4004', student.cognitoId);

    expect((await deleteMe(student.cognitoId, 'Google_4004')).json<DeleteMeResponse>()).toEqual({
      outcome: 'deleted',
    });
    // The retry once the first try is done; one sent while that try is at Cognito is the next case.
    await settle();
    expect((await deleteMe(student.cognitoId, 'Google_4004')).json<DeleteMeResponse>()).toEqual({
      outcome: 'already_deleted',
    });
    await settle();

    expect(calls.filter((call) => call.action === 'AdminDeleteUser')).toHaveLength(1);
    expect(pool.size).toBe(0);
    expect(await queue()).toEqual([]);
    // The retry queued the finished row anew (C3d), and its own try found the sign-in gone.
    const outcomes = logged('Cognito sign-in deletion done').map((line) => line.outcome);
    expect(outcomes).toEqual(['deleted', 'gone']);
  });

  it('is deleted once when the deletion is sent again while its first try is at Cognito', async () => {
    // A lost answer's retry, landing between the first try's claim and its finish: that try held
    // at Cognito, its delete on its way (the flake on main's CI, 2026-11-12).
    const at = new Date('2026-10-09T15:30:00Z');
    let now = at;
    await settle(deleterOn, () => now);
    const { student } = await seedClassroom(db, 'twice-at-once');
    pool.set('Google_4014', student.cognitoId);
    const deletion = hold('AdminDeleteUser');
    const retried = new Date(at.getTime() + 1_000);

    // Let go whatever fails here, so a failing case never leaves the first try held.
    try {
      expect((await deleteMe(student.cognitoId, 'Google_4014')).json<DeleteMeResponse>()).toEqual({
        outcome: 'deleted',
      });
      await deletion.made;
      now = retried;
      expect((await deleteMe(student.cognitoId, 'Google_4014')).json<DeleteMeResponse>()).toEqual({
        outcome: 'already_deleted',
      });
    } finally {
      deletion.release();
    }
    await settle(deleterOn, () => now);

    // Deleted once, at once. The retry's deletion, queued since the claim, keeps the row for a try
    // of its own (C3d), due when the claim put the next try off: a minute on, its username kept.
    expect(calls.filter((call) => call.action === 'AdminDeleteUser')).toHaveLength(1);
    expect(pool.size).toBe(0);
    const due = new Date(at.getTime() + MIN);
    expect(await queue()).toMatchObject([
      { attempts: 1, deletedAt: retried, nextAttemptAt: due, username: 'Google_4014' },
    ]);
    calls = [];
    await app.sweep(new Date(due.getTime() - 1));
    expect(calls).toEqual([]);

    // That try finds the sign-in gone, and finishes the row.
    now = due;
    await app.sweep(due);
    expect(calls).toEqual([{ action: 'AdminGetUser', username: 'Google_4014' }]);
    expect(await queue()).toEqual([]);
    expect(await marks()).toMatchObject([{ username: null, deletedAt: retried, finishedAt: due }]);
    const outcomes = logged('Cognito sign-in deletion done').map((line) => [
      line.outcome,
      line.attempts,
    ]);
    expect(outcomes).toEqual([
      ['deleted', 1],
      ['gone', 2],
    ]);
  });

  it('is never deleted once its person came back: a live account holds it again, and the row is done', async () => {
    // Deleted while the key is unset: the row waits.
    await settle(deleterOff);
    const { student } = await seedClassroom(db, 'came-back');
    pool.set('Google_9009', student.cognitoId);
    expect((await deleteMe(student.cognitoId, 'Google_9009')).statusCode).toBe(200);
    await settle(deleterOff);
    expect(await queue()).toHaveLength(1);
    // Its own tokens make no account (C3d): one signed in before the deletion, or saying no time.
    const old = await issuer.sign({ sub: student.cognitoId, issuer: POOL });
    const refused = await app.inject({
      method: 'GET',
      url: '/v1/me',
      headers: { authorization: `Bearer ${old}` },
    });
    expect(refused.statusCode).toBe(409);

    // The phone's own DeleteUser never landed (a reinstall): the same sign-in comes back, signed in
    // after the deletion (C3d), and its first call makes it a new account.
    const token = await issuer.sign({
      sub: student.cognitoId,
      issuer: POOL,
      extraClaims: { username: 'Google_9009', auth_time: secondsAfterNow() },
    });
    const me = await app.inject({
      method: 'GET',
      url: '/v1/me',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(me.json<MeResponse>().user.id).not.toBe(student.id);

    // The key set, the queued deletion runs: the login stays, and the row is done.
    await settle(deleterOn);
    await app.sweep();

    expect(calls).toEqual([]);
    expect(pool.get('Google_9009')).toBe(student.cognitoId);
    expect(await queue()).toEqual([]);
    expect(logged('Cognito sign-in deletion done')).toMatchObject([{ outcome: 'came_back' }]);
  });

  it('is not queued for a deletion refused, and Cognito is never called', async () => {
    const { teacher } = await seedClassroom(db, 'refused');
    pool.set(teacher.cognitoId, teacher.cognitoId);

    expect((await deleteMe(teacher.cognitoId)).statusCode).toBe(409);
    await settle();

    expect(calls).toEqual([]);
    expect(pool.size).toBe(1);
    expect(await queue()).toEqual([]);
  });
});

describe('a deleted sign-in’s old token, refused on the server (C3d; the owner, 2026-11-11: “Now, on the server”)', () => {
  // Deleted on prod's terms: the key unset, so the sign-in waits in the queue, its tokens still
  // valid. The tokens here were signed in a minute before the deletion: a second phone's, or the
  // student web left open.
  const at = new Date('2026-10-09T17:00:00Z');
  const signedInBefore = Math.floor(at.getTime() / 1000) - 60;
  const as = (token: string) => ({ authorization: `Bearer ${token}` });

  /** A student of the class `tag`, deleted at `at` under a token of theirs: that token, kept. */
  async function deleted(tag: string, username: string, env = deleterOff) {
    await settle(env, () => at);
    const seeded = await seedClassroom(db, tag);
    pool.set(username, seeded.student.cognitoId);
    const old = await issuer.sign({
      sub: seeded.student.cognitoId,
      issuer: POOL,
      extraClaims: { username, auth_time: signedInBefore },
    });
    const deletion = await app.inject({
      method: 'DELETE',
      url: '/v1/me',
      headers: as(old),
      payload: { eventId: randomUUID() },
    });
    expect(deletion.json<DeleteMeResponse>()).toEqual({ outcome: 'deleted' });
    return { ...seeded, old, users: await db.select().from(users) };
  }

  it('GET /v1/me makes no account under it, so nothing is named from its claims: 409 account_deleted', async () => {
    const { old, users: before } = await deleted('old-me', 'demo-ana@example.test');

    const res = await app.inject({ method: 'GET', url: '/v1/me', headers: as(old) });

    expect(res.statusCode).toBe(409);
    expect(res.json<ApiErrorBody>().error).toMatchObject({
      code: 'conflict',
      reason: 'account_deleted',
    });
    expect(await db.select().from(users)).toEqual(before);
  });

  it('a join makes no account under it, and the class’s roster names no one new: 409 account_deleted', async () => {
    const { old, klass, users: before } = await deleted('old-join', 'Google_1102');

    const res = await app.inject({
      method: 'POST',
      url: '/v1/enrollments',
      headers: as(old),
      payload: { joinCode: joinCodeFor('old-join'), eventId: randomUUID(), deviceTime: at },
    });

    expect(res.statusCode).toBe(409);
    expect(res.json<ApiErrorBody>().error).toMatchObject({ reason: 'account_deleted' });
    expect(await db.select().from(users)).toEqual(before);
    const roster = await db
      .select()
      .from(enrollments)
      .where(and(eq(enrollments.classId, klass.id), isNull(enrollments.removedAt)));
    expect(roster).toEqual([]);
  });

  it('its sign-in goes at the sweep, never kept as come back: no account holds it', async () => {
    const { old } = await deleted('old-sweep', 'Google_1103');
    await app.inject({ method: 'GET', url: '/v1/me', headers: as(old) });

    // The key set, the queued deletion runs.
    await settle(deleterOn, () => at);
    await app.sweep(at);

    expect(pool.has('Google_1103')).toBe(false);
    expect(logged('Cognito sign-in deletion done')).toMatchObject([{ outcome: 'deleted' }]);
  });

  it('records an Emergency Unlock under it, making no account, and its sign-in still goes at the sweep', async () => {
    const { old, student } = await deleted('old-unlock', 'Google_1104');

    const unlock = await app.inject({
      method: 'POST',
      url: `/v1/sessions/${randomUUID()}/unlock`,
      headers: as(old),
      payload: { eventId: randomUUID(), deviceTime: at },
    });

    expect(unlock.json()).toMatchObject({ outcome: 'recorded', recordedAs: 'unknown_session' });
    expect(await findUserByCognitoId(db, student.cognitoId)).toBeUndefined();
    await settle(deleterOn, () => at);
    await app.sweep(at);
    expect(pool.has('Google_1104')).toBe(false);
    expect(logged('Cognito sign-in deletion done')).toMatchObject([{ outcome: 'deleted' }]);
  });

  it('keeps the mark a day once the try finishes, its username dropped, then the sweep forgets it', async () => {
    const { old } = await deleted('old-mark', 'Google_1105', deleterOn);
    await settle(deleterOn, () => at);
    expect(pool.has('Google_1105')).toBe(false);
    expect(await queue()).toEqual([]);
    expect(await marks()).toMatchObject([{ username: null, finishedAt: at }]);

    await app.sweep(new Date(at.getTime() + SIGN_IN_MARK_MS - 1));
    expect(await marks()).toHaveLength(1);
    const me = await app.inject({ method: 'GET', url: '/v1/me', headers: as(old) });
    expect(me.statusCode).toBe(409);

    await app.sweep(new Date(at.getTime() + SIGN_IN_MARK_MS));
    expect(await marks()).toEqual([]);
  });

  it('queues the sign-in anew when its person came back and deleted that account too: then it goes, and its tokens since are refused', async () => {
    const { student } = await deleted('again', 'Google_1106');
    const back = await issuer.sign({
      sub: student.cognitoId,
      issuer: POOL,
      extraClaims: { username: 'Google_1106', auth_time: signedInBefore + 2 * 60 },
    });
    const me = () => app.inject({ method: 'GET', url: '/v1/me', headers: as(back) });
    expect((await me()).statusCode).toBe(200);
    await settle(deleterOn, () => at);
    await app.sweep(at);
    expect(pool.has('Google_1106')).toBe(true);

    // That account deleted too, two minutes on.
    const later = new Date(at.getTime() + 2 * MIN);
    await settle(deleterOn, () => later);
    const again = await app.inject({
      method: 'DELETE',
      url: '/v1/me',
      headers: as(back),
      payload: { eventId: randomUUID() },
    });
    expect(again.json<DeleteMeResponse>()).toEqual({ outcome: 'deleted' });
    await settle(deleterOn, () => later);

    expect(pool.has('Google_1106')).toBe(false);
    const outcomes = logged('Cognito sign-in deletion done').map((line) => line.outcome);
    expect(outcomes).toEqual(['came_back', 'deleted']);
    expect((await me()).statusCode).toBe(409);
  });
});

describe('the sign-ins a retention run de-identifies (2026-10-28)', () => {
  it('are deleted by the sweep, each by the sub it held, but one whose person came back since; a kept one is never touched', async () => {
    // A school whose year ended in 2020: each teacher, with a live class and block, stays named;
    // their students, with no record since, are de-identified.
    const ana = await seedClassroom(db, 'retain-ana');
    const ben = await seedClassroom(db, 'retain-ben', ana.school);
    await db
      .update(schools)
      .set({ schoolYearEndsOn: '2020-06-01' })
      .where(eq(schools.id, ana.school.id));
    const inTheYear = new Date('2020-01-01');
    for (const { student } of [ana, ben]) {
      await db.update(users).set({ createdAt: inTheYear }).where(eq(users.id, student.id));
      await db
        .update(enrollments)
        .set({ createdAt: inTheYear })
        .where(eq(enrollments.studentId, student.id));
    }
    // Email sign-ins: Cognito makes each one's username its sub.
    for (const { cognitoId } of [ana.student, ben.student, ana.teacher])
      pool.set(cognitoId, cognitoId);

    // The owner's run, in the API service's shell: this deploy's pool is its AUTH_ISSUER.
    const run = parseSchoolCommand(['retention', ana.school.id, '--confirm', ana.school.name]);
    await run!({ db, print: () => undefined, issuer: POOL });

    // Ben signs in again before the sweep, after the run (C3d): his first call makes him a new
    // account, so the sign-in is his to keep.
    const token = await issuer.sign({
      sub: ben.student.cognitoId,
      issuer: POOL,
      extraClaims: { auth_time: secondsAfterNow() },
    });
    const me = await app.inject({
      method: 'GET',
      url: '/v1/me',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(me.json<MeResponse>().user.id).not.toBe(ben.student.id);
    // Ana's token from before the run makes no account (C3d): the run's queue is its mark too.
    const anas = await issuer.sign({ sub: ana.student.cognitoId, issuer: POOL });
    const refused = await app.inject({
      method: 'GET',
      url: '/v1/me',
      headers: { authorization: `Bearer ${anas}` },
    });
    expect(refused.statusCode).toBe(409);

    await app.sweep();

    expect(calls).toEqual([
      { action: 'AdminGetUser', username: ana.student.cognitoId },
      { action: 'AdminDeleteUser', username: ana.student.cognitoId },
    ]);
    expect([...pool.keys()].sort()).toEqual([ben.student.cognitoId, ana.teacher.cognitoId].sort());
    expect(await queue()).toEqual([]);
    const outcomes = logged('Cognito sign-in deletion done').map((line) => line.outcome);
    expect(outcomes.sort()).toEqual(['came_back', 'deleted']);
    expect(log()).not.toContain(ana.student.cognitoId);
  });
});

describe('a try that fails', () => {
  it('keeps the row, and the sweep tries it again once due: a minute on, then two, never before', async () => {
    const at = new Date('2026-10-09T15:00:00Z');
    await settle(deleterOn, () => at);
    const { student } = await seedClassroom(db, 'retried');
    pool.set('Google_5005', student.cognitoId);
    failing = 'network';

    await deleteMe(student.cognitoId, 'Google_5005');
    await settle();
    expect(await queue()).toMatchObject([
      { attempts: 1, nextAttemptAt: new Date(at.getTime() + MIN) },
    ]);
    expect(logged('Cognito sign-in deletion failed; it is tried again later')).toHaveLength(1);

    // Not due yet: Cognito is not called.
    calls = [];
    await app.sweep(new Date(at.getTime() + MIN - 1));
    expect(calls).toEqual([]);

    failing = 'InternalErrorException';
    await app.sweep(new Date(at.getTime() + MIN));
    expect(await queue()).toMatchObject([
      { attempts: 2, nextAttemptAt: new Date(at.getTime() + 3 * MIN) },
    ]);

    failing = undefined;
    await app.sweep(new Date(at.getTime() + 3 * MIN));
    expect(pool.size).toBe(0);
    expect(await queue()).toEqual([]);
    expect(logged('Cognito sign-in deletion done')).toMatchObject([{ attempts: 3 }]);
  });

  it('is said at error and reported once it keeps failing, naming no one', async () => {
    const at = new Date('2026-10-09T16:00:00Z');
    await settle(deleterOn, () => at);
    const { student } = await seedClassroom(db, 'denied');
    pool.set('Google_6006', student.cognitoId);
    failing = 'AccessDeniedException';

    await deleteMe(student.cognitoId, 'Google_6006');
    await settle();
    await app.sweep(new Date(at.getTime() + MIN));
    expect(captureFailure).not.toHaveBeenCalled();
    await app.sweep(new Date(at.getTime() + 3 * MIN));

    // pino: warn is 40, error 50.
    const failures = logged('Cognito sign-in deletion failed; it is tried again later');
    expect(failures.map((line) => line.level)).toEqual([40, 40, 50]);
    for (const line of failures)
      expect(JSON.stringify(line.err)).toContain('AccessDeniedException');
    expect(captureFailure).toHaveBeenCalledTimes(1);
    expect(log()).not.toContain('Google_6006');
    expect(log()).not.toContain(student.cognitoId);
    expect(await queue()).toMatchObject([{ attempts: 3 }]);
  });
});

describe('with no key (the default)', () => {
  it('calls nothing and keeps the queue, says so once, and a deploy with the key deletes it', async () => {
    await settle(deleterOff);
    expect(
      logged(
        'Cognito sign-in deletion is off: COGNITO_DELETER_ACCESS_KEY_ID and COGNITO_DELETER_SECRET_ACCESS_KEY are unset, so deleted accounts’ sign-ins wait in the queue',
      ),
    ).toHaveLength(1);
    const { student } = await seedClassroom(db, 'off');
    pool.set('Google_7007', student.cognitoId);

    await deleteMe(student.cognitoId, 'Google_7007');
    await settle(deleterOff);
    await app.sweep();
    expect(calls).toEqual([]);
    expect(await queue()).toMatchObject([{ username: 'Google_7007', attempts: 0 }]);

    // The key set: the cron's backup sweep deletes it too.
    await settle(deleterOn);
    const swept = await app.inject({
      method: 'POST',
      url: '/internal/sweep',
      headers: { 'x-internal-key': testEnv.INTERNAL_API_KEY },
    });
    expect(swept.statusCode).toBe(200);
    expect(pool.size).toBe(0);
    expect(await queue()).toEqual([]);
  });

  it('tries only the rows of its own pool', async () => {
    const other = 'https://cognito-idp.us-east-1.amazonaws.com/us-east-1_otherpool';
    await queueCognitoDeletion(
      db,
      { issuer: other, username: 'u-8008', sub: 's-8008' },
      new Date(),
    );
    pool.set('u-8008', 's-8008');

    await app.sweep();

    expect(calls).toEqual([]);
    expect(
      await db.select().from(cognitoDeletions).where(eq(cognitoDeletions.issuer, other)),
    ).toMatchObject([{ attempts: 0 }]);
  });
});
