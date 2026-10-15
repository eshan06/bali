import type {
  EventsPage,
  EventType,
  FeedEvent,
  SessionSnapshot,
  SnapshotStudent,
} from '@bali/shared';
import { EVENT_PAGE_LIMIT, EVENT_RESUME_OVERLAP } from '@bali/shared';
import { describe, expect, it } from 'vitest';

import { ApiError, NetworkError } from './api-client';
import { CANT_REACH, TOO_MANY_TRIES } from './errors';
import {
  applyEvent,
  fromSnapshot,
  gridDisplay,
  minutesSinceContact,
  type Students,
  unlockNote,
} from './grid-state';
import {
  noEvents,
  readStudentEvents,
  type StudentEvents,
  studentPanel,
  withEvents,
} from './student-panel';

/*
 * The student panel's logic (PV11a): one student in one session, their state as their tile shows it,
 * and from the session's events when they tapped in, each moment and its time. Times are the server's
 * (UTC here: a lesson from 09:05 to its bell at 09:55).
 */

const at = (minute: number) => new Date(Date.UTC(2026, 9, 14, 9, minute)).toISOString();

let seq = 0;
/** One event of the session's feed, the next `seq`. */
function event(
  type: EventType,
  userId: string | null,
  minute: number,
  payload: Record<string, unknown> | null = null,
): FeedEvent {
  seq += 1;
  return { seq, eventId: `e${seq}`, type, userId, occurredAt: at(minute), payload };
}

const ROSTER = ['ana', 'ben', 'cal', 'dan', 'eve', 'fay', 'gus', 'hal', 'ivy'];

/** The class as the grid boots from its snapshot: by default, its roster before anyone tapped in. */
function snapshot(
  ...students: (Partial<SnapshotStudent> & { studentId: string })[]
): SessionSnapshot {
  if (students.length === 0) return snapshot(...ROSTER.map((studentId) => ({ studentId })));
  return {
    session: { id: 's1', classId: 'c1', startedAt: at(5), endsAt: at(55) },
    ended: false,
    latestSeq: 0,
    students: students.map((s) => ({
      enrollmentId: `n-${s.studentId}`,
      displayName: s.studentId,
      state: null,
      joinedAt: null,
      lastSeenAt: null,
      endedAt: null,
      unlock: null,
      protectionOffAfterEnd: false,
      ...s,
    })),
  };
}

/** The grid after the stream brought `events`: each student's tile, as the live page folds them. */
const grid = (events: readonly FeedEvent[], snap = snapshot()): Students =>
  events.reduce(applyEvent, fromSnapshot(snap));

const hhmm = (d: Date | null) => (d === null ? null : d.toISOString().slice(11, 16));

/** A minute after the newest event: the teacher opens the panel just then. */
const justAfter = (events: readonly FeedEvent[]) =>
  Math.max(...events.map((e) => Date.parse(e.occurredAt))) + 60_000;

/**
 * The panel for one student at `minute` (by default, `justAfter` the events): its state, its tap-in,
 * each moment and the last check-in.
 */
function panel(id: string, events: readonly FeedEvent[], minute?: number, snap = snapshot()) {
  const now = new Date(minute === undefined ? justAfter(events) : Date.parse(at(minute)));
  const view = studentPanel(grid(events, snap)[id], events, now);
  return {
    display: view.display,
    tappedInAt: hhmm(view.tappedInAt),
    moments: view.moments.map(
      (m) => `${m.moment}@${hhmm(m.at)}${m.reason === null ? '' : ` ${m.reason}`}`,
    ),
    lastCheckIn: hhmm(view.lastCheckIn),
  };
}

describe('studentPanel', () => {
  it('says when they tapped in, late too, by their own tap that the engine applied', () => {
    const events = [
      event('session_started', null, 5),
      // A tap a later one of theirs, recorded in another class, went ahead of (A14): no tap-in.
      event('tap_in', 'ben', 12, { recorded_as: 'superseded' }),
      event('tap_in', 'ben', 20),
    ];
    expect(panel('ben', events)).toEqual({
      display: 'focused',
      tappedInAt: '09:20',
      moments: ['in@09:20'],
      lastCheckIn: '09:20',
    });
  });

  it('lists an unlock with its reason now, and the return to focus after it', () => {
    const unlock = event('unlock', 'ana', 31, { reason: 'nurse' });
    const events = [
      event('tap_in', 'ana', 6),
      unlock,
      // Changed by the student since (A20): the latest is the one a teacher sees.
      event('unlock_reason_changed', 'ana', 32, {
        unlock_event_id: unlock.eventId,
        reason: 'other',
      }),
      event('unlock_reason_changed', 'ana', 33, {
        unlock_event_id: unlock.eventId,
        reason: 'bathroom',
      }),
      // A change naming another unlock changes this one's none.
      event('unlock_reason_changed', 'ana', 34, { unlock_event_id: 'e0', reason: 'nurse' }),
    ];
    expect(panel('ana', events)).toEqual({
      display: 'unlocked',
      tappedInAt: '09:06',
      moments: ['in@09:06', 'unlock@09:31 bathroom'],
      lastCheckIn: '09:31',
    });
    // The tile's own line says the same reason.
    const tile = grid(events).ana;
    expect(unlockNote(tile, gridDisplay(tile, new Date(at(40))))).toBe('bathroom');

    const back = [...events, event('refocus', 'ana', 35)];
    expect(panel('ana', back)).toMatchObject({
      display: 'focused',
      moments: ['in@09:06', 'unlock@09:31 bathroom', 'focus@09:35'],
    });
  });

  it('says no reason for an unlock sent with none, or with one this tab does not know', () => {
    const events = [
      event('tap_in', 'ana', 6),
      event('unlock', 'ana', 10),
      event('refocus', 'ana', 12),
      // A newer build's reason, met mid-deploy.
      event('unlock', 'ana', 14, { reason: 'counselor' }),
    ];
    expect(panel('ana', events).moments).toEqual([
      'in@09:06',
      'unlock@09:10',
      'focus@09:12',
      'unlock@09:14',
    ]);
  });

  it('lists every unlock, a late one too, as the recap marks them: the tile shows the return', () => {
    // Made at 9:18, before the return at 9:20 by the phone's own order, and landing after it (A10,
    // A12): recorded, never applied. It happened, so it is listed.
    const events = [
      event('tap_in', 'cal', 5),
      event('refocus', 'cal', 20),
      event('unlock', 'cal', 18, { reason: 'bathroom', recorded_as: 'superseded' }),
    ];
    expect(panel('cal', events)).toMatchObject({
      display: 'focused',
      moments: ['in@09:05', 'unlock@09:18 bathroom', 'focus@09:20'],
    });
  });

  it('lists Screen Time off and back on; one back on made before its own off is no moment', () => {
    const events = [
      event('tap_in', 'cal', 5),
      event('protection_off', 'cal', 22),
      event('protection_on', 'cal', 25),
    ];
    expect(panel('cal', events)).toMatchObject({
      display: 'focused',
      moments: ['in@09:05', 'off@09:22', 'on@09:25'],
    });
    // Made before the protection off of 9:30 by the phone's order (#167): late, never applied.
    const late = [
      ...events,
      event('protection_off', 'cal', 30),
      event('protection_on', 'cal', 29, { recorded_as: 'superseded' }),
    ];
    expect(panel('cal', late)).toMatchObject({
      display: 'protection_off',
      moments: ['in@09:05', 'off@09:22', 'on@09:25', 'off@09:30'],
    });
  });

  it('lists silence and coming back, its last check-in the one the tile counts from', () => {
    // The 15 s refresh brings when the server last heard from the phone: 9:18 (rule 1).
    const snap = snapshot({
      studentId: 'dan',
      state: 'focused',
      joinedAt: at(6),
      lastSeenAt: at(18),
    });
    const silent = [event('tap_in', 'dan', 6), event('went_silent', 'dan', 20)];
    expect(panel('dan', silent, 22, snap)).toEqual({
      display: 'silent',
      tappedInAt: '09:06',
      moments: ['in@09:06', 'silent@09:20'],
      lastCheckIn: '09:18',
    });
    // The tile's "Silent · 4 min" counts from that same check-in.
    const now = new Date(at(22));
    const view = studentPanel(grid(silent, snap).dan, silent, now);
    expect(minutesSinceContact(grid(silent, snap).dan, now)).toBe(4);
    expect(now.getTime() - (view.lastCheckIn?.getTime() ?? 0)).toBe(4 * 60_000);

    const back = [...silent, event('came_back', 'dan', 24)];
    expect(panel('dan', back, 25, snap)).toEqual({
      display: 'focused',
      tappedInAt: '09:06',
      moments: ['in@09:06', 'silent@09:20', 'back@09:24'],
      lastCheckIn: '09:24',
    });
  });

  it('ends their moments with Left on a leave, a removal or a switch to another class', () => {
    for (const left of [
      'enrollment_left',
      'enrollment_removed',
      'left_for_other_session',
    ] as const) {
      const events = [event('tap_in', 'eve', 6), event(left, 'eve', 27)];
      expect(panel('eve', events)).toEqual({
        display: 'ended',
        tappedInAt: '09:06',
        moments: ['in@09:06', 'left@09:27'],
        lastCheckIn: '09:06',
      });
    }
    // Unlocked as they went: the tile's Left · unlocked.
    const unlocked = [
      event('tap_in', 'eve', 6),
      event('unlock', 'eve', 20, { reason: 'other' }),
      event('enrollment_removed', 'eve', 22),
    ];
    expect(panel('eve', unlocked)).toMatchObject({
      display: 'left_unprotected',
      moments: ['in@09:06', 'unlock@09:20 other', 'left@09:22'],
    });
  });

  it('keeps their first tap-in when they switch away and come back', () => {
    const events = [
      event('tap_in', 'fay', 6),
      event('left_for_other_session', 'fay', 20),
      event('tap_in', 'fay', 30),
    ];
    expect(panel('fay', events)).toEqual({
      display: 'focused',
      tappedInAt: '09:06',
      moments: ['in@09:06', 'left@09:20', 'in@09:30'],
      lastCheckIn: '09:30',
    });
    // The 15 s refresh brings her row, joined at the stint's own tap (9:30): still the first.
    const row = snapshot({
      studentId: 'fay',
      state: 'focused',
      joinedAt: at(30),
      lastSeenAt: at(31),
    });
    expect(panel('fay', events, 32, row)).toMatchObject({
      tappedInAt: '09:06',
      lastCheckIn: '09:31',
    });
  });

  it('holds nothing for a student who never tapped in, and only what they did', () => {
    expect(panel('gus', [event('tap_in', 'ana', 6)])).toEqual({
      display: 'absent',
      tappedInAt: null,
      moments: [],
      lastCheckIn: null,
    });
    // An unlock with nothing live here: listed, as the recap lists it; the tile's Left · unlocked.
    const unjoined = [
      event('unlock', 'gus', 26, { reason: 'nurse', recorded_as: 'no_live_participation' }),
    ];
    expect(panel('gus', unjoined)).toEqual({
      display: 'left_unprotected',
      tappedInAt: null,
      moments: ['unlock@09:26 nurse'],
      lastCheckIn: null,
    });
  });

  it('reads only this student’s events, never another’s or the session’s own', () => {
    const events = [
      event('session_started', null, 5),
      event('tap_in', 'ana', 6),
      event('tap_in', 'ben', 7),
      event('unlock', 'ben', 10, { reason: 'bathroom' }),
      event('question_opened', null, 12, { question_id: 'q1' }),
      event('slide_shown', null, 13, { deck_id: null, page: null }),
      // A Start declined a tap of hers that had already counted elsewhere: never a tap-in.
      event('armed_tap_skipped', 'gus', 5),
    ];
    expect(panel('ana', events).moments).toEqual(['in@09:06']);
    expect(panel('gus', events)).toMatchObject({
      display: 'absent',
      moments: [],
      tappedInAt: null,
    });
  });

  it('places moments at the session’s edges where the server recorded them, never the phone’s', () => {
    const events = [
      // A tap made before the Start, converted by it: held to the start (rule 1).
      event('tap_in', 'hal', 5),
      event('session_ended', null, 20),
      // Recorded after an early End, at its own time in the window.
      event('unlock', 'hal', 26, { reason: 'nurse', recorded_as: 'after_session_end' }),
      // A phone whose clock ran 10 minutes ahead (S9): held to the bell, its claim kept aside.
      event('protection_off', 'hal', 55, {
        recorded_as: 'after_session_end',
        device_time: '2026-10-14T10:05:00.000Z',
        clock_ahead_s: 600,
      }),
    ];
    expect(panel('hal', events, 58)).toMatchObject({
      tappedInAt: '09:05',
      moments: ['in@09:05', 'unlock@09:26 nurse', 'off@09:55'],
    });
  });

  it('lists moments by when they happened, at one instant in the order recorded', () => {
    // Offline at 9:12, the unlock landed after the sweep found the phone silent at 9:14.
    const tap = event('tap_in', 'ivy', 5);
    const off = event('protection_off', 'ivy', 5);
    const silent = event('went_silent', 'ivy', 14);
    const unlock = event('unlock', 'ivy', 12);
    const back = event('came_back', 'ivy', 18);
    expect(panel('ivy', [back, unlock, silent, off, tap]).moments).toEqual([
      'in@09:05',
      'off@09:05',
      'unlock@09:12',
      'silent@09:14',
      'back@09:18',
    ]);
  });
});

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

const FEED = (after: number) => `/v1/sessions/s1/events?after=${after}`;
/** An event of the feed at `n`, the same event wherever it is read (its id is its seq's). */
const feed = (n: number, userId: string, type: EventType = 'came_back'): FeedEvent => ({
  seq: n,
  eventId: `f${n}`,
  type,
  userId,
  occurredAt: at(10),
  payload: null,
});
/** A page of the catch-up feed, as the API answers it. */
const page = (events: FeedEvent[], after = 0): EventsPage => ({
  events,
  nextAfter: events.at(-1)?.seq ?? after,
});
const ofAna = (...events: FeedEvent[]) => events.filter((e) => e.userId === 'ana');

describe('readStudentEvents', () => {
  it('reads every page of the session’s feed from its start, keeping this student’s alone', async () => {
    const first = Array.from({ length: EVENT_PAGE_LIMIT }, (_, i) =>
      feed(i + 1, i % 3 === 0 ? 'ana' : 'ben'),
    );
    const rest = [feed(201, 'ana'), feed(202, 'ben')];
    const api = fakeApi({
      [FEED(0)]: page(first),
      [FEED(EVENT_PAGE_LIMIT)]: page(rest),
      [FEED(202)]: page([], 202),
    });
    expect(await readStudentEvents(api, noEvents('s1', 'ana'))).toEqual({
      kind: 'ready',
      events: {
        sessionId: 's1',
        studentId: 'ana',
        events: ofAna(...first, ...rest),
        cursor: 202,
      },
    });
    expect(api.asked).toEqual([FEED(0), FEED(EVENT_PAGE_LIMIT), FEED(202)]);
  });

  it('reads again from the overlap before its cursor: a late commit found, a replay counted once', async () => {
    const known: StudentEvents = {
      sessionId: 's1',
      studentId: 'ana',
      events: [feed(80, 'ana'), feed(120, 'ana')],
      cursor: 120,
    };
    // 90 committed after the first read passed it; 80 and 120 come again in the overlap.
    const window = [
      feed(80, 'ana'),
      feed(90, 'ana'),
      feed(120, 'ana'),
      feed(125, 'ben'),
      feed(130, 'ana'),
    ];
    const api = fakeApi({
      [FEED(120 - EVENT_RESUME_OVERLAP)]: page(window),
      [FEED(130)]: page([], 130),
    });
    const read = await readStudentEvents(api, known);
    expect(read).toEqual({
      kind: 'ready',
      events: { ...known, events: ofAna(...window), cursor: 130 },
    });
    // Read before only a little: from the start.
    const early = fakeApi({ [FEED(0)]: page([]) });
    await readStudentEvents(early, { ...known, cursor: EVENT_RESUME_OVERLAP - 1 });
    expect(early.asked).toEqual([FEED(0)]);
  });

  it('says a failed read for Try again, never a part of the list as the whole', async () => {
    const unreached = fakeApi({ [FEED(0)]: new NetworkError() });
    expect(await readStudentEvents(unreached, noEvents('s1', 'ana'))).toEqual({
      kind: 'error',
      message: CANT_REACH,
    });
    // Its first page read, its second refused.
    const busy = new ApiError(429, 'rate_limited', 'too many requests from this account');
    const halfway = fakeApi({ [FEED(0)]: page([feed(1, 'ana')]), [FEED(1)]: busy });
    expect(await readStudentEvents(halfway, noEvents('s1', 'ana'))).toEqual({
      kind: 'error',
      message: TOO_MANY_TRIES,
    });
    // Try again reads it again, whole.
    const again = fakeApi({ [FEED(0)]: page([feed(1, 'ana')]), [FEED(1)]: page([], 1) });
    expect(await readStudentEvents(again, noEvents('s1', 'ana'))).toMatchObject({
      kind: 'ready',
      events: { events: [feed(1, 'ana')], cursor: 1 },
    });
  });

  it('puts the session id in the path as one segment', async () => {
    const api = fakeApi({ '/v1/sessions/a%2Fb/events?after=0': page([]) });
    expect(await readStudentEvents(api, noEvents('a/b', 'ana'))).toMatchObject({ kind: 'ready' });
  });
});

describe('withEvents', () => {
  const known: StudentEvents = {
    sessionId: 's1',
    studentId: 'ana',
    events: [feed(5, 'ana'), feed(9, 'ana')],
    cursor: 9,
  };

  it('folds in the stream’s events, each once by its id, in the order the engine recorded them', () => {
    // One the read holds (the overlap), one committed late under a lower seq, another student's.
    const next = withEvents(known, 's1', [
      feed(9, 'ana'),
      feed(7, 'ana'),
      feed(8, 'ben'),
      feed(12, 'ana'),
    ]);
    expect(next.events.map((e) => e.seq)).toEqual([5, 7, 9, 12]);
    // The cursor stays the read's: a read again resumes where the feed was read to.
    expect(next.cursor).toBe(9);
  });

  it('takes no other session’s events, and gives back what it had when nothing is new', () => {
    expect(withEvents(known, 's2', [feed(12, 'ana')])).toBe(known);
    expect(withEvents(known, 's1', [feed(9, 'ana'), feed(8, 'ben')])).toBe(known);
  });
});
