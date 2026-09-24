import {
  type Database,
  endSession,
  enrollments,
  events,
  extendSession,
  markSilentParticipations,
  startSession,
  tapIn,
  users,
} from '@bali/db';
import type { HistoryEvent, HistoryPage } from '@bali/shared';
import { and, eq, inArray, isNull } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { type AuthedApp, makeAuthedApp } from './helpers/app.js';
import { makeTestDb, seedClassroom } from './helpers/db.js';

/*
 * GET /v1/me/history (Phase 3 · A7) — the student's own timeline. Every
 * lesson here runs on one fixed day with fixed device times, so each moment's
 * time is one the test chose: the server clamps a device time into its
 * session's window (rule 1), and stamps its own clock only where it must.
 */

let db: Database;
let closeDb: () => Promise<void>;
let ctx: AuthedApp;

beforeAll(async () => {
  ({ db, close: closeDb } = await makeTestDb());
  ctx = await makeAuthedApp(db);
});

afterAll(async () => {
  await ctx?.close();
  await closeDb?.();
});

/** An instant on the test's school day. */
const at = (hhmm: string) => new Date(`2026-03-02T${hhmm}:00.000Z`);

async function startAt(classId: string, from: string, to: string) {
  return (await startSession(db, { classId, startedAt: at(from), endsAt: at(to) })).session;
}
const endAt = (sessionId: string, time: string, reason: 'ended' | 'expired') =>
  endSession(db, { sessionId, at: at(time), reason });

function send(method: 'GET' | 'POST' | 'DELETE', token: string | null, url: string, body?: object) {
  return ctx.app.inject({
    method,
    url,
    headers: token === null ? {} : { authorization: `Bearer ${token}` },
    payload: body,
  });
}
/** Send, and insist it succeeded: these are the steps that build a history. */
async function ok(response: ReturnType<typeof send>) {
  const res = await response;
  expect(res.statusCode, res.body).toBe(200);
  return res.json<Record<string, unknown>>();
}
const tap = (token: string, tagId: string, time: string, eventId: string = randomUUID()) =>
  send('POST', token, '/v1/taps', { tagId, eventId, deviceTime: at(time).toISOString() });
const change = (token: string, sessionId: string, route: string, time: string, extra = {}) =>
  send('POST', token, `/v1/sessions/${sessionId}/${route}`, {
    eventId: randomUUID(),
    deviceTime: at(time).toISOString(),
    ...extra,
  });
const leave = (token: string, enrollmentId: string) =>
  send('DELETE', token, `/v1/enrollments/${enrollmentId}`);
const history = (token: string | null, query = '') => send('GET', token, `/v1/me/history${query}`);

async function historyOf(token: string, query = ''): Promise<HistoryPage> {
  return (await ok(history(token, query))) as unknown as HistoryPage;
}

async function enrollmentOf(classId: string, studentId: string): Promise<string> {
  const [row] = await db
    .select({ id: enrollments.id })
    .from(enrollments)
    .where(
      and(
        eq(enrollments.classId, classId),
        eq(enrollments.studentId, studentId),
        isNull(enrollments.removedAt),
      ),
    );
  if (!row) throw new Error('expected an active enrollment');
  return row.id;
}

const nameTeacher = (id: string, displayName: string) =>
  db.update(users).set({ displayName }).where(eq(users.id, id));

/** A moment as one line: what, when (UTC hh:mm), where, and any note it carries. */
function line(e: HistoryEvent): string {
  const notes = [e.reason, e.recordedAs, e.countedIn && `counted in ${e.countedIn.name}`];
  return [e.type, e.occurredAt.slice(11, 16), e.class.name, ...notes].filter(Boolean).join(' ');
}

/** Every moment of a history, page by page, `limit` at a time. */
async function walk(token: string, limit: number): Promise<HistoryEvent[][]> {
  const pages: HistoryEvent[][] = [];
  let before: string | null = null;
  do {
    const query: string = `?limit=${limit}${before === null ? '' : `&before=${before}`}`;
    const page = await historyOf(token, query);
    pages.push(page.events);
    before = page.nextBefore;
  } while (before !== null);
  return pages;
}

/**
 * A student's day across three classes, holding every kind of moment the
 * history shows. Period 3 is a whole lesson, with an unlock, a refocus,
 * protection off and the re-tap back, then two records that first reach the
 * server after its bell; periods 5 and 6 run at once and the student switches
 * from one to the other, and 6 ends early; a tap of 6's block waits for Start
 * but its retry lands in period 3 first, so 6's next Start declines it; then
 * the student leaves period 3 mid-lesson and is removed from period 5.
 */
async function aDayOfClasses(tag: string) {
  const p3 = await seedClassroom(db, `${tag}-p3`);
  const p5 = await seedClassroom(db, `${tag}-p5`);
  const p6 = await seedClassroom(db, `${tag}-p6`);
  await nameTeacher(p3.teacher.id, 'Ms. Rivera');
  await nameTeacher(p5.teacher.id, 'Mr. Okafor');
  const ana = p3.student;
  await db.insert(enrollments).values([
    { classId: p5.klass.id, studentId: ana.id },
    { classId: p6.klass.id, studentId: ana.id },
  ]);
  const token = await ctx.tokenFor(ana.cognitoId);

  const a = await startAt(p3.klass.id, '09:00', '09:50');
  await ok(tap(token, p3.block.tagId, '09:01'));
  await ok(change(token, a.id, 'unlock', '09:10', { reason: 'bathroom' }));
  await ok(change(token, a.id, 'refocus', '09:14'));
  await ok(change(token, a.id, 'protection-off', '09:20'));
  await ok(tap(token, p3.block.tagId, '09:22'));
  await endAt(a.id, '09:50', 'expired');
  await ok(change(token, a.id, 'unlock', '09:55')); // clamped to the bell
  await ok(change(token, a.id, 'protection-off', '09:45'));

  const b = await startAt(p5.klass.id, '10:00', '10:50');
  const c = await startAt(p6.klass.id, '10:00', '10:50');
  await ok(tap(token, p5.block.tagId, '10:05'));
  expect((await ok(tap(token, p6.block.tagId, '10:30'))).outcome).toBe('switched');
  await endAt(c.id, '10:40', 'ended');
  await endAt(b.id, '10:50', 'expired');

  const spent = randomUUID();
  expect((await ok(tap(token, p6.block.tagId, '10:45', spent))).outcome).toBe('armed');
  const d = await startAt(p3.klass.id, '11:00', '11:50');
  await tapIn(db, { sessionId: d.id, studentId: ana.id, eventId: spent, deviceTime: at('11:01') });
  const e = await startAt(p6.klass.id, '11:05', '11:50');

  await ok(leave(token, await enrollmentOf(p3.klass.id, ana.id)));
  const f = await startAt(p5.klass.id, '12:00', '12:50');
  await ok(tap(token, p5.block.tagId, '12:01'));
  const okafor = await ctx.tokenFor(p5.teacher.cognitoId);
  await ok(leave(okafor, await enrollmentOf(p5.klass.id, ana.id)));

  return { p3, p5, p6, ana, token, sessions: { a, b, c, d, e, f } };
}

describe('GET /v1/me/history', () => {
  it('shows every kind of moment, newest first, each with its class and its note', async () => {
    const { token, p3, p5, p6, sessions } = await aDayOfClasses('h-day');
    const [c3, c5, c6] = [p3, p5, p6].map((p) => p.klass.name);

    const page = await historyOf(token);
    expect(page.nextBefore).toBeNull();
    expect(page.events.map(line)).toEqual([
      `enrollment_removed 12:50 ${c5}`,
      `tap_in 12:01 ${c5}`,
      `enrollment_left 11:50 ${c3}`,
      // A declined tap, never a join: it counted in period 3 already.
      `armed_tap_skipped 11:05 ${c6} counted in ${c3}`,
      `tap_in 11:01 ${c3}`,
      `session_ended 10:40 ${c6}`,
      // One instant, and the leave is the older of the two.
      `tap_in 10:30 ${c6}`,
      `left_for_other_session 10:30 ${c5}`,
      `tap_in 10:05 ${c5}`,
      // Both reached the server after the bell and say so; the unlock is
      // clamped to the bell and recorded after the class ended, so it is newer.
      `unlock 09:50 ${c3} after_session_end`,
      `session_expired 09:50 ${c3}`,
      `protection_off 09:45 ${c3} after_session_end`,
      `tap_in 09:22 ${c3}`,
      `protection_off 09:20 ${c3}`,
      `refocus 09:14 ${c3}`,
      `unlock 09:10 ${c3} bathroom`,
      `tap_in 09:01 ${c3}`,
    ]);

    // Period 5 ended at 10:50, after the student had left it: that end is not theirs.
    expect(page.events.filter((e) => e.session?.id === sessions.b.id).map((e) => e.type)).toEqual([
      'left_for_other_session',
      'tap_in',
    ]);

    const [removed, , left, skipped] = page.events;
    const { eventId: removal, ...rest } = removed!;
    expect(removal).toMatch(/^[0-9a-f-]{36}$/);
    expect(rest).toEqual({
      type: 'enrollment_removed',
      occurredAt: at('12:50').toISOString(),
      class: { id: p5.klass.id, name: c5 },
      teacher: { displayName: 'Mr. Okafor' },
      session: {
        id: sessions.f.id,
        startedAt: at('12:00').toISOString(),
        endsAt: at('12:50').toISOString(),
        endedAt: null,
      },
      reason: null,
      recordedAs: null,
      countedIn: null,
    });
    expect(left!.teacher).toEqual({ displayName: 'Ms. Rivera' });
    expect(skipped).toMatchObject({
      class: { id: p6.klass.id, name: c6 },
      // Period 6's teacher never set a name.
      teacher: { displayName: null },
      session: { id: sessions.e.id, startedAt: at('11:05').toISOString() },
      countedIn: { id: p3.klass.id, name: c3 },
    });
    const ended = page.events.find((e) => e.type === 'session_ended')!;
    expect(ended.session).toEqual({
      id: sessions.c.id,
      startedAt: at('10:00').toISOString(),
      endsAt: at('10:50').toISOString(),
      endedAt: at('10:40').toISOString(),
    });
  });

  it('puts the leave before the join it causes at one instant, though its seq is higher', async () => {
    // A tap waiting at another teacher's block converts at their Start: the
    // engine mints the `tap_in` first (a skipped tap must never end a
    // participation), so by `seq` the student joins period 2 before leaving
    // period 1, and both rows carry one `occurred_at`.
    const one = await seedClassroom(db, 'h-pair-1');
    const two = await seedClassroom(db, 'h-pair-2');
    await db.insert(enrollments).values({ classId: two.klass.id, studentId: one.student.id });
    const token = await ctx.tokenFor(one.student.cognitoId);
    await startAt(one.klass.id, '09:00', '09:50');
    await ok(tap(token, one.block.tagId, '09:01'));
    expect((await ok(tap(token, two.block.tagId, '09:03'))).outcome).toBe('armed');
    const second = await startAt(two.klass.id, '09:05', '09:55');

    const stored = await db.select().from(events).where(eq(events.userId, one.student.id));
    const joined = stored.find((e) => e.type === 'tap_in' && e.sessionId === second.id)!;
    const leftFirst = stored.find((e) => e.type === 'left_for_other_session')!;
    expect(joined.seq).toBeLessThan(leftFirst.seq);
    expect(joined.occurredAt).toEqual(leftFirst.occurredAt);

    const page = await historyOf(token);
    expect(page.events.map(line)).toEqual([
      `tap_in 09:05 ${two.klass.name}`,
      `left_for_other_session 09:05 ${one.klass.name}`,
      `tap_in 09:01 ${one.klass.name}`,
    ]);
    // Paged one at a time, the tie still reads the same way round.
    expect((await walk(token, 1)).flat().map(line)).toEqual(page.events.map(line));
  });

  it('pages through the whole history, each moment once, at any page size', async () => {
    const { token } = await aDayOfClasses('h-walk');
    const all = (await historyOf(token)).events.map((e) => e.eventId);
    expect(all).toHaveLength(17);
    for (const limit of [1, 2, 5, 16, 17]) {
      const pages = await walk(token, limit);
      expect(pages.flat().map((e) => e.eventId)).toEqual(all);
      expect(pages.slice(0, -1).every((p) => p.length === limit)).toBe(true);
    }
  });

  it('keeps its place when moments are recorded between two pages', async () => {
    const room = await seedClassroom(db, 'h-cursor');
    const token = await ctx.tokenFor(room.student.cognitoId);
    const first = await startAt(room.klass.id, '09:00', '09:50');
    await ok(tap(token, room.block.tagId, '09:01'));
    await ok(change(token, first.id, 'unlock', '09:10'));
    await ok(change(token, first.id, 'refocus', '09:20'));
    await endAt(first.id, '09:50', 'ended');

    const top = await historyOf(token, '?limit=2');
    expect(top.events.map(line)).toEqual([
      `session_ended 09:50 ${room.klass.name}`,
      `refocus 09:20 ${room.klass.name}`,
    ]);
    expect(top.nextBefore).toBe(top.events[1]!.eventId);

    // A newer moment, and an older one: an unlock sent at 09:05 that first
    // reaches the server now, after the bell — recorded in its place.
    await startAt(room.klass.id, '10:00', '10:50');
    await ok(tap(token, room.block.tagId, '10:01'));
    await ok(change(token, first.id, 'unlock', '09:05'));

    const next = await historyOf(token, `?limit=2&before=${top.nextBefore}`);
    expect(next.events.map(line)).toEqual([
      `unlock 09:10 ${room.klass.name}`,
      `unlock 09:05 ${room.klass.name} after_session_end`,
    ]);
    const last = await historyOf(token, `?limit=2&before=${next.nextBefore}`);
    expect(last.events.map(line)).toEqual([`tap_in 09:01 ${room.klass.name}`]);
    expect(last.nextBefore).toBeNull();
    // The newer moment is at the top, for a reload to find.
    expect(line((await historyOf(token, '?limit=1')).events[0]!)).toBe(
      `tap_in 10:01 ${room.klass.name}`,
    );
  });

  it('shows only the caller’s own moments, never a classmate’s', async () => {
    const room = await seedClassroom(db, 'h-mine');
    const [bea] = await db
      .insert(users)
      .values({ cognitoId: 'student-h-mine-bea', role: 'student' })
      .returning();
    await db.insert(enrollments).values({ classId: room.klass.id, studentId: bea!.id });
    const ana = await ctx.tokenFor(room.student.cognitoId);
    const beaToken = await ctx.tokenFor(bea!.cognitoId);

    const lesson = await startAt(room.klass.id, '09:00', '09:50');
    await ok(tap(ana, room.block.tagId, '09:01'));
    await ok(tap(beaToken, room.block.tagId, '09:02'));
    await ok(change(beaToken, lesson.id, 'unlock', '09:03', { reason: 'nurse' }));
    await endAt(lesson.id, '09:40', 'ended');
    // After Bea's history is taken, Ana's leaves the class and is still whole.
    await ok(leave(ana, await enrollmentOf(room.klass.id, room.student.id)));

    const anas = (await historyOf(ana)).events;
    const beas = (await historyOf(beaToken)).events;
    expect(anas.map(line)).toEqual([
      expect.stringMatching(/^enrollment_left /),
      `session_ended 09:40 ${room.klass.name}`,
      `tap_in 09:01 ${room.klass.name}`,
    ]);
    expect(beas.map(line)).toEqual([
      `session_ended 09:40 ${room.klass.name}`,
      `unlock 09:03 ${room.klass.name} nurse`,
      `tap_in 09:02 ${room.klass.name}`,
    ]);
    // The class's end is one moment of the session, shown to each student in it.
    expect(anas[1]!.eventId).toBe(beas[0]!.eventId);

    // And another student's cursor is no place in this history.
    const res = await history(ana, `?before=${beas[1]!.eventId}`);
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({
      error: {
        code: 'bad_input',
        reason: 'unknown_cursor',
        message: 'before is not an event of this history',
      },
    });
  });

  it('a leave with no session running shows with no session', async () => {
    const room = await seedClassroom(db, 'h-sessionless');
    const token = await ctx.tokenFor(room.student.cognitoId);
    await ok(leave(token, await enrollmentOf(room.klass.id, room.student.id)));
    const [left] = (await historyOf(token)).events;
    expect(left).toMatchObject({ type: 'enrollment_left', session: null });
    expect(left!.class.id).toBe(room.klass.id);
  });

  it('leaves out what no teacher sees as a moment: silence, joining, orphan unlocks, the teacher’s own', async () => {
    const room = await seedClassroom(db, 'h-hidden');
    const other = await seedClassroom(db, 'h-hidden-other');
    const token = await ctx.tokenFor(room.student.cognitoId);
    // Joining a class is not shown…
    await ok(
      send('POST', token, '/v1/enrollments', {
        joinCode: other.klass.joinCode,
        eventId: randomUUID(),
        deviceTime: at('08:00').toISOString(),
      }),
    );
    const lesson = await startAt(room.klass.id, '09:00', '09:50');
    await ok(tap(token, room.block.tagId, '09:01'));
    // …nor a silence episode and its end…
    await markSilentParticipations(db, new Date(Date.now() + 5 * 60_000));
    const checkin = { deviceTime: at('09:30').toISOString() };
    await ok(send('POST', token, `/v1/sessions/${lesson.id}/checkin`, checkin));
    // …nor the teacher adding time…
    await extendSession(db, { sessionId: lesson.id, durationMinutes: 10, at: at('09:40') });
    // …nor an unlock kept with no class: an unknown session's, and a stranger's.
    await ok(change(token, randomUUID(), 'unlock', '09:31'));
    const outsider = await ctx.tokenFor(other.student.cognitoId);
    await ok(change(outsider, lesson.id, 'unlock', '09:32'));

    const stored = await db
      .select({ type: events.type })
      .from(events)
      .where(eq(events.userId, room.student.id));
    expect(new Set(stored.map((e) => e.type))).toEqual(
      new Set(['enrollment_joined', 'tap_in', 'went_silent', 'came_back', 'unlock']),
    );
    expect((await historyOf(token)).events.map(line)).toEqual([`tap_in 09:01 ${room.klass.name}`]);
    // The stranger's orphan is not theirs to see either.
    expect((await historyOf(outsider)).events).toEqual([]);
  });

  it('is empty for someone signing in for the first time, and creates no row', async () => {
    const token = await ctx.tokenFor('h-newcomer');
    expect(await historyOf(token)).toEqual({ events: [], nextBefore: null });
    expect(await db.select().from(users).where(eq(users.cognitoId, 'h-newcomer'))).toEqual([]);
    // No history holds a cursor for them yet.
    const res = await history(token, `?before=${randomUUID()}`);
    expect(res.statusCode).toBe(400);
    expect(res.json<{ error: { reason?: string } }>().error.reason).toBe('unknown_cursor');
  });

  it('refuses a limit it cannot honour and a cursor that is not an event of this history', async () => {
    const room = await seedClassroom(db, 'h-bad');
    const token = await ctx.tokenFor(room.student.cognitoId);
    await startAt(room.klass.id, '09:00', '09:50');
    await ok(tap(token, room.block.tagId, '09:01'));
    const joined = await ok(
      send('POST', token, '/v1/enrollments', {
        joinCode: (await seedClassroom(db, 'h-bad-2')).klass.joinCode,
        eventId: randomUUID(),
        deviceTime: at('09:02').toISOString(),
      }),
    );
    expect(joined.outcome).toBe('joined');
    await ok(change(token, randomUUID(), 'unlock', '09:03')); // an orphan: no class
    const hidden = await db
      .select({ eventId: events.eventId })
      .from(events)
      .where(
        and(
          eq(events.userId, room.student.id),
          inArray(events.type, ['enrollment_joined', 'unlock']),
        ),
      );
    expect(hidden).toHaveLength(2);

    // Two refusals under one status, told apart by their reason: a malformed
    // query is a client bug, a cursor this history does not hold means
    // "reload from the top".
    const refusals: [string, string][] = [
      ...['?limit=0', '?limit=51', '?limit=-1', '?limit=1.5', '?limit=ten', '?limit='].map(
        (query): [string, string] => [query, 'invalid_request'],
      ),
      ['?before=not-a-cursor', 'invalid_request'],
      [`?before=${randomUUID()}`, 'unknown_cursor'],
      // An event of theirs the history does not show is no place in it.
      ...hidden.map((e): [string, string] => [`?before=${e.eventId}`, 'unknown_cursor']),
    ];
    for (const [query, reason] of refusals) {
      const res = await history(token, query);
      expect(res.statusCode, query).toBe(400);
      expect(res.json<{ error: { code: string; reason?: string } }>().error, query).toMatchObject({
        code: 'bad_input',
        reason,
      });
    }
    expect((await historyOf(token, '?limit=50')).events).toHaveLength(1);
  });

  it('requires authentication', async () => {
    const res = await history(null);
    expect(res.statusCode).toBe(401);
  });

  it('is a student’s own: a teacher has none to read (403)', async () => {
    const room = await seedClassroom(db, 'h-teacher');
    await startAt(room.klass.id, '09:00', '09:50');
    const res = await history(await ctx.tokenFor(room.teacher.cognitoId));
    expect(res.statusCode).toBe(403);
    expect(res.json()).toEqual({
      error: { code: 'forbidden', message: 'a history is a student’s own timeline' },
    });
  });
});
