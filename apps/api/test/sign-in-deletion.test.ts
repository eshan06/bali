import { cognitoDeletions, type Database, queueCognitoDeletion, users } from '@bali/db';
import type { DeleteMeResponse } from '@bali/shared';
import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import { Writable } from 'node:stream';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { buildApp } from '../src/app.js';
import { createVerifier } from '../src/auth/verify.js';
import type { Env } from '../src/env.js';
import { captureFailure } from '../src/monitoring.js';
import { makeTestDb, seedClassroom } from './helpers/db.js';
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

const cognitoFetch = ((_url: string, init: { headers: Record<string, string>; body: string }) => {
  const action = init.headers['x-amz-target']!.replace('AWSCognitoIdentityProviderService.', '');
  const { Username: username } = JSON.parse(init.body) as { Username: string };
  calls.push({ action, username });
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
}) as unknown as typeof fetch;

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

const queue = () => db.select().from(cognitoDeletions);
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
    expect((await deleteMe(student.cognitoId, 'Google_4004')).json<DeleteMeResponse>()).toEqual({
      outcome: 'already_deleted',
    });
    await settle();

    expect(calls.filter((call) => call.action === 'AdminDeleteUser')).toHaveLength(1);
    expect(pool.size).toBe(0);
    expect(await queue()).toEqual([]);
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
