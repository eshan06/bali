import { type Database, endSession, enrollments, startSession, tapIn, users } from '@bali/db';
import {
  API_ERROR_REASONS,
  type ApiErrorBody,
  CHECK_IN_STATUSES,
  END_ENROLLMENT_OUTCOMES,
  ENROLLMENT_JOIN_OUTCOMES,
  HISTORY_EVENT_TYPES,
  type HistoryPage,
  PROTECTION_OFF_OUTCOMES,
  REFOCUS_OUTCOMES,
  TAP_OUTCOMES,
  UNLOCK_RECORDED_AS,
  UNLOCK_RECORDED_OUTCOMES,
  UPDATE_ME_OUTCOMES,
} from '@bali/shared';
import { and, eq } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { type AuthedApp, makeAuthedApp } from './helpers/app.js';
import {
  DISPOSITIONS,
  ENDPOINTS,
  type Fixture,
  FIXTURES_DIR,
  jsonFiles,
  SCHEMAS,
  serialize,
  writeFixtures,
} from './helpers/contract.js';
import { makeTestDb, seedClassroom } from './helpers/db.js';

/*
 * The contract fixtures (Phase 3 · A5), as golden files: the API's real answer
 * to every request a student's phone makes, for each outcome it must decode,
 * captured here from the app in memory and checked in under
 * contracts/fixtures/ for BaliCore's contract tests (B1).
 *
 * This test fails when an answer drifts from its committed fixture, on both
 * lanes. `npm run fixtures` runs it with UPDATE_FIXTURES=1, which rewrites
 * them instead — and CI runs that too and fails on any diff, so the committed
 * tree is exactly what the generator writes. Either way, every answer must be
 * valid for its @bali/shared type and be the outcome its scenario names, so a
 * scenario that drifts fails rather than rewriting a fixture under a wrong name.
 */

const UPDATE = process.env.UPDATE_FIXTURES === '1';

/** Every fixture, by the file it is written to, and the scenario that produces it. */
const SCENARIOS: Record<string, string> = {
  'me/new-student': 'The boot call of a student signing in for the first time, in no class yet.',
  'me/no-session': 'The boot call of a student in a class, with no session running.',
  'me/in-session': 'The boot call of a student live in a running session.',
  'taps/armed': 'A tap while none of the teacher’s sessions runs: saved, waiting for Start.',
  'taps/already-armed': 'Another tap of the same block while the first still waits.',
  'taps/already-armed-retry':
    'The retry of a tap still waiting for Start (A4): it waits, like the answer it lost.',
  'taps/joined': 'A tap into a running session of a class the student is in.',
  'taps/switched':
    'A tap into another teacher’s running session while live in one: that participation ends.',
  'taps/replay': 'The retry of a tap that landed, its participation still live: names the session.',
  'taps/replay-no-session':
    'The retry of a tap whose session is over, reaching the next one (A4): recorded, no session.',
  'taps/400-bad-input': 'A malformed tap: its eventId is not a UUID.',
  'taps/401-unauthorized': 'A tap sent with no bearer token.',
  'taps/404-unknown-block': 'A tap of a tag that is not a registered block.',
  'taps/409-event-id-conflict': 'A tap under an id that another student’s tap already holds.',
  'checkin/live': 'The every-30-seconds check-in of a student live in the session.',
  'checkin/gone': 'A check-in with no live participation in the session.',
  'checkin/404-session-not-found': 'A check-in naming a session the server does not know.',
  'unlock/applied': 'An emergency unlock, with a reason, from a student live and focused.',
  'unlock/replay': 'The retry of an unlock that landed: the reason on record, not the retry’s.',
  'unlock/recorded-protection-off':
    'An unlock while protection is off: recorded, never softened into an unlock.',
  'unlock/recorded-no-live-participation':
    'An unlock after the student left the class: recorded all the same (ISSUES #2).',
  'unlock/recorded-after-session-end':
    'An unlock that first reaches the server after the session ended.',
  'unlock/recorded-unknown-session':
    'An unlock naming a session the server does not know: kept as an orphan record.',
  'unlock/recorded-not-enrolled':
    'An unlock from someone with no standing in the session: kept as an orphan record.',
  'unlock/recorded-superseded':
    'A late unlock (A10), stuck on the phone while the student’s own refocus went ahead of it: recorded, the focus left alone.',
  'unlock/409-event-id-conflict': 'An unlock under an id the student’s own tap holds (a bug).',
  'refocus/applied': 'Back to focus after an unlock.',
  'refocus/replay': 'The retry of a refocus that landed, the student still in the session.',
  'refocus/replay-no-session':
    'The retry of a refocus that landed, after the student left (A4): recorded, no session.',
  'refocus/409-protection-off': 'A refocus while protection is off: only a re-tap returns.',
  'refocus/409-not-participating': 'A refocus with no live participation in the session.',
  'refocus/409-session-not-running': 'A refocus after the session ended.',
  'protection-off/applied': 'The phone found its Screen Time permission revoked.',
  'protection-off/replay': 'The retry of a protection-off report that landed, the session running.',
  'protection-off/recorded':
    'A protection-off report first reaching the server after the session ended (A2c): no session.',
  'protection-off/recorded-replay': 'The retry of that late report: still no session.',
  'enrollments/joined': 'A student joins a class by its code.',
  'enrollments/already-enrolled': 'Joining a class the student is already in: a no-op.',
  'enrollments/404-class-not-found': 'A join code no class has.',
  'enrollments/left': 'A student leaves their class mid-session: the participation ends too.',
  'enrollments/already-removed': 'Leaving the class again: a no-op.',
  'enrollments/403-enrollment-not-yours': 'A student trying to remove a classmate’s enrollment.',
  'enrollments/403-unknown-user': 'Leaving by someone the server has no account for yet.',
  'enrollments/404-enrollment-not-found': 'Leaving an enrollment the server does not know.',
  'join-codes/found':
    'A preview of a class’s code before joining it (A6): the class and its teacher.',
  'join-codes/unnamed-teacher':
    'A preview of a class whose teacher’s account carries no display name: “your teacher”.',
  'join-codes/already-enrolled': 'A preview of the code of a class the student is in already.',
  'join-codes/404-class-not-found': 'A preview of a join code no class has: the join’s refusal.',
  'join-codes/400-bad-input': 'A preview of an empty code.',
  'join-codes/401-unauthorized': 'A preview sent with no bearer token.',
  'history/every-kind':
    'A student’s own history (A7), newest first: every kind of moment it shows, one page.',
  'history/first-page': 'The newest three moments of that history, and the cursor to the next.',
  'history/next-page': 'The three moments after them, sent that cursor as `before`.',
  'history/empty': 'The history of someone signing in for the first time: nothing, and no row.',
  'history/400-bad-cursor':
    'A history page before an event this history does not hold: reload from the top.',
  'history/400-bad-limit': 'A history page of no moments at all: a malformed query, a client bug.',
  'history/401-unauthorized': 'A history asked for with no bearer token.',
  'name/applied': 'A student sets their own display name (A8), stored trimmed.',
  'name/replay': 'The retry of that rename, after a later one: the name now, not the retry’s.',
  'name/409-display-name-taken':
    'A name a classmate in a shared class uses, in another case and spacing (owner decision 8).',
  'name/400-display-name-invalid': 'A name of nothing but spaces: blank.',
  'name/400-invalid-request': 'A rename whose eventId is not a UUID: a client bug.',
  'name/401-unauthorized': 'A rename sent with no bearer token.',
  'name/403-teacher': 'A teacher setting their name: not here — the ruling is about students.',
};

interface Call {
  /** A bearer token, or null to send none. */
  as: string | null;
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  path: string;
  body?: object;
}
/**
 * The phone's clock, fixed: the server clamps it into the session's window
 * anyway, and a fixed value can never share a millisecond with a time the
 * server stamps — stand-ins are numbered by value, so that would renumber one.
 */
const deviceTime = '2026-01-01T09:00:00.000Z';
const get = (as: string, path: string): Call => ({ as, method: 'GET', path });
const del = (as: string, path: string): Call => ({ as, method: 'DELETE', path });
const post = (as: string, path: string, body: object): Call => ({ as, method: 'POST', path, body });
const tap = (as: string, tagId: string, eventId: string = randomUUID()) =>
  post(as, '/v1/taps', { tagId, eventId, deviceTime });
/** An unlock, refocus or protection-off report — under a fresh id unless given one. */
const change = (as: string, sessionId: string, route: string, eventId = randomUUID(), extra = {}) =>
  post(as, `/v1/sessions/${sessionId}/${route}`, { eventId, deviceTime, ...extra });
const checkin = (as: string, sessionId: string) =>
  post(as, `/v1/sessions/${sessionId}/checkin`, { deviceTime });

let db: Database;
let closeDb: () => Promise<void>;
let ctx: AuthedApp;
/** What this run captured, by name. */
const fixtures = new Map<string, Fixture>();

async function send(call: Call) {
  const res = await ctx.app.inject({
    method: call.method,
    url: call.path,
    headers: call.as === null ? {} : { authorization: `Bearer ${call.as}` },
    payload: call.body,
  });
  return { status: res.statusCode, body: res.json<Record<string, unknown>>() };
}

/**
 * Send `call`, check it is answered `status` with `expected` in its body (in
 * its `error`, for a refusal) and valid for its type, and keep it as `name`.
 */
async function capture(
  name: string,
  call: Call,
  status: number,
  expected: Record<string, unknown> = {},
) {
  const scenario = SCENARIOS[name];
  const endpoint = `${call.method} ${routeOf(call.path)}`;
  const contract = ENDPOINTS[endpoint];
  if (scenario === undefined || contract === undefined) throw new Error(`${name}: unknown`);
  const res = await send(call);
  if (res.status !== status) throw new Error(`${name}: answered ${res.status}, not ${status}`);
  const type = res.status < 300 ? contract.type : 'ApiErrorBody';
  const checked = SCHEMAS[type].safeParse(res.body);
  if (!checked.success) throw new Error(`${name}: not a ${type}: ${checked.error.message}`);
  const got = (type === 'ApiErrorBody' ? res.body.error : res.body) as Record<string, unknown>;
  for (const [key, want] of Object.entries(expected)) {
    const value = got[key];
    if (value !== want) throw new Error(`${name}: ${key} is ${String(value)}, not ${String(want)}`);
  }
  const disposition = contract.outbox && DISPOSITIONS[contract.outbox](res.status, res.body);
  fixtures.set(name, {
    endpoint,
    scenario,
    request: { path: call.path, ...(call.body && { body: call.body }) },
    status: res.status,
    type,
    body: res.body,
    ...(disposition && { disposition }),
  });
}

/** The route a path is for: its ids, and a join code, become their parameter's name. */
function routeOf(path: string) {
  const ids = path.split('?')[0]!.replace(/[0-9a-f-]{36}/g, '{id}');
  return ids.replace(/^\/v1\/join-codes\/[^/]*$/, '/v1/join-codes/{code}');
}

/** A step that sets a scenario up: it must succeed, and it is no fixture. */
async function setup(call: Call) {
  const res = await send(call);
  if (res.status !== 200) throw new Error(`setup ${call.path} answered ${res.status}`);
}

async function start(classId: string) {
  const at = Date.now();
  const window = { startedAt: new Date(at - 60_000), endsAt: new Date(at + 25 * 60_000) };
  return (await startSession(db, { classId, ...window })).session;
}
const end = (sessionId: string) => endSession(db, { sessionId, at: new Date(), reason: 'ended' });
async function enrollmentOf(classId: string, studentId: string) {
  const [row] = await db
    .select({ id: enrollments.id })
    .from(enrollments)
    .where(and(eq(enrollments.classId, classId), eq(enrollments.studentId, studentId)));
  if (!row) throw new Error('expected an enrollment');
  return row.id;
}
const token = (sub: string, name?: string) =>
  ctx.issuer.sign({ sub, ...(name === undefined ? {} : { extraClaims: { name } }) });

/** Every scenario, in order: later ones build on the state earlier ones leave. */
async function captureAll() {
  // Someone signing in for the first time, in no class.
  const newcomer = await token('student-fx-newcomer');
  await capture('me/new-student', get(newcomer, '/v1/me'), 200, { session: null });

  // Taps before the teacher starts (decision 5).
  const arm = await seedClassroom(db, 'fx-arm');
  const armer = await token(arm.student.cognitoId);
  const waiting = randomUUID();
  await capture('taps/armed', tap(armer, arm.block.tagId, waiting), 200, { outcome: 'armed' });
  const again = { outcome: 'already_armed' };
  await capture('taps/already-armed', tap(armer, arm.block.tagId), 200, again);
  await capture('taps/already-armed-retry', tap(armer, arm.block.tagId, waiting), 200, again);
  const named = await token(arm.student.cognitoId, 'Ana');
  await capture('me/no-session', get(named, '/v1/me'), 200, { session: null });

  // A switch between two teachers' running sessions (decision 4).
  const from = await seedClassroom(db, 'fx-switch-from');
  const to = await seedClassroom(db, 'fx-switch-to');
  await db.insert(enrollments).values({ classId: to.klass.id, studentId: from.student.id });
  await start(from.klass.id);
  await start(to.klass.id);
  const mover = await token(from.student.cognitoId);
  await capture('taps/joined', tap(mover, from.block.tagId), 200, { outcome: 'joined' });
  await capture('taps/switched', tap(mover, to.block.tagId), 200, { outcome: 'switched' });

  // One student's lesson in one session, to its end and past it.
  const c = await seedClassroom(db, 'fx');
  const s = await start(c.klass.id);
  const ana = await token(c.student.cognitoId);
  const landed = randomUUID();
  await setup(tap(ana, c.block.tagId, landed));
  await capture('taps/replay', tap(ana, c.block.tagId, landed), 200, { outcome: 'replay' });
  await capture('me/in-session', get(ana, '/v1/me'), 200);
  await capture('checkin/live', checkin(ana, s.id), 200, { status: 'live' });
  const unlocked = randomUUID();
  const bathroom = change(ana, s.id, 'unlock', unlocked, { reason: 'bathroom' });
  await capture('unlock/applied', bathroom, 200, { outcome: 'applied' });
  const nurse = change(ana, s.id, 'unlock', unlocked, { reason: 'nurse' });
  await capture('unlock/replay', nurse, 200, { outcome: 'replay', reason: 'bathroom' });
  const refocus = change(ana, s.id, 'refocus');
  await capture('refocus/applied', refocus, 200, { outcome: 'applied' });
  await capture('refocus/replay', refocus, 200, { outcome: 'replay' });
  const report = change(ana, s.id, 'protection-off');
  await capture('protection-off/applied', report, 200, { outcome: 'applied' });
  await capture('protection-off/replay', report, 200, { outcome: 'replay' });
  const off = { reason: 'protection_off' };
  await capture('refocus/409-protection-off', change(ana, s.id, 'refocus'), 409, off);
  const noted = { outcome: 'recorded', recordedAs: 'protection_off' };
  await capture('unlock/recorded-protection-off', change(ana, s.id, 'unlock'), 200, noted);
  const spent = { reason: 'event_id_conflict' };
  await capture('unlock/409-event-id-conflict', change(ana, s.id, 'unlock', landed), 409, spent);
  await capture('taps/409-event-id-conflict', tap(newcomer, c.block.tagId, landed), 409, spent);
  const orphan = { outcome: 'recorded', recordedAs: 'not_enrolled' };
  await capture('unlock/recorded-not-enrolled', change(newcomer, s.id, 'unlock'), 200, orphan);

  const leave = del(ana, `/v1/enrollments/${await enrollmentOf(c.klass.id, c.student.id)}`);
  await capture('enrollments/left', leave, 200, { outcome: 'ended' });
  await capture('enrollments/already-removed', leave, 200, { outcome: 'already_removed' });
  const gone = { outcome: 'replay', session: null };
  await capture('refocus/replay-no-session', refocus, 200, gone);
  await capture('checkin/gone', checkin(ana, s.id), 200, { status: 'gone' });
  const out = { reason: 'not_participating' };
  await capture('refocus/409-not-participating', change(ana, s.id, 'refocus'), 409, out);
  const left = { outcome: 'recorded', recordedAs: 'no_live_participation' };
  await capture('unlock/recorded-no-live-participation', change(ana, s.id, 'unlock'), 200, left);

  await end(s.id);
  const over = { reason: 'session_not_running' };
  await capture('refocus/409-session-not-running', change(ana, s.id, 'refocus'), 409, over);
  const late = { outcome: 'recorded', recordedAs: 'after_session_end' };
  await capture('unlock/recorded-after-session-end', change(ana, s.id, 'unlock'), 200, late);
  const unknown = randomUUID();
  const lost = { outcome: 'recorded', recordedAs: 'unknown_session' };
  await capture('unlock/recorded-unknown-session', change(ana, unknown, 'unlock'), 200, lost);
  const missing = { reason: 'session_not_found' };
  await capture('checkin/404-session-not-found', checkin(ana, unknown), 404, missing);

  // A tap retried once its session is over, reaching the class's next one (A4).
  const next = await seedClassroom(db, 'fx-next');
  const period1 = await start(next.klass.id);
  const ben = await token(next.student.cognitoId);
  const first = tap(ben, next.block.tagId);
  await setup(first);
  await end(period1.id);
  await start(next.klass.id);
  await capture('taps/replay-no-session', first, 200, gone);

  // A protection-off report that first reaches the server after the bell (A2c).
  const after = await seedClassroom(db, 'fx-after');
  const lesson = await start(after.klass.id);
  const cal = await token(after.student.cognitoId);
  await setup(tap(cal, after.block.tagId));
  await end(lesson.id);
  const lateReport = change(cal, lesson.id, 'protection-off');
  await capture('protection-off/recorded', lateReport, 200, { outcome: 'recorded' });
  await capture('protection-off/recorded-replay', lateReport, 200, { outcome: 'replay' });

  // An unlock stuck on the phone while the student's own refocus went ahead of
  // it (A10), on a fixed window, so the times sent are the times that order.
  const stuck = await seedClassroom(db, 'fx-late');
  const lessonAt = (hhmm: string) => ({ deviceTime: `2026-01-05T${hhmm}:00.000Z` });
  const period = (
    await startSession(db, {
      classId: stuck.klass.id,
      startedAt: new Date(lessonAt('13:00').deviceTime),
      endsAt: new Date(lessonAt('13:50').deviceTime),
    })
  ).session;
  const dan = await token(stuck.student.cognitoId);
  const tapIt = { tagId: stuck.block.tagId, eventId: randomUUID(), ...lessonAt('13:01') };
  await setup(post(dan, '/v1/taps', tapIt));
  const newer = { reason: 'bathroom', ...lessonAt('13:05') };
  await setup(change(dan, period.id, 'unlock', randomUUID(), newer));
  await setup(change(dan, period.id, 'refocus', randomUUID(), lessonAt('13:08')));
  const older = change(dan, period.id, 'unlock', randomUUID(), {
    reason: 'nurse',
    ...lessonAt('13:03'),
  });
  const passed = { outcome: 'recorded', recordedAs: 'superseded', state: 'focused' };
  await capture('unlock/recorded-superseded', older, 200, passed);

  // Previewing a code, then joining and leaving by it (A6, auth decision 3).
  const room = await seedClassroom(db, 'fx-enroll');
  await db.update(users).set({ displayName: 'Ms. Rivera' }).where(eq(users.id, room.teacher.id));
  const preview = (code: string, as: string | null = newcomer): Call => ({
    as,
    method: 'GET',
    path: `/v1/join-codes/${code}`,
  });
  const outside = { alreadyEnrolled: false };
  await capture('join-codes/found', preview(room.klass.joinCode), 200, outside);
  await capture('join-codes/unnamed-teacher', preview(arm.klass.joinCode), 200, outside);
  const byCode = (joinCode: string) =>
    post(newcomer, '/v1/enrollments', { joinCode, eventId: randomUUID(), deviceTime });
  await capture('enrollments/joined', byCode(room.klass.joinCode), 200, { outcome: 'joined' });
  const inside = { alreadyEnrolled: true };
  await capture('join-codes/already-enrolled', preview(room.klass.joinCode), 200, inside);
  const already = { outcome: 'already_enrolled' };
  await capture('enrollments/already-enrolled', byCode(room.klass.joinCode), 200, already);
  const noClass = { reason: 'class_not_found' };
  // A code's length, but no class can hold it: an O is never minted.
  await capture('join-codes/404-class-not-found', preview('NOCODE'), 404, noClass);
  await capture('enrollments/404-class-not-found', byCode('NOCODE'), 404, noClass);
  await capture('join-codes/400-bad-input', preview(''), 400, { code: 'bad_input' });
  const anonymousPreview = preview(room.klass.joinCode, null);
  await capture('join-codes/401-unauthorized', anonymousPreview, 401, { code: 'unauthorized' });
  const theirs = del(
    newcomer,
    `/v1/enrollments/${await enrollmentOf(room.klass.id, room.student.id)}`,
  );
  const notYours = { reason: 'enrollment_not_yours' };
  await capture('enrollments/403-enrollment-not-yours', theirs, 403, notYours);
  const stranger = { ...theirs, as: await token('student-fx-stranger') };
  await capture('enrollments/403-unknown-user', stranger, 403, { reason: 'unknown_user' });
  const nobody = del(newcomer, `/v1/enrollments/${randomUUID()}`);
  const noEnrollment = { reason: 'enrollment_not_found' };
  await capture('enrollments/404-enrollment-not-found', nobody, 404, noEnrollment);

  // A malformed tap, one with no token, and one of no registered block.
  const bad = post(newcomer, '/v1/taps', { tagId: 'TAG-fx', eventId: 'x', deviceTime });
  await capture('taps/400-bad-input', bad, 400, { code: 'bad_input' });
  const anonymous = { ...tap(newcomer, 'TAG-fx'), as: null };
  await capture('taps/401-unauthorized', anonymous, 401, { code: 'unauthorized' });
  await capture('taps/404-unknown-block', tap(newcomer, 'NOT-A-BLOCK'), 404, { code: 'not_found' });

  // One student's day across three classes (A7), on fixed windows, so every
  // time in the history is one this chose: every kind of moment it shows.
  const day = (hhmm: string) => `2026-01-05T${hhmm}:00.000Z`;
  const startAt = async (classId: string, from: string, to: string) =>
    (await startSession(db, { classId, startedAt: new Date(day(from)), endsAt: new Date(day(to)) }))
      .session;
  const endAt = (sessionId: string, time: string, reason: 'ended' | 'expired') =>
    endSession(db, { sessionId, at: new Date(day(time)), reason });
  const p3 = await seedClassroom(db, 'fx-hist-p3');
  const p5 = await seedClassroom(db, 'fx-hist-p5');
  const p6 = await seedClassroom(db, 'fx-hist-p6');
  await db.update(users).set({ displayName: 'Ms. Rivera' }).where(eq(users.id, p3.teacher.id));
  await db.update(users).set({ displayName: 'Mr. Okafor' }).where(eq(users.id, p5.teacher.id));
  const dee = p3.student;
  await db.insert(enrollments).values([
    { classId: p5.klass.id, studentId: dee.id },
    { classId: p6.klass.id, studentId: dee.id },
  ]);
  const her = await token(dee.cognitoId);
  const tapAt = (tagId: string, time: string, eventId = randomUUID()) =>
    post(her, '/v1/taps', { tagId, eventId, deviceTime: day(time) });
  const at = (time: string) => ({ deviceTime: day(time) });
  // Period 3: a lesson, then an unlock and a protection off that first reach
  // the server after its bell.
  const sA = await startAt(p3.klass.id, '09:00', '09:50');
  await setup(tapAt(p3.block.tagId, '09:01'));
  await setup(change(her, sA.id, 'unlock', randomUUID(), { reason: 'bathroom', ...at('09:10') }));
  await setup(change(her, sA.id, 'refocus', randomUUID(), at('09:14')));
  await setup(change(her, sA.id, 'protection-off', randomUUID(), at('09:20')));
  await setup(tapAt(p3.block.tagId, '09:22'));
  await endAt(sA.id, '09:50', 'expired');
  await setup(change(her, sA.id, 'unlock', randomUUID(), at('09:55')));
  await setup(change(her, sA.id, 'protection-off', randomUUID(), at('09:45')));
  // Periods 5 and 6 at once: she switches from one to the other, and 6 ends early.
  const sB = await startAt(p5.klass.id, '10:00', '10:50');
  const sC = await startAt(p6.klass.id, '10:00', '10:50');
  await setup(tapAt(p5.block.tagId, '10:05'));
  await setup(tapAt(p6.block.tagId, '10:30'));
  await endAt(sC.id, '10:40', 'ended');
  await endAt(sB.id, '10:50', 'expired');
  // A tap waiting at period 6's block whose retry lands in period 3 first:
  // period 6's next Start declines it.
  const retried = randomUUID();
  await setup(tapAt(p6.block.tagId, '10:45', retried));
  const sD = await startAt(p3.klass.id, '11:00', '11:50');
  const deviceTime11 = new Date(day('11:01'));
  await tapIn(db, {
    sessionId: sD.id,
    studentId: dee.id,
    eventId: retried,
    deviceTime: deviceTime11,
  });
  await startAt(p6.klass.id, '11:05', '11:50');
  // She leaves period 3 mid-lesson, is removed from period 5 mid-lesson, and
  // leaves period 6, whose lesson runs without her.
  await setup(del(her, `/v1/enrollments/${await enrollmentOf(p3.klass.id, dee.id)}`));
  await startAt(p5.klass.id, '12:00', '12:50');
  await setup(tapAt(p5.block.tagId, '12:01'));
  const okafor = await token(p5.teacher.cognitoId);
  await setup(del(okafor, `/v1/enrollments/${await enrollmentOf(p5.klass.id, dee.id)}`));
  await setup(del(her, `/v1/enrollments/${await enrollmentOf(p6.klass.id, dee.id)}`));

  const history = (as: string | null, query = ''): Call => ({
    as,
    method: 'GET',
    path: `/v1/me/history${query}`,
  });
  await capture('history/every-kind', history(her), 200, { nextBefore: null });
  await capture('history/first-page', history(her, '?limit=3'), 200);
  const cursor = bodyOf(fixtures.get('history/first-page')!).nextBefore as string;
  await capture('history/next-page', history(her, `?limit=3&before=${cursor}`), 200);
  const firstSignIn = await token('student-fx-hist-newcomer');
  await capture('history/empty', history(firstSignIn), 200, { nextBefore: null });
  const nowhere = history(her, `?before=${randomUUID()}`);
  await capture('history/400-bad-cursor', nowhere, 400, { reason: 'unknown_cursor' });
  const noLimit = history(her, '?limit=0');
  await capture('history/400-bad-limit', noLimit, 400, { reason: 'invalid_request' });
  await capture('history/401-unauthorized', history(null), 401, { code: 'unauthorized' });

  // A student names themselves (A8): unique within each class they are in
  // (owner decision 8), and idempotent on its id.
  const naming = await seedClassroom(db, 'fx-name');
  const [bea] = await db
    .insert(users)
    .values({ cognitoId: 'student-fx-name-bea', role: 'student', displayName: 'Bea Ortiz' })
    .returning();
  await db.insert(enrollments).values({ classId: naming.klass.id, studentId: bea!.id });
  const eve = await token(naming.student.cognitoId);
  const rename = (
    as: string | null,
    displayName: string,
    eventId: string = randomUUID(),
  ): Call => ({
    as,
    method: 'PATCH',
    path: '/v1/me',
    body: { displayName, eventId },
  });
  const setName = rename(eve, '  Eve   Park ');
  await capture('name/applied', setName, 200, { outcome: 'applied' });
  await setup(rename(eve, 'Eve P.'));
  await capture('name/replay', setName, 200, { outcome: 'replay' });
  const beasName = rename(eve, 'bea  ORTIZ');
  await capture('name/409-display-name-taken', beasName, 409, { reason: 'display_name_taken' });
  const blank = rename(eve, '   ');
  await capture('name/400-display-name-invalid', blank, 400, { reason: 'display_name_invalid' });
  const unkeyed = rename(eve, 'Eve', 'x');
  await capture('name/400-invalid-request', unkeyed, 400, { reason: 'invalid_request' });
  await capture('name/401-unauthorized', rename(null, 'Eve'), 401, { code: 'unauthorized' });
  const theTeacher = rename(await token(naming.teacher.cognitoId), 'Ms. Park');
  await capture('name/403-teacher', theTeacher, 403, { code: 'forbidden' });
}

beforeAll(async () => {
  ({ db, close: closeDb } = await makeTestDb());
  ctx = await makeAuthedApp(db);
  await captureAll();
}, 60_000);

afterAll(async () => {
  await ctx?.close();
  await closeDb?.();
});

const fileOf = (name: string) => join(FIXTURES_DIR, `${name}.json`);
/** A fixture's body, to read a field of. */
const bodyOf = (f: Fixture) => f.body as Record<string, unknown>;

describe('the contract fixtures (contracts/fixtures)', () => {
  it('are the answers the API gives today', async () => {
    expect([...fixtures.keys()].sort()).toEqual(Object.keys(SCENARIOS).sort());
    if (UPDATE) {
      await writeFixtures(FIXTURES_DIR, fixtures);
      return;
    }
    const committed = (await jsonFiles(FIXTURES_DIR)).map((file) => file.slice(0, -'.json'.length));
    // Only what a scenario writes: a stale file is a fixture of nothing.
    expect(committed.sort(), 'run npm run fixtures').toEqual([...fixtures.keys()].sort());
    for (const [name, fixture] of fixtures) {
      const onDisk = await readFile(fileOf(name), 'utf8');
      expect(onDisk, `${name} drifted: run npm run fixtures`).toBe(serialize(fixture));
    }
  });

  it('cover every outcome a phone decodes', () => {
    const all = [...fixtures.values()];
    const valuesOf = (type: string, key: string) =>
      new Set(all.filter((f) => f.type === type).map((f) => bodyOf(f)[key]));
    expect(valuesOf('TapResponse', 'outcome')).toEqual(new Set(TAP_OUTCOMES));
    expect(valuesOf('UnlockResponse', 'outcome')).toEqual(new Set(UNLOCK_RECORDED_OUTCOMES));
    expect(valuesOf('UnlockResponse', 'recordedAs')).toEqual(
      new Set([...UNLOCK_RECORDED_AS, null]),
    );
    expect(valuesOf('RefocusResponse', 'outcome')).toEqual(new Set(REFOCUS_OUTCOMES));
    expect(valuesOf('ProtectionOffResponse', 'outcome')).toEqual(new Set(PROTECTION_OFF_OUTCOMES));
    expect(valuesOf('CheckInResponse', 'status')).toEqual(new Set(CHECK_IN_STATUSES));
    expect(valuesOf('UpdateMeResponse', 'outcome')).toEqual(new Set(UPDATE_ME_OUTCOMES));
    const joins = valuesOf('EnrollmentJoinResponse', 'outcome');
    expect(joins).toEqual(new Set(ENROLLMENT_JOIN_OUTCOMES));
    const leaves = valuesOf('EndEnrollmentResponse', 'outcome');
    expect(leaves).toEqual(new Set(END_ENROLLMENT_OUTCOMES));
    const previews = valuesOf('JoinCodePreviewResponse', 'alreadyEnrolled');
    expect(previews).toEqual(new Set([true, false]));
    // A teacher with a name and one without: BaliCore decodes it as optional.
    const teachers = [...valuesOf('JoinCodePreviewResponse', 'teacher')] as {
      displayName: unknown;
    }[];
    expect(new Set(teachers.map((t) => t.displayName === null))).toEqual(new Set([true, false]));
    // Every kind of moment a history shows (A7) — the declined tap naming
    // where it counted, both late notes — and fields BaliCore decodes as
    // optional, present and absent; a page with a next and one without.
    const histories = all.filter((f) => f.type === 'HistoryPage');
    const moments = histories.flatMap((f) => (f.body as HistoryPage).events);
    expect(new Set(moments.map((e) => e.type))).toEqual(new Set(HISTORY_EVENT_TYPES));
    const late = moments.filter((e) => e.recordedAs === 'after_session_end').map((e) => e.type);
    expect(new Set(late)).toEqual(new Set(['unlock', 'protection_off']));
    const declined = moments.find((e) => e.type === 'armed_tap_skipped');
    expect(declined?.countedIn).not.toBeNull();
    for (const optional of [
      (e: (typeof moments)[number]) => e.session,
      (e: (typeof moments)[number]) => e.session?.endedAt ?? null,
      (e: (typeof moments)[number]) => e.teacher.displayName,
      (e: (typeof moments)[number]) => e.reason,
    ]) {
      expect(new Set(moments.map((e) => optional(e) === null))).toEqual(new Set([true, false]));
    }
    const next = new Set(histories.map((f) => bodyOf(f).nextBefore === null));
    expect(next).toEqual(new Set([true, false]));
    // A replay, and a boot call, with a session and without: the session, not
    // the outcome, gives a phone its window (A3, A4).
    for (const type of ['TapResponse', 'RefocusResponse', 'MeResponse']) {
      const answers = all.filter(
        (f) => f.type === type && (type === 'MeResponse' || bodyOf(f).outcome === 'replay'),
      );
      const named = new Set(answers.map((f) => bodyOf(f).session !== null));
      expect(named, type).toEqual(new Set([true, false]));
    }
    // Every refusal a phone can meet, by status and by reason: all but a
    // teacher's extend.
    const errors = all.filter((f) => f.type === 'ApiErrorBody');
    expect(new Set(errors.map((f) => f.status))).toEqual(new Set([400, 401, 403, 404, 409]));
    const reasons = errors.map((f) => (f.body as ApiErrorBody).error.reason).filter(Boolean);
    const phones = API_ERROR_REASONS.filter((reason) => reason !== 'invalid_extension');
    expect(new Set(reasons)).toEqual(new Set(phones));
  });

  it('are rewritten JSON only: a file kept beside them outlives a regenerate', async () => {
    // The drift check reconciles `*.json` alone, so the rewrite must clear
    // no more than that: it used to remove the whole directory, and a README
    // for BaliCore's authors would have gone with it, silently (#64's review).
    const dir = await mkdtemp(join(tmpdir(), 'bali-fixtures-'));
    try {
      await mkdir(join(dir, 'retired'));
      await writeFile(join(dir, 'retired', 'endpoint.json'), '{}\n');
      await writeFile(join(dir, 'README.md'), 'For BaliCore.\n');
      await writeFixtures(dir, new Map([['me/new-student', fixtures.get('me/new-student')!]]));
      expect(await readFile(join(dir, 'README.md'), 'utf8')).toBe('For BaliCore.\n');
      // A stale fixture is still a fixture of nothing, and goes.
      expect(await jsonFiles(dir)).toEqual([join('me', 'new-student.json')]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('refuse an answer its type does not describe', () => {
    const joined = bodyOf(fixtures.get('taps/joined')!);
    const schema = SCHEMAS.TapResponse;
    expect(schema.safeParse(joined).success).toBe(true);
    expect(schema.safeParse({ ...joined, extra: 1 }).success).toBe(false);
    expect(schema.safeParse({ ...joined, outcome: 'teleported' }).success).toBe(false);
    const withoutState = { ...joined };
    delete withoutState.state;
    expect(schema.safeParse(withoutState).success).toBe(false);
    const refused = { error: { code: 'conflict', message: 'no' } };
    expect(SCHEMAS.ApiErrorBody.safeParse(refused).success).toBe(true);
    const madeUp = { error: { ...refused.error, reason: 'made_up' } };
    expect(SCHEMAS.ApiErrorBody.safeParse(madeUp).success).toBe(false);
  });
});
