import {
  type Database,
  endSession,
  enrollments,
  protectionOff,
  startSession,
  tapIn,
  unlock,
} from '@bali/db';
import { eq } from 'drizzle-orm';
import type { FastifyInstance, InjectOptions, RouteOptions } from 'fastify';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { buildApp } from '../src/app.js';
import { makeTestDb, seedClassroom } from './helpers/db.js';
import { testEnv } from './helpers/env.js';
import { routeTable } from './helpers/openapi.js';
import { makeTestIssuer, type TestIssuer } from './helpers/test-issuer.js';

/*
 * The authorization matrix (Phase 4 · S1, Phase 6's first security step):
 * every route the app registers, against each caller it can meet, and the
 * answer each one gets — as the routes behave today, so a change to who may
 * do what fails here first. The security investigation (docs/DECISIONS.md,
 * 2026-10-04) found no IDOR; this suite pins that state.
 *
 * The route table is the app's own (`buildApp`'s onRoute hook, as O1's
 * snapshot reads it), so a route with no row fails the guard below: a new
 * route ships with its rows. A HEAD route is its GET's: Fastify answers it
 * with the GET's handler, so it runs the GET's row. CORS's preflight
 * (`OPTIONS *`), registered only where a deploy names origins, answers with
 * headers and no data: cors.test.ts holds it.
 *
 * Every /v1 route answers six callers, in this order: no token; a token
 * validly signed for an app client the API doesn't accept (the owner's
 * account, so only the client id is wrong); the class's student, in its
 * session; a student of another class; that class's teacher; and the owner,
 * this class's teacher. /internal/* answers no key, a wrong key and the right
 * key; /healthz, anyone. A route anywhere else fails the guard, whatever its
 * row, until `callersOf` says who can call it: a new prefix (a /v2) is never
 * public by default.
 *
 * Each row runs in a world of its own (`world`), so no row's write reaches
 * another's. And a 2xx to a stranger names nothing of this world's (`hidden`)
 * — its session, its student, their enrollment, tap and unlock, the owner and
 * their block, and the class unless the request carries its join code — so
 * the routes no one is refused (an unlock, a check-in, a tap) are pinned too.
 */

const SIGNED_IN = [
  'no token',
  'another app',
  'student',
  'another student',
  'another teacher',
  'owner',
] as const;
const KEYED = ['no key', 'a wrong key', 'the right key'] as const;
const PUBLIC = ['anyone'] as const;
type Caller = (typeof SIGNED_IN | typeof KEYED | typeof PUBLIC)[number];

/** The callers a route answers, by where it lives: none known anywhere else, which the guard fails. */
function callersOf(url: string): readonly Caller[] | undefined {
  if (url.startsWith('/v1/')) return SIGNED_IN;
  if (url.startsWith('/internal/')) return KEYED;
  if (url === '/healthz') return PUBLIC;
  return undefined;
}

/** Callers with no claim on this world: a 2xx to one of them names nothing of it. */
const STRANGERS = new Set<Caller>(['another student', 'another teacher']);

/** What each caller is answered, in `callersOf`'s order. */
// prettier-ignore
const MATRIX = {
  //                                        anyone
  'GET /healthz':                           [200],
  //                                        no key  wrong  right
  'POST /internal/sweep':                   [401,   401,   200],
  'POST /internal/sessions/expire':         [401,   401,   200],
  //                                        none  app  student  other    other    owner
  //                                                            student  teacher
  'GET /v1/me':                             [401, 401, 200,     200,     200,     200],
  'PATCH /v1/me':                           [401, 401, 200,     200,     403,     403],
  'GET /v1/me/history':                     [401, 401, 200,     200,     403,     403],
  'POST /v1/taps':                          [401, 401, 200,     200,     200,     200],
  'POST /v1/taps/:eventId/unlock':          [401, 401, 200,     200,     200,     200],
  'PATCH /v1/unlocks/:eventId':             [401, 401, 200,     404,     404,     404],
  'GET /v1/join-codes/:code':               [401, 401, 200,     200,     403,     403],
  'POST /v1/enrollments':                   [401, 401, 200,     200,     403,     403],
  'DELETE /v1/enrollments/:id':             [401, 401, 200,     403,     403,     200],
  'POST /v1/classes':                       [401, 401, 403,     403,     200,     200],
  'GET /v1/classes/:id':                    [401, 401, 403,     403,     403,     200],
  'PATCH /v1/classes/:id':                  [401, 401, 403,     403,     403,     200],
  'GET /v1/classes/:id/roster':             [401, 401, 403,     403,     403,     200],
  'POST /v1/classes/:id/sessions':          [401, 401, 403,     403,     403,     200],
  'POST /v1/blocks':                        [401, 401, 403,     403,     409,     200],
  'GET /v1/sessions/:id':                   [401, 401, 403,     403,     403,     200],
  'GET /v1/sessions/:id/events':            [401, 401, 403,     403,     403,     200],
  'GET /v1/sessions/:id/stream':            [401, 401, 403,     403,     403,     200],
  'POST /v1/sessions/:id/end':              [401, 401, 403,     403,     403,     200],
  'POST /v1/sessions/:id/extend':           [401, 401, 403,     403,     403,     200],
  'POST /v1/sessions/:id/checkin':          [401, 401, 200,     200,     200,     200],
  'POST /v1/sessions/:id/unlock':           [401, 401, 200,     200,     200,     200],
  'POST /v1/sessions/:id/refocus':          [401, 401, 200,     409,     409,     409],
  'POST /v1/sessions/:id/protection-off':   [401, 401, 200,     409,     409,     409],
  'POST /v1/sessions/:id/protection-on':    [401, 401, 200,     409,     409,     409],
} as const satisfies Record<string, readonly number[]>;
type RouteKey = keyof typeof MATRIX;

/** A row's world: one classroom whose resources every request names, and another's two people. */
interface World {
  owner: Seeded['teacher'];
  student: Seeded['student'];
  otherTeacher: Seeded['teacher'];
  otherStudent: Seeded['student'];
  klass: Seeded['klass'];
  block: Seeded['block'];
  /** The student's enrollment in the owner's class. */
  enrollmentId: string;
  /** The class's session, running; the student tapped in, then unlocked. */
  sessionId: string;
  tapId: string;
  unlockId: string;
}
type Seeded = Awaited<ReturnType<typeof seedClassroom>>;

/** A request a row sends: its url, its body, and whether its answer is a stream that never ends. */
interface Sent {
  url: string;
  body?: object;
  stream?: boolean;
}

/** A phone's record: its own id, and its clock. */
const stamped = () => ({ eventId: randomUUID(), deviceTime: new Date().toISOString() });

/** Each route's request, against a row's world. A HEAD sends its GET's. */
const REQUESTS: Record<RouteKey, (w: World) => Sent | Promise<Sent>> = {
  'GET /healthz': () => ({ url: '/healthz' }),
  'POST /internal/sweep': () => ({ url: '/internal/sweep' }),
  'POST /internal/sessions/expire': () => ({ url: '/internal/sessions/expire' }),
  'GET /v1/me': () => ({ url: '/v1/me' }),
  'PATCH /v1/me': () => ({ url: '/v1/me', body: { displayName: 'Ada', eventId: randomUUID() } }),
  // The first page, as the app asks for it: another student is answered their
  // own history, so the stranger check reads it. (Another's cursor is a 400:
  // history.test.ts.)
  'GET /v1/me/history': () => ({ url: '/v1/me/history' }),
  'POST /v1/taps': (w) => ({ url: '/v1/taps', body: { tagId: w.block.tagId, ...stamped() } }),
  'POST /v1/taps/:eventId/unlock': (w) => ({ url: `/v1/taps/${w.tapId}/unlock`, body: stamped() }),
  'PATCH /v1/unlocks/:eventId': (w) => ({
    url: `/v1/unlocks/${w.unlockId}`,
    body: { reason: 'nurse', eventId: randomUUID() },
  }),
  'GET /v1/join-codes/:code': (w) => ({ url: `/v1/join-codes/${w.klass.joinCode}` }),
  'POST /v1/enrollments': (w) => ({
    url: '/v1/enrollments',
    body: { joinCode: w.klass.joinCode, ...stamped() },
  }),
  'DELETE /v1/enrollments/:id': async (w) => {
    // Never while the class is in session (A19): over, the student may leave.
    await endSession(db, { sessionId: w.sessionId, at: new Date(), reason: 'ended' });
    return { url: `/v1/enrollments/${w.enrollmentId}`, body: { eventId: randomUUID() } };
  },
  'POST /v1/classes': () => ({ url: '/v1/classes', body: { name: 'Period 2' } }),
  'GET /v1/classes/:id': (w) => ({ url: `/v1/classes/${w.klass.id}` }),
  'PATCH /v1/classes/:id': (w) => ({ url: `/v1/classes/${w.klass.id}`, body: { name: 'Renamed' } }),
  'GET /v1/classes/:id/roster': (w) => ({ url: `/v1/classes/${w.klass.id}/roster` }),
  'POST /v1/classes/:id/sessions': (w) => ({
    url: `/v1/classes/${w.klass.id}/sessions`,
    body: { durationMinutes: 25 },
  }),
  // The owner's own tag: theirs again, the retry of a lost answer. Another
  // teacher's claim on it is the API's 409 for a tag another teacher's live
  // block holds — how a block is never taken over, so it is this row's refusal.
  'POST /v1/blocks': (w) => ({ url: '/v1/blocks', body: { tagId: w.block.tagId } }),
  'GET /v1/sessions/:id': (w) => ({ url: `/v1/sessions/${w.sessionId}` }),
  'GET /v1/sessions/:id/events': (w) => ({ url: `/v1/sessions/${w.sessionId}/events` }),
  'GET /v1/sessions/:id/stream': (w) => ({
    url: `/v1/sessions/${w.sessionId}/stream`,
    stream: true,
  }),
  'POST /v1/sessions/:id/end': (w) => ({ url: `/v1/sessions/${w.sessionId}/end` }),
  'POST /v1/sessions/:id/extend': (w) => ({
    url: `/v1/sessions/${w.sessionId}/extend`,
    body: { durationMinutes: 5, eventId: randomUUID() },
  }),
  'POST /v1/sessions/:id/checkin': (w) => ({
    url: `/v1/sessions/${w.sessionId}/checkin`,
    body: { deviceTime: new Date().toISOString() },
  }),
  'POST /v1/sessions/:id/unlock': (w) => ({
    url: `/v1/sessions/${w.sessionId}/unlock`,
    body: stamped(),
  }),
  'POST /v1/sessions/:id/refocus': (w) => ({
    url: `/v1/sessions/${w.sessionId}/refocus`,
    body: stamped(),
  }),
  'POST /v1/sessions/:id/protection-off': (w) => ({
    url: `/v1/sessions/${w.sessionId}/protection-off`,
    body: stamped(),
  }),
  'POST /v1/sessions/:id/protection-on': async (w) => {
    // Screen Time back on needs it off first (#167): the student's own report.
    await protectionOff(db, {
      sessionId: w.sessionId,
      studentId: w.student.id,
      eventId: randomUUID(),
      deviceTime: new Date(),
    });
    return { url: `/v1/sessions/${w.sessionId}/protection-on`, body: stamped() };
  },
};

/** The matrix's key for `route`: a HEAD is its GET's. */
const keyOf = (route: Pick<RouteOptions, 'method' | 'url'>) =>
  `${route.method === 'HEAD' ? 'GET' : String(route.method)} ${route.url}`;

/**
 * The guard: each registered route the matrix has no row for — or a row that
 * doesn't answer every caller the route can meet, or no callers known where
 * it lives — named as Fastify has it.
 */
function unlisted(
  routes: readonly RouteOptions[],
  matrix: Record<string, readonly number[] | undefined> = MATRIX,
): string[] {
  return routes
    .filter((route) => {
      const callers = callersOf(route.url);
      return !callers || matrix[keyOf(route)]?.length !== callers.length;
    })
    .map((route) => `${String(route.method)} ${route.url}`);
}

/**
 * What a 2xx to a stranger never names: the world's own ids — and its class,
 * unless the request carries the class's join code, which opens it (the
 * preview and the join answer with the class).
 */
function hidden(w: World, sent: Sent): string[] {
  const ids = [
    w.sessionId,
    w.student.id,
    w.enrollmentId,
    w.tapId,
    w.unlockId,
    w.owner.id,
    w.block.id,
  ];
  return JSON.stringify(sent).includes(w.klass.joinCode) ? ids : [...ids, w.klass.id];
}

/** The headers `caller` sends in world `w`. */
async function headersFor(caller: Caller, w: World): Promise<Record<string, string>> {
  const bearer = async (sub: string, clientId?: string) => ({
    authorization: `Bearer ${await issuer.sign({ sub, clientId })}`,
  });
  switch (caller) {
    case 'another app':
      return bearer(w.owner.cognitoId, 'another-app-client-id');
    case 'student':
      return bearer(w.student.cognitoId);
    case 'another student':
      return bearer(w.otherStudent.cognitoId);
    case 'another teacher':
      return bearer(w.otherTeacher.cognitoId);
    case 'owner':
      return bearer(w.owner.cognitoId);
    case 'a wrong key':
      return { 'x-internal-key': 'not-the-internal-key-0123456789' };
    case 'the right key':
      return { 'x-internal-key': testEnv.INTERNAL_API_KEY };
    default:
      return {};
  }
}

let db: Database;
let closeDb: () => Promise<void>;
let issuer: TestIssuer;
let app: FastifyInstance;
let worlds = 0;

beforeAll(async () => {
  ({ db, close: closeDb } = await makeTestDb());
  issuer = await makeTestIssuer();
  // Quiet timers: the owner's stream stays open until the app closes.
  const stream = { repollMs: 60_000, heartbeatMs: 60_000 };
  app = buildApp(testEnv, { db, verifyToken: issuer.verifier, stream });
});

afterAll(async () => {
  await app.close();
  await closeDb();
});

/** A fresh world: the owner's classroom, its session running with its student in it, and another classroom. */
async function world(): Promise<World> {
  const tag = `authz-${(worlds += 1)}`;
  const mine = await seedClassroom(db, tag);
  const theirs = await seedClassroom(db, `${tag}-elsewhere`);
  const { session } = await startSession(db, {
    classId: mine.klass.id,
    startedAt: new Date(Date.now() - 60_000),
    endsAt: new Date(Date.now() + 25 * 60_000),
  });
  const own = { sessionId: session.id, studentId: mine.student.id };
  const tapId = randomUUID();
  const unlockId = randomUUID();
  await tapIn(db, { ...own, eventId: tapId, deviceTime: new Date() });
  await unlock(db, { ...own, eventId: unlockId, deviceTime: new Date() });
  const [enrollment] = await db
    .select({ id: enrollments.id })
    .from(enrollments)
    .where(eq(enrollments.studentId, mine.student.id));
  return {
    owner: mine.teacher,
    student: mine.student,
    otherTeacher: theirs.teacher,
    otherStudent: theirs.student,
    klass: mine.klass,
    block: mine.block,
    enrollmentId: enrollment!.id,
    sessionId: session.id,
    tapId,
    unlockId,
  };
}

// The app's real route table, read before the tests are declared: one test per route and caller.
const routes = await routeTable();

describe('the guard', () => {
  it('has a row for every route the app registers, answering every caller it can meet', () => {
    expect(
      unlisted(routes),
      'add each route’s authorization rows to MATRIX — and a route outside /v1, /internal/* and /healthz its callers to callersOf first',
    ).toEqual([]);
    const registered = new Set(routes.map(keyOf));
    const stale = Object.keys(MATRIX).filter((key) => !registered.has(key));
    expect(stale, 'a row for a route the app no longer registers').toEqual([]);
  });

  it('fails a route added without a row, and a /v1 row short of its six callers', () => {
    const added: RouteOptions = { method: 'POST', url: '/v1/new', handler: () => ({}) };
    expect(unlisted([...routes, added])).toEqual(['POST /v1/new']);
    expect(unlisted(routes, { ...MATRIX, 'GET /v1/me': [200] })).toEqual([
      'GET /v1/me',
      'HEAD /v1/me',
    ]);
  });

  it('fails a route outside /v1, /internal/* and /healthz, whatever its row', () => {
    const outside = ['/v2/me', '/healthz/db', '/internals/sweep', '/v1'].map(
      (url): RouteOptions => ({ method: 'GET', url, handler: () => ({}) }),
    );
    const rows = (status: number[]) =>
      Object.fromEntries(outside.map((route) => [keyOf(route), status]));
    const named = outside.map((route) => `GET ${route.url}`);
    // As public as /healthz, or with no callers at all: neither passes.
    expect(unlisted(outside, rows([200]))).toEqual(named);
    expect(unlisted(outside, rows([]))).toEqual(named);
  });
});

// A route with a row registers one method and lives where its callers are known
// (`unlisted` names any other).
describe.each(routes.filter((route) => unlisted([route]).length === 0))('$method $url', (route) => {
  const key = keyOf(route) as RouteKey;
  const rows = callersOf(route.url)!.map((caller, i) => ({ caller, status: MATRIX[key][i]! }));

  it.each(rows)('$caller → $status', async ({ caller, status }) => {
    const w = await world();
    const sent = await REQUESTS[key](w);
    const res = await app.inject({
      method: route.method as InjectOptions['method'],
      url: sent.url,
      headers: await headersFor(caller, w),
      payload: sent.body,
      // A stream's answer never ends: read its head, and let the app's close end it.
      payloadAsStream: sent.stream,
    });
    expect(res.statusCode).toBe(status);
    if (STRANGERS.has(caller) && status < 300 && !sent.stream) {
      for (const id of hidden(w, sent)) {
        expect(res.body, `${caller} is shown ${id}`).not.toContain(id);
      }
    }
  });
});
