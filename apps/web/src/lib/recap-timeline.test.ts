import type {
  EventType,
  FeedEvent,
  ReportStudent,
  SessionReportResponse,
  SessionReportSummary,
  UnlockReason,
} from '@bali/shared';
import { EVENT_PAGE_LIMIT, UNLOCK_REASONS } from '@bali/shared';
import { describe, expect, it } from 'vitest';

import { NetworkError } from './api-client';
import { placement, readEvents, sessionTimeline } from './recap';

/*
 * The recap's timeline as data (PB5, the Recap & reports design): the session's events, every page
 * of them, as marks on each student's row at their times, on the session's own time. Marks only,
 * never a bar: no student's minutes.
 */

// A 25-minute lesson at 9:05 in New York, ended by the sweep at its bell.
const NY = { locale: 'en-US', timeZone: 'America/New_York' };
const SESSION: SessionReportSummary = {
  id: 's1',
  startedAt: '2026-10-04T13:05:00.000Z',
  endsAt: '2026-10-04T13:30:00.000Z',
  endedAt: '2026-10-04T13:30:00.000Z',
  ended: true,
  joinedCount: 4,
  focusMinutes: 83,
  averageFocusMinutes: 21,
  silentMinutes: 2,
  unlockCount: 4,
  protectionOffCount: 1,
};

const maya: ReportStudent = { id: '0199b0a1-0000-7000-8000-000000000001', displayName: 'Maya' };
const theo: ReportStudent = { id: '0199b0a1-0000-7000-8000-000000000002', displayName: 'Theo' };
const priya: ReportStudent = { id: '0199b0a1-0000-7000-8000-000000000003', displayName: 'Priya' };
const unnamed: ReportStudent = { id: '0199b0a1-ffff-7000-8000-000000000004', displayName: null };
// Unlocked without ever joining (no live participation): never left out of the recap.
const ines: ReportStudent = { id: '0199b0a1-0000-7000-8000-000000000005', displayName: 'Ines' };
const zed = '0199b0a1-0000-7000-8000-000000000006';

const at = (minute: number) => `2026-10-04T13:${String(minute).padStart(2, '0')}:00.000Z`;

const REPORT: SessionReportResponse = {
  ended: true,
  joined: [theo, maya, unnamed, priya],
  focusMinutes: 83,
  averageFocusMinutes: 21,
  silentMinutes: 2,
  unlocks: [
    // Sent as nurse, changed to bathroom since (A20): R2 says the reason now.
    { eventId: 'u1', student: maya, occurredAt: at(11), reason: 'bathroom', recordedAs: null },
    // Late (A10): it changed nothing, and is marked all the same.
    { eventId: 'u2', student: theo, occurredAt: at(18), reason: null, recordedAs: 'superseded' },
    // A newer build's reason, met mid-deploy.
    {
      eventId: 'u3',
      student: theo,
      occurredAt: at(24),
      reason: 'counselor' as UnlockReason,
      recordedAs: null,
    },
    { eventId: 'u4', student: ines, occurredAt: at(26), reason: 'nurse', recordedAs: null },
  ],
  protectionOffs: [{ eventId: 'p1', student: priya, occurredAt: at(22), recordedAs: null }],
};

let seq = 0;
function event(type: EventType, userId: string | null, minute: number, payload = {}): FeedEvent {
  seq += 1;
  return { seq, eventId: `e${seq}`, type, userId, occurredAt: at(minute), payload };
}
/** The lesson's feed, in seq order: what R2's report and the timeline both come from. */
const EVENTS: FeedEvent[] = [
  event('session_started', null, 5),
  event('tap_in', theo.id, 5),
  event('tap_in', maya.id, 6),
  event('tap_in', unnamed.id, 6),
  event('tap_in', priya.id, 7),
  // A tap a later one of the student's went ahead of (A14): no join, so no mark and no row.
  event('tap_in', zed, 8, { recorded_as: 'superseded' }),
  { ...event('unlock', maya.id, 11, { reason: 'nurse' }), eventId: 'u1' },
  event('unlock_reason_changed', maya.id, 12, { unlock_event_id: 'u1', reason: 'bathroom' }),
  event('went_silent', maya.id, 14),
  // A return the phone made before its unlock (A13): recorded, never applied, so no mark.
  event('refocus', maya.id, 15, { recorded_as: 'superseded' }),
  event('came_back', maya.id, 16),
  { ...event('unlock', theo.id, 18, { recorded_as: 'superseded' }), eventId: 'u2' },
  event('refocus', theo.id, 20),
  { ...event('protection_off', priya.id, 22), eventId: 'p1' },
  { ...event('unlock', theo.id, 24, { reason: 'counselor' }), eventId: 'u3' },
  event('protection_on', priya.id, 25),
  { ...event('unlock', ines.id, 26, { reason: 'nurse' }), eventId: 'u4' },
  event('left_for_other_session', unnamed.id, 27),
  event('session_expired', null, 30),
];

/** Intl puts a narrow no-break space before AM and PM; the tests read every space as one. */
const plain = (s: string) => s.replace(/\s/g, ' ');

const timeline = (over: Partial<SessionReportResponse> = {}, events = EVENTS, present = false) =>
  sessionTimeline(SESSION, { ...REPORT, ...over }, events, NY, present);

/** Each row as `name: moment@time reason`. */
const marks = (view = timeline()) =>
  view.rows.map(
    (r) =>
      `${r.name}: ${r.marks.map((m) => plain(`${m.moment}@${m.time}${m.reason ? ` ${m.reason}` : ''}`)).join(', ')}`,
  );

/** A fake API: each path answers its value, or throws its error; every path asked is recorded. */
function fakeApi(answers: Record<string, unknown>) {
  const asked: string[] = [];
  return {
    asked,
    get<T>(path: string): Promise<T> {
      asked.push(path);
      if (!(path in answers)) return Promise.reject(new Error(`unexpected ${path}`));
      const answer = answers[path];
      return answer instanceof Error ? Promise.reject(answer) : Promise.resolve(answer as T);
    },
  };
}

describe('readEvents', () => {
  const FEED = '/v1/sessions/s1/events?after=0';
  const many = (from: number, n: number): FeedEvent[] =>
    Array.from({ length: n }, (_, i) => ({
      ...EVENTS[1],
      seq: from + i,
      eventId: `m${from + i}`,
    }));

  it('reads every page of the feed, oldest first, until a short one', async () => {
    const first = many(1, EVENT_PAGE_LIMIT);
    const rest = many(EVENT_PAGE_LIMIT + 1, 3);
    const api = fakeApi({
      [FEED]: { events: first, nextAfter: EVENT_PAGE_LIMIT },
      [`/v1/sessions/s1/events?after=${EVENT_PAGE_LIMIT}`]: { events: rest, nextAfter: 203 },
    });
    expect(await readEvents(api, 's1')).toEqual([...first, ...rest]);
    expect(api.asked).toHaveLength(2);
  });

  it('stops at a page that leaves its cursor where it was, never reading it again', async () => {
    const api = fakeApi({ [FEED]: { events: many(1, EVENT_PAGE_LIMIT), nextAfter: 0 } });
    expect(await readEvents(api, 's1')).toHaveLength(EVENT_PAGE_LIMIT);
    expect(api.asked).toEqual([FEED]);
  });

  it('fails as its read fails, and puts the session id in the path as one segment', async () => {
    const api = fakeApi({ '/v1/sessions/a%2Fb/events?after=0': new NetworkError() });
    await expect(readEvents(api, 'a/b')).rejects.toBeInstanceOf(NetworkError);
  });
});

describe('the timeline', () => {
  it('places a moment by its time on the session’s own: the start at 0, the end at 100', () => {
    const start = Date.parse(SESSION.startedAt);
    const end = Date.parse(SESSION.endsAt);
    expect(placement(start, start, end)).toBe(0);
    expect(placement(end, start, end)).toBe(100);
    expect(placement(Date.parse(at(10)), start, end)).toBe(20);
    expect(placement(Date.parse(at(17)) + 30_000, start, end)).toBe(50);
    // Held to the axis, and a session with no length puts everything at its start.
    expect(placement(start - 60_000, start, end)).toBe(0);
    expect(placement(end + 60_000, start, end)).toBe(100);
    expect(placement(start, start, start)).toBe(0);
  });

  it('marks each student’s moments at their times, who joined in R2’s order, then the rest', () => {
    expect(marks()).toEqual([
      'Theo: in@9:05 AM, unlock@9:18 AM No reason given, focus@9:20 AM, unlock@9:24 AM No reason given',
      'Maya: in@9:06 AM, unlock@9:11 AM Bathroom, silent@9:14 AM, back@9:16 AM',
      '0199b0a1: in@9:06 AM, left@9:27 AM',
      'Priya: in@9:07 AM, off@9:22 AM, on@9:25 AM',
      // Unlocked without joining: never left out.
      'Ines: unlock@9:26 AM Nurse',
    ]);
    expect(timeline().rows[0]?.marks.map((m) => m.x)).toEqual([0, 52, 60, 76]);
  });

  it('draws no mark for a late tap, return or Screen Time back on, nor a row for its student', () => {
    const late = (type: EventType) => event(type, priya.id, 28, { recorded_as: 'superseded' });
    const view = timeline({}, [...EVENTS, late('refocus'), late('protection_on')]);
    expect(marks(view)).toEqual(marks());
    expect(view.rows.some((r) => r.key === zed)).toBe(false);
  });

  it('keeps a row for each student with an unlock or protection off when nobody joined', () => {
    const view = timeline({ joined: [] });
    expect(view.rows.map((r) => r.name)).toEqual(['Maya', 'Theo', 'Priya', 'Ines']);
  });

  it('says each unlock’s reason as R2 does now, else as its record does', () => {
    // R2 lists u1's reason now (bathroom), not the nurse it was sent with; one R2 doesn't list
    // yet, landing between the two reads, says its own.
    const unlisted = { ...event('unlock', maya.id, 29, { reason: 'other' }), eventId: 'u9' };
    expect(marks(timeline({}, [...EVENTS, unlisted]))[1]).toBe(
      'Maya: in@9:06 AM, unlock@9:11 AM Bathroom, silent@9:14 AM, back@9:16 AM, unlock@9:29 AM Other',
    );
    const reasons = UNLOCK_REASONS.map(
      (reason) =>
        timeline({ unlocks: [{ ...REPORT.unlocks[0], reason }] }).rows[1]?.marks[1]?.reason,
    );
    expect(reasons).toEqual(['Bathroom', 'Nurse', 'Other']);
  });

  it('lists in its legend only the moments it shows, in one order', () => {
    expect(timeline().moments).toEqual([
      'in',
      'unlock',
      'focus',
      'off',
      'on',
      'silent',
      'back',
      'left',
    ]);
    const taps = EVENTS.filter((e) => e.type === 'tap_in' && e.userId !== zed);
    expect(timeline({ unlocks: [] }, taps).moments).toEqual(['in']);
  });

  it('runs its axis from the start to the end, a tick each 5 minutes, AM or PM at its ends', () => {
    // The Recap · no unlocks board: 9:05 to 9:30.
    const { ticks, step } = timeline();
    expect(ticks.map((t) => [t.x, plain(t.label)])).toEqual([
      [0, '9:05 AM'],
      [20, '9:10'],
      [40, '9:15'],
      [60, '9:20'],
      [80, '9:25'],
      [100, '9:30 AM'],
    ]);
    expect(step).toBe(20);
  });

  it('keeps 12 gaps or fewer, and none of its ticks within a gap of the end', () => {
    const labels = (minutes: number) => {
      const endsAt = new Date(Date.parse(SESSION.startedAt) + minutes * 60_000).toISOString();
      const session = { ...SESSION, endsAt, endedAt: null };
      return sessionTimeline(session, REPORT, [], NY).ticks.map((t) => plain(t.label));
    };
    expect(labels(50)).toHaveLength(11);
    // 9:05 to 9:42: 9:40 would run into 9:42 AM.
    expect(labels(37)).toEqual([
      '9:05 AM',
      '9:10',
      '9:15',
      '9:20',
      '9:25',
      '9:30',
      '9:35',
      '9:42 AM',
    ]);
    // An hour and a quarter: a tick each 10 minutes.
    expect(labels(75)).toEqual([
      '9:05 AM',
      '9:15',
      '9:25',
      '9:35',
      '9:45',
      '9:55',
      '10:05',
      '10:20 AM',
    ]);
    expect(labels(8 * 60).length).toBeLessThanOrEqual(13);
  });

  it('stretches past an early End for a record clamped after it, so it sits at its time', () => {
    // Ended at 9:20; Ines's unlock at 9:26 reached the server after it (rule 1 clamps to the bell).
    const view = sessionTimeline({ ...SESSION, endedAt: at(20) }, REPORT, EVENTS, NY);
    expect(plain(view.ticks.at(-1)?.label ?? '')).toBe('9:27 AM');
    expect(view.rows.at(-1)?.marks[0]?.x).toBe(95.45);
  });
});

describe('the timeline in Present, the projector the class can see (#265)', () => {
  it('marks every unlock by who and when, never its reason; the rest as the teacher sees it', () => {
    const projected = timeline({}, EVENTS, true);
    const unlocks = projected.rows.flatMap((r) => r.marks.filter((m) => m.moment === 'unlock'));
    expect(unlocks).toHaveLength(4);
    expect(unlocks.every((m) => m.reason === null)).toBe(true);
    const unreasoned = timeline().rows.map((r) => ({
      ...r,
      marks: r.marks.map((m) => ({ ...m, reason: null })),
    }));
    expect(projected.rows).toEqual(unreasoned);
  });
});
