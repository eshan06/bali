import {
  createSchool,
  type Database,
  events,
  formatInviteCode,
  mintTeacherInvite,
  participations,
  recordAgreement,
  startSession,
  tapIn,
  teacherInvites,
  unlock,
  users,
} from '@bali/db';
import { unlockDisposition } from '@bali/shared';
import { and, count, eq, isNotNull, isNull } from 'drizzle-orm';
import type { FastifyInstance, InjectOptions } from 'fastify';
import { exportJWK, generateKeyPair, SignJWT } from 'jose';
import { createPublicKey, randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { buildApp } from '../src/app.js';
import { BUDGETS, type LimitOptions } from '../src/limits.js';
import { makeTestDb, seedClassroom } from './helpers/db.js';
import { testEnv } from './helpers/env.js';
import { routeTable } from './helpers/openapi.js';
import {
  makeTestIssuer,
  TEST_AUDIENCE,
  TEST_ISSUER,
  type TestIssuer,
} from './helpers/test-issuer.js';

/*
 * Abuse tests, in process (Phase 6 · S7): the API under an attacker's
 * requests, with real tokens from the test issuer — guessing join codes until
 * both budgets bite, a flood of orphan unlocks, another student's event_id,
 * tokens forged or bent every common way, oversized bodies and path parameters
 * that are no UUID. Each must end in a refusal in the one error shape, never a
 * 500 or a 503, and a refusal writes nothing. What this proved:
 * docs/DECISIONS.md, 2026-10-04 (S7).
 */

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

/** The app on `budgets` (production's where none is given), refilling by the test's clock. */
function appWith(budgets: Omit<LimitOptions, 'now'> = {}) {
  const app = buildApp(testEnv, {
    db,
    verifyToken: issuer.verifier,
    limits: { ...budgets, now: () => ms },
  });
  apps.push(app);
  return app;
}

/** Budgets no test here meets but the one it names. */
const ROOMY = { burst: 1_000_000, perMinute: 1_000_000 };

const bearer = async (sub: string) => `Bearer ${await issuer.sign({ sub })}`;

async function send(
  app: FastifyInstance,
  opts: {
    method?: InjectOptions['method'];
    url: string;
    sub?: string;
    token?: string;
    address?: string;
    payload?: InjectOptions['payload'];
    headers?: Record<string, string>;
  },
) {
  const authorization =
    opts.token !== undefined
      ? `Bearer ${opts.token}`
      : opts.sub !== undefined
        ? await bearer(opts.sub)
        : undefined;
  const res = await app.inject({
    method: opts.method ?? 'GET',
    url: opts.url,
    payload: opts.payload,
    remoteAddress: '100.64.0.7',
    headers: {
      'x-real-ip': opts.address ?? SCHOOL,
      ...(authorization ? { authorization } : {}),
      ...opts.headers,
    },
  });
  return { status: res.statusCode, body: res.json<{ error?: Record<string, unknown> }>() };
}

const stamped = (eventId: string = randomUUID()) => ({
  eventId,
  deviceTime: new Date().toISOString(),
});

/** Every row the engine and the invite redeem write: a refusal leaves each count as it was. */
async function written() {
  const [e] = await db.select({ n: count() }).from(events);
  const [p] = await db.select({ n: count() }).from(participations);
  const [i] = await db
    .select({ n: count() })
    .from(teacherInvites)
    .where(isNotNull(teacherInvites.redeemedAt));
  const [t] = await db.select({ n: count() }).from(users).where(eq(users.role, 'teacher'));
  return { events: e!.n, participations: p!.n, redeemed: i!.n, teachers: t!.n };
}

/** A classroom whose session is running. */
async function running(tag: string) {
  const seeded = await seedClassroom(db, tag);
  const { session } = await startSession(db, {
    classId: seeded.klass.id,
    startedAt: new Date(Date.now() - 60_000),
    endsAt: new Date(Date.now() + 25 * 60_000),
  });
  return { ...seeded, session };
}

describe('guessing join codes, at production’s budgets', () => {
  it('meets the account’s tries first, then the address’s misses, whatever accounts it spreads over', async () => {
    const app = appWith();
    const { klass } = await seedClassroom(db, 'abuse-join');
    const guess = (sub: string, code = NO_CLASS, address = SCHOOL) =>
      send(app, { url: `/v1/join-codes/${code}`, sub, address });

    // One account: its 20 tries, every one a miss, then a 429 for its tries.
    for (let i = 0; i < BUDGETS.joinTries.burst; i += 1) {
      expect((await guess('abuse-guesser-0')).status).toBe(404);
    }
    expect(await guess('abuse-guesser-0')).toEqual({
      status: 429,
      body: { error: { code: 'rate_limited', message: 'too many join-code tries' } },
    });

    // Fresh accounts at the same address, until the address's 100 misses are spent.
    const accounts = BUDGETS.joinMisses.burst / BUDGETS.joinTries.burst;
    for (let a = 1; a < accounts; a += 1) {
      for (let i = 0; i < BUDGETS.joinTries.burst; i += 1) {
        expect((await guess(`abuse-guesser-${a}`)).status).toBe(404);
      }
    }
    // The backstop: a fresh account, even with the right code, is refused before any lookup.
    expect(await guess('abuse-guesser-fresh', klass.joinCode)).toEqual({
      status: 429,
      body: { error: { code: 'rate_limited', message: 'too many unknown join codes from here' } },
    });
    // The join holds to it too; another address is untouched.
    const join = await send(app, {
      method: 'POST',
      url: '/v1/enrollments',
      sub: 'abuse-guesser-fresh',
      payload: { joinCode: klass.joinCode, ...stamped() },
    });
    expect(join.status).toBe(429);
    expect((await guess('abuse-guesser-fresh', klass.joinCode, HOME)).status).toBe(200);
  });

  it('a 429 for an account’s tries gives back the miss its address held (L1’s review)', async () => {
    const app = appWith({
      joinTries: { burst: 1, perMinute: 1 },
      joinMisses: { burst: 2, perMinute: 1 },
    });
    const guess = (sub: string) => send(app, { url: `/v1/join-codes/${NO_CLASS}`, sub });

    expect((await guess('abuse-held-a')).status).toBe(404); // the address: 1 miss left
    // Holds the address's last miss, then is refused for its own tries: the miss comes back.
    expect((await guess('abuse-held-a')).body).toMatchObject({
      error: { message: 'too many join-code tries' },
    });
    expect((await guess('abuse-held-b')).status).toBe(404); // the miss given back, spent
    expect((await guess('abuse-held-c')).body).toMatchObject({
      error: { message: 'too many unknown join codes from here' },
    });
  });
});

describe('a flood of orphan unlocks', () => {
  it('records at most the account’s budget: every one past it is a 429 the outbox retries, and writes nothing', async () => {
    const app = appWith();
    const sub = 'abuse-orphan-flooder';
    const flood = BUDGETS.account.burst + 30;
    const answers: number[] = [];
    for (let i = 0; i < flood; i += 1) {
      const res = await send(app, {
        method: 'POST',
        url: `/v1/sessions/${randomUUID()}/unlock`,
        sub,
        payload: stamped(),
      });
      answers.push(res.status);
    }
    expect(answers.filter((s) => s === 200)).toHaveLength(BUDGETS.account.burst);
    expect(answers.filter((s) => s === 429)).toHaveLength(30);
    expect(unlockDisposition(429)).toBe('retry');

    const orphans = async () => {
      const [row] = await db
        .select({ n: count() })
        .from(events)
        .innerJoin(users, eq(users.id, events.userId))
        .where(and(eq(users.cognitoId, sub), isNull(events.sessionId), eq(events.type, 'unlock')));
      return row!.n;
    };
    expect(await orphans()).toBe(BUDGETS.account.burst);

    // Then its refill, and no more: two a second.
    ms += 10_000;
    const refill = (10 * BUDGETS.account.perMinute) / 60;
    const after: number[] = [];
    for (let i = 0; i < refill + 5; i += 1) {
      const res = await send(app, {
        method: 'POST',
        url: `/v1/sessions/${randomUUID()}/unlock`,
        sub,
        payload: stamped(),
      });
      after.push(res.status);
    }
    expect(after).toEqual([...Array<number>(refill).fill(200), ...Array<number>(5).fill(429)]);
    expect(await orphans()).toBe(BUDGETS.account.burst + refill);
  });
});

describe('another student’s event_id', () => {
  /** Ana's records, then Ben — in a class of his own, its session running — sends her ids. */
  async function twoStudents(tag: string) {
    const ana = await running(`${tag}-ana`);
    const ben = await running(`${tag}-ben`);
    const anaTap = randomUUID();
    const anaUnlock = randomUUID();
    const own = { sessionId: ana.session.id, studentId: ana.student.id };
    await tapIn(db, { ...own, eventId: anaTap, deviceTime: new Date() });
    await unlock(db, { ...own, eventId: anaUnlock, deviceTime: new Date() });
    return { ana, ben, anaTap, anaUnlock };
  }

  const conflict = {
    status: 409,
    body: {
      error: {
        code: 'conflict',
        reason: 'event_id_conflict',
        message: 'event_id already used by another event',
      },
    },
  };

  it('on a tap, an unlock and a refocus: 409, and nothing written', async () => {
    const app = appWith({ account: ROOMY });
    const { ben, anaTap, anaUnlock } = await twoStudents('abuse-ids');
    const as = ben.student.cognitoId;

    for (const id of [anaTap, anaUnlock]) {
      let before = await written();
      const tap = await send(app, {
        method: 'POST',
        url: '/v1/taps',
        sub: as,
        payload: { tagId: ben.block.tagId, ...stamped(id) },
      });
      expect(tap, 'tap').toEqual(conflict);
      expect(await written()).toEqual(before);

      before = await written();
      const unlocked = await send(app, {
        method: 'POST',
        url: `/v1/sessions/${ben.session.id}/unlock`,
        sub: as,
        payload: stamped(id),
      });
      expect(unlocked, 'unlock').toEqual(conflict);
      // The unlock contract: kept, retried and shown, never discarded.
      expect(unlockDisposition(unlocked.status)).toBe('retry_and_surface');
      expect(await written()).toEqual(before);
    }

    // Ben in his session and unlocked, on ids of his own; then a refocus on Ana's.
    const benOwn = { sessionId: ben.session.id, studentId: ben.student.id };
    await tapIn(db, { ...benOwn, eventId: randomUUID(), deviceTime: new Date() });
    await unlock(db, { ...benOwn, eventId: randomUUID(), deviceTime: new Date() });
    for (const id of [anaTap, anaUnlock]) {
      const before = await written();
      const refocus = await send(app, {
        method: 'POST',
        url: `/v1/sessions/${ben.session.id}/refocus`,
        sub: as,
        payload: stamped(id),
      });
      expect(refocus, 'refocus').toEqual(conflict);
      expect(await written()).toEqual(before);
    }
    const [state] = await db
      .select({ state: participations.state })
      .from(participations)
      .where(eq(participations.studentId, ben.student.id));
    expect(state?.state).toBe('unlocked');
  });

  it('on an invite redeem: 409, and neither the invite nor the account changes', async () => {
    const app = appWith({ account: ROOMY, inviteTries: ROOMY, inviteMisses: ROOMY });
    const school = await createSchool(db, { name: 'Abuse High' });
    await recordAgreement(db, { schoolId: school.id, signedOn: '2026-09-30' });
    const code = async () => {
      const minted = await mintTeacherInvite(db, { schoolId: school.id });
      if (minted.outcome !== 'minted') throw new Error(`no invite: ${minted.outcome}`);
      return formatInviteCode(minted.code);
    };
    const redeem = (sub: string, body: object) =>
      send(app, { method: 'POST', url: '/v1/teacher-invites/redeem', sub, payload: body });

    const anas = randomUUID();
    expect((await redeem('abuse-redeem-ana', { code: await code(), eventId: anas })).status).toBe(
      200,
    );

    const before = await written();
    const bens = await redeem('abuse-redeem-ben', { code: await code(), eventId: anas });
    expect(bens).toEqual(conflict);
    expect(await written()).toEqual(before);
    const ben = await send(app, { url: '/v1/me', sub: 'abuse-redeem-ben' });
    expect(ben.body).toMatchObject({ user: { role: 'student' } });
  });
});

describe('a malformed or forged token', () => {
  const b64 = (value: object) => Buffer.from(JSON.stringify(value)).toString('base64url');
  const now = () => Math.floor(Date.now() / 1000);
  const claims = () => ({
    sub: 'abuse-forger',
    iss: TEST_ISSUER,
    client_id: TEST_AUDIENCE,
    token_use: 'access',
    iat: now(),
    exp: now() + 3600,
  });
  /** A key pair that is not the pool's. */
  const attacker = generateKeyPair('RS256', { extractable: true });
  const signedBy = async (header: Record<string, unknown>, payload: object = claims()) =>
    new SignJWT({ ...payload })
      .setProtectedHeader({ alg: 'RS256', ...header })
      .sign((await attacker).privateKey);
  /** The pool's own public key, as an HMAC secret: the alg-confusion attack. */
  const publicKeyAsSecret = async (alg: 'HS256' | 'HS512', form: 'pem' | 'jwk') => {
    const key = createPublicKey({ key: { ...issuer.publicJwk }, format: 'jwk' });
    const secret =
      form === 'pem'
        ? (key.export({ type: 'spki', format: 'pem' }) as string)
        : JSON.stringify(issuer.publicJwk);
    return new SignJWT(claims())
      .setProtectedHeader({ alg, kid: issuer.publicJwk.kid })
      .sign(new TextEncoder().encode(secret));
  };

  const CASES: [name: string, token: () => string | Promise<string>][] = [
    ['alg: none, no signature', () => `${b64({ alg: 'none' })}.${b64(claims())}.`],
    [
      'alg: none, with the pool’s key id',
      () => `${b64({ alg: 'none', kid: issuer.publicJwk.kid })}.${b64(claims())}.`,
    ],
    ['alg: NONE, in capitals', () => `${b64({ alg: 'NONE' })}.${b64(claims())}.`],
    ['HS256 signed with the public key’s PEM', () => publicKeyAsSecret('HS256', 'pem')],
    ['HS256 signed with the public JWK', () => publicKeyAsSecret('HS256', 'jwk')],
    ['HS512 signed with the public key’s PEM', () => publicKeyAsSecret('HS512', 'pem')],
    ['an unknown key id', () => signedBy({ kid: 'rotated-away' })],
    ['no key id, another key', () => signedBy({})],
    ['the pool’s key id, another key', () => signedBy({ kid: issuer.publicJwk.kid })],
    [
      'its own key embedded in the header (jwk)',
      async () => signedBy({ jwk: await exportJWK((await attacker).publicKey) }),
    ],
    ['a key id that is a number', () => signedBy({ kid: 42 })],
    [
      'an unknown critical header',
      // Hand-made: jose won't sign a header it can't honour.
      () =>
        `${b64({ alg: 'RS256', kid: issuer.publicJwk.kid, crit: ['x-bali'], 'x-bali': 1 })}.${b64(claims())}.c2ln`,
    ],
    ['expired', () => issuer.sign({ sub: 'abuse-forger', expiresInSeconds: -60 })],
    [
      'not yet valid (nbf an hour on)',
      () => issuer.sign({ sub: 'abuse-forger', extraClaims: { nbf: now() + 3600 } }),
    ],
    [
      'a wrong issuer',
      () => issuer.sign({ sub: 'abuse-forger', issuer: 'https://evil.example/pool' }),
    ],
    ['another app’s client', () => issuer.sign({ sub: 'abuse-forger', clientId: 'another-app' })],
    ['another app’s audience', () => issuer.sign({ sub: 'abuse-forger', audience: 'another-app' })],
    ['an empty subject', () => issuer.sign({ sub: '' })],
    [
      'its payload swapped after signing',
      async () => {
        const [head, , sig] = (await issuer.sign({ sub: 'abuse-forger' })).split('.');
        return `${head}.${b64({ ...claims(), sub: 'someone-else' })}.${sig}`;
      },
    ],
    ['two parts', () => `${b64({ alg: 'RS256' })}.${b64(claims())}`],
    ['four parts', async () => `${await issuer.sign({ sub: 'abuse-forger' })}.extra`],
    ['a header that is no JSON', () => `bm90LWpzb24.${b64(claims())}.c2ln`],
    ['a header that is JSON but no object', () => `${b64([1])}.${b64(claims())}.c2ln`],
    [
      'a payload that is no JSON',
      () => `${b64({ alg: 'RS256', kid: 'test-key-1' })}.bm90LWpzb24.c2ln`,
    ],
    ['not a JWT at all', () => 'hello'],
    ['a 16 KB token', () => `${'a'.repeat(16_384)}.${'b'.repeat(16)}.${'c'.repeat(16)}`],
  ];

  it.each(CASES)('%s → 401 in the one shape', async (_, token) => {
    const app = appWith({ unsigned: ROOMY });
    const res = await send(app, { url: '/v1/me', token: await token() });
    expect(res.status).toBe(401);
    expect(res.body.error).toMatchObject({ code: 'unauthorized' });
  });

  // S3 (#209, parked) adds the `token_use` check: on main an ID token is still taken.
  it.todo('an ID token rather than an access token → 401 (lands with S3, #209)');
});

describe('an oversized or malformed body', () => {
  /** Anything but a 5xx, in the one error shape. */
  const refused = (res: { status: number; body: { error?: Record<string, unknown> } }) => {
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.status).toBeLessThan(500);
    expect(Object.keys(res.body)).toEqual(['error']);
    expect(typeof res.body.error?.code).toBe('string');
    expect(typeof res.body.error?.message).toBe('string');
  };

  it('over Fastify’s 1 MiB limit: 413 in the one shape, signed in or not', async () => {
    const app = appWith({ account: ROOMY, unsigned: ROOMY });
    const { block, student } = await seedClassroom(db, 'abuse-body');
    const huge = JSON.stringify({ tagId: block.tagId, ...stamped(), pad: 'x'.repeat(2 ** 21) });
    const headers = { 'content-type': 'application/json' };
    for (const sub of [student.cognitoId, undefined]) {
      const res = await send(app, { method: 'POST', url: '/v1/taps', sub, payload: huge, headers });
      expect(res.status).toBe(413);
      expect(Object.keys(res.body.error ?? {})).toEqual(['code', 'message']);
      expect(res.body.error?.code).toBe('bad_input');
      expect(String(res.body.error?.message)).toMatch(/too large/i);
    }
  });

  it('a field near the limit: refused, or read as the value it is, never a crash', async () => {
    const app = appWith({
      account: ROOMY,
      joinTries: ROOMY,
      joinMisses: ROOMY,
      inviteTries: ROOMY,
      inviteMisses: ROOMY,
    });
    const { teacher, student, klass } = await seedClassroom(db, 'abuse-field');
    const big = 'x'.repeat(900_000);
    const post = (
      url: string,
      sub: string,
      payload: object,
      method: InjectOptions['method'] = 'POST',
    ) => send(app, { method, url, sub, payload });

    // Capped fields: 400.
    for (const res of [
      await post('/v1/blocks', teacher.cognitoId, { tagId: big }),
      await post('/v1/classes', teacher.cognitoId, { name: big }),
      await post(`/v1/classes/${klass.id}`, teacher.cognitoId, { name: big }, 'PATCH'),
      await post('/v1/me', student.cognitoId, { displayName: big, eventId: randomUUID() }, 'PATCH'),
      await post('/v1/enrollments', student.cognitoId, { joinCode: big, ...stamped() }),
      await post('/v1/teacher-invites/redeem', 'abuse-field-redeemer', {
        code: big,
        eventId: randomUUID(),
      }),
      await post(`/v1/sessions/${randomUUID()}/unlock`, student.cognitoId, {
        ...stamped(),
        eventId: big,
      }),
    ]) {
      expect(res.status).toBe(400);
      refused(res);
    }
    // A tap's tagId has no cap until S3 (#209): it reads as no block.
    const tap = await post('/v1/taps', student.cognitoId, { tagId: big, ...stamped() });
    expect([400, 404]).toContain(tap.status);
    refused(tap);
    // An unlock's reason is never a reason to refuse it: recorded with none.
    const unlocked = await post(`/v1/sessions/${randomUUID()}/unlock`, student.cognitoId, {
      ...stamped(),
      reason: big,
    });
    expect(unlocked).toMatchObject({ status: 200, body: { outcome: 'recorded', reason: null } });
  });

  it('JSON nested deep, a body that is no JSON, or no JSON media type: 4xx in the one shape', async () => {
    const app = appWith({ account: ROOMY });
    const sub = 'abuse-shape';
    const headers = { 'content-type': 'application/json' };
    const deep = `${'['.repeat(100_000)}${']'.repeat(100_000)}`;
    for (const res of [
      await send(app, { method: 'POST', url: '/v1/taps', sub, headers, payload: deep }),
      await send(app, {
        method: 'POST',
        url: '/v1/taps',
        sub,
        headers,
        payload: `{"tagId": [${deep}]}`,
      }),
      await send(app, { method: 'POST', url: '/v1/taps', sub, headers, payload: '{"tagId":' }),
      await send(app, { method: 'POST', url: '/v1/taps', sub, headers, payload: 'null' }),
      await send(app, { method: 'POST', url: '/v1/taps', sub, headers, payload: '"a string"' }),
      await send(app, {
        method: 'POST',
        url: '/v1/taps',
        sub,
        headers: { 'content-type': 'text/plain' },
        payload: 'tagId=1',
      }),
      await send(app, {
        method: 'POST',
        url: '/v1/taps',
        sub,
        headers,
        payload: '{"__proto__":{"tagId":"x"}}',
      }),
    ]) {
      refused(res);
    }
  });
});

// The app's real route table, read before the tests are declared.
const routes = await routeTable();

describe('a path parameter that is no UUID', () => {
  /** Every route with a UUID in its path: all but the join code's. */
  const uuidRoutes = routes.filter(
    (r) => r.method !== 'HEAD' && /:(id|sessionId|eventId)\b/.test(r.url),
  );
  const BAD = ['not-a-uuid', "1' OR '1'='1", `${randomUUID()}x`, '0', '%00', 'x'.repeat(100)];

  it('covers every route that takes one: a parameter named otherwise needs its line here', () => {
    const withParams = routes.filter(
      (r) => r.method !== 'HEAD' && r.url.includes(':') && r.url !== '/v1/join-codes/:code',
    );
    expect(uuidRoutes.map((r) => r.url)).toEqual(withParams.map((r) => r.url));
    expect(uuidRoutes.length).toBeGreaterThan(0);
  });

  it.each(uuidRoutes.map((r) => [`${String(r.method)} ${r.url}`, r] as const))(
    '%s → 400 in the one shape',
    async (_, route) => {
      const app = appWith({ account: ROOMY });
      // A teacher: past every role check, the parameter is the first thing refused.
      const { teacher } = await seedClassroom(
        db,
        `abuse-param-${route.url}-${String(route.method)}`,
      );
      for (const bad of BAD) {
        const res = await send(app, {
          method: route.method as InjectOptions['method'],
          url: route.url.replace(/:[A-Za-z]+/g, bad),
          sub: teacher.cognitoId,
          payload: {},
        });
        expect(res.status, bad).toBe(400);
        expect(res.body.error, bad).toMatchObject({ code: 'bad_input' });
      }
      // Refused by Fastify's router before any route runs: past its 100-character
      // cap on a parameter (414), or no valid percent-encoding (400). Still the one
      // shape, and the path not echoed back.
      for (const [bad, status] of [
        ['x'.repeat(2_000), 414],
        ['%E0%A4%A', 400],
      ] as const) {
        const res = await send(app, {
          method: route.method as InjectOptions['method'],
          url: route.url.replace(/:[A-Za-z]+/g, bad),
          sub: teacher.cognitoId,
          payload: {},
        });
        expect(res.status, bad).toBe(status);
        expect(Object.keys(res.body), bad).toEqual(['error']);
        expect(Object.keys(res.body.error ?? {}), bad).toEqual(['code', 'message']);
        expect(res.body.error?.code, bad).toBe('bad_input');
        expect(String(res.body.error?.message), bad).not.toContain(bad);
      }
    },
  );
});
