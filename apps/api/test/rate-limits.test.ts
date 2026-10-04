import { type Database, startSession, tapIn } from '@bali/db';
import { type UnlockResponse, unlockDisposition } from '@bali/shared';
import type { FastifyInstance, InjectOptions } from 'fastify';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { buildApp } from '../src/app.js';
import type { TokenVerifier } from '../src/auth/verify.js';
import { ApiError } from '../src/errors.js';
import { BUDGETS, type LimitOptions } from '../src/limits.js';
import { authedInject, makeAuthedApp } from './helpers/app.js';
import { makeTestDb, seedClassroom } from './helpers/db.js';
import { testEnv } from './helpers/env.js';
import { makeTestIssuer, type TestIssuer } from './helpers/test-issuer.js';

/*
 * The rate limits over HTTP (Phase 4 · L1, ISSUES #1): a budget per verified
 * account, never per address; one per address only where no one is signed in;
 * join codes' tries per account and a backstop on misses per address; a 429 in
 * the one error shape with Retry-After; the address as Railway's edge reports
 * it. Each test builds its app with small budgets and a clock it drives, so a
 * refill is a step of `ms`, not a wait. The production sizes against the real
 * cadence: limits.test.ts.
 */

/** Railway's proxy, the socket peer of every request it hands on. */
const PROXY = '100.64.0.7';
const SCHOOL = '203.0.113.10';
const HOME = '198.51.100.20';
/** No class can have it: `O` is not in the join-code alphabet. */
const NO_CLASS = 'NOCODE';

let db: Database;
let closeDb: () => Promise<void>;
let issuer: TestIssuer;
let ms = 0;
const apps: FastifyInstance[] = [];

beforeAll(async () => {
  ({ db, close: closeDb } = await makeTestDb());
  issuer = await makeTestIssuer();
});

afterAll(async () => {
  await Promise.all(apps.map((app) => app.close()));
  await closeDb();
});

beforeEach(() => {
  ms = 0;
});

/** The app with `budgets`, refilling by the test's own clock. */
function appWith(budgets: Omit<LimitOptions, 'now'>, verifyToken?: TokenVerifier) {
  const app = buildApp(testEnv, {
    db,
    verifyToken: verifyToken ?? issuer.verifier,
    limits: { ...budgets, now: () => ms },
  });
  apps.push(app);
  return app;
}

/** A request as Railway's edge hands it on: from its proxy, the client's address in X-Real-IP. */
const via = (address: string, headers: Record<string, string> = {}) => ({
  remoteAddress: PROXY,
  headers: { 'x-real-ip': address, ...headers },
});

const signedIn = async (sub: string) => ({ authorization: `Bearer ${await issuer.sign({ sub })}` });

/** `app` answers `opts` sent from `address`: the status, and Retry-After when there is one. */
async function send(
  app: FastifyInstance,
  address: string,
  opts: { method?: InjectOptions['method']; url: string; headers?: Record<string, string> },
  payload?: object,
) {
  const res = await app.inject({
    method: opts.method ?? 'GET',
    url: opts.url,
    payload,
    ...via(address, opts.headers),
  });
  return {
    status: res.statusCode,
    retryAfter: res.headers['retry-after'],
    body: res.json<unknown>(),
  };
}

const stamped = () => ({ eventId: randomUUID(), deviceTime: new Date().toISOString() });

describe('a budget per verified account', () => {
  it('passes a request within budget, and answers one over it 429 in the one shape with Retry-After', async () => {
    const app = appWith({ account: { burst: 2, perMinute: 60 } });
    const me = { url: '/v1/me', headers: await signedIn('limits-ana') };

    expect((await send(app, SCHOOL, me)).status).toBe(200);
    expect((await send(app, SCHOOL, me)).status).toBe(200);
    const over = await send(app, SCHOOL, me);
    expect(over).toEqual({
      status: 429,
      retryAfter: '1',
      body: { error: { code: 'rate_limited', message: 'too many requests from this account' } },
    });

    // A second's refill is one more request.
    ms += 1_000;
    expect((await send(app, SCHOOL, me)).status).toBe(200);
    expect((await send(app, SCHOOL, me)).status).toBe(429);
  });

  it('keeps an account over its budget from touching another at the same address', async () => {
    const app = appWith({ account: { burst: 1, perMinute: 1 } });
    const ana = { url: '/v1/me', headers: await signedIn('limits-ana-2') };
    const ben = { url: '/v1/me', headers: await signedIn('limits-ben-2') };

    expect((await send(app, SCHOOL, ana)).status).toBe(200);
    expect((await send(app, SCHOOL, ana)).status).toBe(429);
    // The same school address, another account: its own budget, whole.
    expect((await send(app, SCHOOL, ben)).status).toBe(200);
  });

  it('answers an unlock over budget 429, which the outbox keeps and sends again — then it records', async () => {
    const { klass, student } = await seedClassroom(db, 'limits-unlock');
    const { session } = await startSession(db, {
      classId: klass.id,
      startedAt: new Date(Date.now() - 60_000),
      endsAt: new Date(Date.now() + 25 * 60_000),
    });
    await tapIn(db, {
      sessionId: session.id,
      studentId: student.id,
      eventId: randomUUID(),
      deviceTime: new Date(),
    });
    const app = appWith({ account: { burst: 1, perMinute: 6 } });
    const headers = await signedIn(student.cognitoId);
    const unlock = { method: 'POST' as const, url: `/v1/sessions/${session.id}/unlock`, headers };
    const record = stamped();

    expect((await send(app, SCHOOL, { url: '/v1/me', headers })).status).toBe(200);
    const refused = await send(app, SCHOOL, unlock, record);
    expect(refused.status).toBe(429);
    expect(refused.retryAfter).toBe('10');
    // The unlock contract: a 429 is the transport's, a retry, never a discard.
    expect(unlockDisposition(refused.status)).toBe('retry');

    ms += 10_000;
    const sent = await send(app, SCHOOL, unlock, record);
    expect(sent.status).toBe(200);
    expect(unlockDisposition(sent.status, sent.body as UnlockResponse)).toBe('recorded');
    expect(sent.body).toMatchObject({ outcome: 'applied', state: 'unlocked' });
  });
});

describe('a budget per address where no one is signed in', () => {
  it('counts no token and a refused one by address, and never a signed-in request', async () => {
    const app = appWith({ unsigned: { burst: 2, perMinute: 60 } });
    const bad = { authorization: `Bearer ${await issuer.sign({ clientId: 'another-app' })}` };

    expect((await send(app, SCHOOL, { url: '/v1/me' })).status).toBe(401);
    expect((await send(app, SCHOOL, { url: '/v1/me', headers: bad })).status).toBe(401);
    const over = await send(app, SCHOOL, { url: '/v1/me' });
    expect(over).toEqual({
      status: 429,
      retryAfter: '1',
      body: { error: { code: 'rate_limited', message: 'too many requests with no sign-in' } },
    });
    expect((await send(app, SCHOOL, { url: '/v1/me', headers: bad })).status).toBe(429);

    // Another address has its own; a signed-in phone at this one is never held by it.
    expect((await send(app, HOME, { url: '/v1/me' })).status).toBe(401);
    const phone = { url: '/v1/me', headers: await signedIn('limits-cal') };
    expect((await send(app, SCHOOL, phone)).status).toBe(200);

    ms += 1_000;
    expect((await send(app, SCHOOL, { url: '/v1/me' })).status).toBe(401);
  });

  it('charges nothing when the key set is out of reach: a 503 is ours, not the caller’s', async () => {
    const unreachable: TokenVerifier = () =>
      Promise.reject(ApiError.unavailable('could not verify token'));
    const app = appWith({ unsigned: { burst: 1, perMinute: 1 } }, unreachable);
    const token = { url: '/v1/me', headers: { authorization: 'Bearer some.token.here' } };

    for (let i = 0; i < 3; i += 1) expect((await send(app, SCHOOL, token)).status).toBe(503);
    expect((await send(app, SCHOOL, { url: '/v1/me' })).status).toBe(401);
    expect((await send(app, SCHOOL, { url: '/v1/me' })).status).toBe(429);
  });
});

describe('guessing join codes', () => {
  it('holds each account to its tries on the preview and the join together', async () => {
    const { klass } = await seedClassroom(db, 'limits-tries');
    const app = appWith({ joinTries: { burst: 2, perMinute: 2 } });
    const dee = await signedIn('limits-dee');
    const preview = { url: `/v1/join-codes/${klass.joinCode}`, headers: dee };
    const join = { method: 'POST' as const, url: '/v1/enrollments', headers: dee };

    expect((await send(app, SCHOOL, preview)).status).toBe(200);
    expect((await send(app, SCHOOL, preview)).status).toBe(200);
    const over = await send(app, SCHOOL, join, { joinCode: klass.joinCode, ...stamped() });
    expect(over).toEqual({
      status: 429,
      retryAfter: '30',
      body: { error: { code: 'rate_limited', message: 'too many join-code tries' } },
    });
    // Another account has its own tries.
    const eve = { url: `/v1/join-codes/${klass.joinCode}`, headers: await signedIn('limits-eve') };
    expect((await send(app, SCHOOL, eve)).status).toBe(200);

    ms += 30_000;
    const joined = await send(app, SCHOOL, join, { joinCode: klass.joinCode, ...stamped() });
    expect(joined).toMatchObject({ status: 200, body: { outcome: 'joined' } });
  });

  it('stops an address once its misses are spent, whichever accounts made them — the backstop', async () => {
    const { klass } = await seedClassroom(db, 'limits-misses');
    const app = appWith({ joinMisses: { burst: 2, perMinute: 6 } });
    const look = async (sub: string, code: string, address = SCHOOL) =>
      send(app, address, { url: `/v1/join-codes/${code}`, headers: await signedIn(sub) });

    expect((await look('limits-g1', NO_CLASS)).status).toBe(404);
    const joinMiss = { joinCode: NO_CLASS, ...stamped() };
    const headers = await signedIn('limits-g2');
    const missed = await send(
      app,
      SCHOOL,
      { method: 'POST', url: '/v1/enrollments', headers },
      joinMiss,
    );
    expect(missed.body).toMatchObject({ error: { reason: 'class_not_found' } });

    // A fresh account, the right code: refused before any lookup, for its address's misses.
    const held = await look('limits-g3', klass.joinCode);
    expect(held).toEqual({
      status: 429,
      retryAfter: '10',
      body: { error: { code: 'rate_limited', message: 'too many unknown join codes from here' } },
    });
    expect((await look('limits-g3', klass.joinCode, HOME)).status).toBe(200);

    // Ten seconds give one miss back; a hit spends none of it, a miss does.
    ms += 10_000;
    expect((await look('limits-g3', klass.joinCode)).status).toBe(200);
    expect((await look('limits-g4', NO_CLASS)).status).toBe(404);
    expect((await look('limits-g5', klass.joinCode)).status).toBe(429);
  });

  it('counts only misses: codes that open a class never spend the backstop', async () => {
    const { klass } = await seedClassroom(db, 'limits-hits');
    const app = appWith({ joinMisses: { burst: 1, perMinute: 1 } });
    const look = async (sub: string, code: string) =>
      send(app, SCHOOL, { url: `/v1/join-codes/${code}`, headers: await signedIn(sub) });

    for (let i = 0; i < 5; i += 1) {
      expect((await look(`limits-hit-${i}`, klass.joinCode)).status).toBe(200);
    }
    expect((await look('limits-hit-miss', NO_CLASS)).status).toBe(404);
    expect((await look('limits-hit-after', klass.joinCode)).status).toBe(429);
  });
});

describe('the caller’s address behind Railway’s edge', () => {
  it('is the X-Real-IP the edge sets: one bucket for each client behind the same proxy', async () => {
    const app = appWith({ unsigned: { burst: 1, perMinute: 1 } });

    expect((await send(app, SCHOOL, { url: '/v1/me' })).status).toBe(401);
    expect((await send(app, SCHOOL, { url: '/v1/me' })).status).toBe(429);
    expect((await send(app, HOME, { url: '/v1/me' })).status).toBe(401);
  });

  it('ignores an X-Forwarded-For entry a client adds: it never picks a bucket', async () => {
    const app = appWith({ unsigned: { burst: 1, perMinute: 1 } });
    const spoofs = ['192.0.2.99', `192.0.2.99, ${SCHOOL}`, `192.0.2.99, ${SCHOOL}, 100.64.0.9`];

    expect((await send(app, SCHOOL, { url: '/v1/me' })).status).toBe(401);
    for (const forwarded of spoofs) {
      const res = await send(app, SCHOOL, {
        url: '/v1/me',
        headers: { 'x-forwarded-for': forwarded },
      });
      expect(res.status, forwarded).toBe(429);
    }

    // With no X-Real-IP (a local run), the socket's peer, whatever is forwarded.
    const local = (forwarded?: string) =>
      app.inject({
        method: 'GET',
        url: '/v1/me',
        remoteAddress: '127.0.0.1',
        headers: forwarded ? { 'x-forwarded-for': forwarded } : {},
      });
    expect((await local()).statusCode).toBe(401);
    for (const forwarded of spoofs)
      expect((await local(forwarded)).statusCode, forwarded).toBe(429);
  });

  it('takes an X-Real-IP that is no address as none: the socket’s peer', async () => {
    const app = appWith({ unsigned: { burst: 1, perMinute: 1 } });

    expect((await send(app, 'not-an-address', { url: '/v1/me' })).status).toBe(401);
    // Another value that is no address keys on the same peer, Railway's proxy here.
    expect((await send(app, `${SCHOOL}, ${HOME}`, { url: '/v1/me' })).status).toBe(429);
    expect((await send(app, SCHOOL, { url: '/v1/me' })).status).toBe(401);
  });
});

describe('what spends no budget', () => {
  it('/healthz, for anyone, however often', async () => {
    const app = appWith({
      account: { burst: 1, perMinute: 1 },
      unsigned: { burst: 1, perMinute: 1 },
    });

    for (let i = 0; i < 5; i += 1) {
      expect((await send(app, SCHOOL, { url: '/healthz' })).status).toBe(200);
    }
    // The address still has its one.
    expect((await send(app, SCHOOL, { url: '/v1/me' })).status).toBe(401);
  });

  it('/internal/*: the internal key is its guard, with no account budget', async () => {
    const app = appWith({
      account: { burst: 1, perMinute: 1 },
      unsigned: { burst: 1, perMinute: 1 },
    });
    const sweep = (key: string) => ({
      method: 'POST' as const,
      url: '/internal/sweep',
      headers: { 'x-internal-key': key },
    });

    for (let i = 0; i < 3; i += 1) {
      expect((await send(app, SCHOOL, sweep(testEnv.INTERNAL_API_KEY))).status).toBe(200);
      expect((await send(app, SCHOOL, sweep('not-the-internal-key-0123'))).status).toBe(401);
    }
  });
});

describe('the other suites’ app (makeAuthedApp)', () => {
  it('meets no budget, so no other suite trips one: past each production burst, every answer is the route’s', async () => {
    const ctx = await makeAuthedApp(db);
    apps.push(ctx.app);
    const token = await ctx.tokenFor('limits-roomy');
    // One account at one address: past its 120, its 20 tries and the address's 100 misses.
    const past = Math.max(BUDGETS.account.burst, BUDGETS.joinTries.burst, BUDGETS.joinMisses.burst);
    for (let i = 0; i <= past; i += 1) {
      const url = `/v1/join-codes/${NO_CLASS}`;
      expect((await authedInject(ctx.app, token, { method: 'GET', url })).statusCode).toBe(404);
    }
  });
});
