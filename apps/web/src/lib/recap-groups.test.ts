import type {
  EventType,
  FeedEvent,
  ReportStudent,
  RosterStudent,
  SessionReportResponse,
  SessionReportSummary,
  UnlockReason,
} from '@bali/shared';
import { sessionReport } from '@bali/shared';
import { describe, expect, it } from 'vitest';

import type { Student } from './grid-state';
import { type RecapGroups, recapGroups, type RecapStudent } from './recap';
import { studentPanel } from './student-panel';

/*
 * The recap's groups (PV12a; the canvas's ClassEnded): who wasn't focused the whole time, each with
 * their line and moments, who was, and who didn't join. Each report here is R2's own, `sessionReport`
 * over the same events as its route counts them, and every test checks the recap against it. Times
 * are the server's, in UTC: a lesson from 09:05 to its bell at 09:55, each minute 2% of it.
 */

const at = (minute: number) => new Date(Date.UTC(2026, 9, 12, 9) + minute * 60_000).toISOString();
const UTC = { locale: 'en-US', timeZone: 'UTC' };

/** Swept at its bell. Its figures are R3's and the groups read none of them. */
const SESSION: SessionReportSummary = {
  id: 's1',
  startedAt: at(5),
  endsAt: at(55),
  endedAt: at(55),
  ended: true,
  joinedCount: 0,
  focusMinutes: 0,
  averageFocusMinutes: null,
  silentMinutes: 0,
  unlockCount: 0,
  protectionOffCount: 0,
};

/** A student whose account has no display name: the grid names them by their id's start. */
const UNNAMED = '0199b0a1-ffff-7000-8000-000000000004';
/** The class in the order its students joined it, the roster's; each named by their id. */
const CLASS = [
  'Ana',
  'Marcus',
  'Priya',
  'Jaylen',
  'Sofia',
  'Tomas',
  'Keisha',
  'Amara',
  'Diego',
  'Ethan',
  'Zuri',
  'Caleb',
  'Mateo',
  'Hannah',
  'Lucas',
];
const displayName = (id: string) => (id === UNNAMED ? null : id);

/** On the roster, enrolled at `minute` (before the session, by default). */
const enrolled = (id: string, minute = 0): RosterStudent => ({
  enrollmentId: `n-${id}`,
  studentId: id,
  displayName: displayName(id),
  joinedAt: at(minute),
});
const ROSTER = CLASS.map((id) => enrolled(id));

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

/** R2's report on the session, as its route answers it: `sessionReport` over the same events. */
function reportOf(events: readonly FeedEvent[], session = SESSION): SessionReportResponse {
  const r = sessionReport(
    {
      startedAt: new Date(session.startedAt),
      endsAt: new Date(session.endsAt),
      endedAt: session.endedAt === null ? null : new Date(session.endedAt),
    },
    events.map((e) => ({ ...e, occurredAt: new Date(e.occurredAt) })),
    new Date(at(70)),
  );
  const named = (id: string): ReportStudent => ({ id, displayName: displayName(id) });
  return {
    ended: true,
    joined: r.joined.map(named),
    focusMinutes: Math.round(r.focusMinutes),
    averageFocusMinutes: r.averageFocusMinutes === null ? null : Math.round(r.averageFocusMinutes),
    silentMinutes: Math.round(r.silentMinutes),
    unlocks: r.unlocks.map(({ eventId, studentId, occurredAt, reason, recordedAs }) => ({
      eventId,
      student: named(studentId),
      occurredAt: occurredAt.toISOString(),
      reason,
      recordedAs,
    })),
    protectionOffs: r.protectionOffs.map(({ eventId, studentId, occurredAt, recordedAs }) => ({
      eventId,
      student: named(studentId),
      occurredAt: occurredAt.toISOString(),
      recordedAs,
    })),
  };
}

/**
 * The recap and the report never disagree: who joined is exactly who was focused the whole time or
 * part of it; every unlock and protection off R2 lists is a moment of its student at R2's time, and
 * never under "the whole time"; each student is in one group.
 */
function agreesWith(report: SessionReportResponse, g: RecapGroups): void {
  const joined = [...g.partTime, ...g.wholeTime].map((s) => s.key);
  expect(new Set(joined)).toEqual(new Set(report.joined.map((s) => s.id)));
  const everyone = [...g.partTime, ...g.wholeTime, ...g.notJoined].map((s) => s.key);
  expect(new Set(everyone).size).toBe(everyone.length);
  for (const r of [...report.unlocks, ...report.protectionOffs]) {
    const row = [...g.partTime, ...g.notJoined].find((s) => s.key === r.student.id);
    expect(row?.moments.find((m) => m.key === r.eventId)?.at.toISOString()).toBe(r.occurredAt);
  }
}

/** The recap's groups for these events, checked against R2's report on them first. */
function groups(
  events: readonly FeedEvent[],
  {
    roster = ROSTER,
    session = SESSION,
    report = reportOf(events, session),
  }: {
    roster?: RosterStudent[];
    session?: SessionReportSummary;
    report?: SessionReportResponse;
  } = {},
): RecapGroups {
  const g = recapGroups(session, report, events, roster, UTC);
  agreesWith(report, g);
  return g;
}

/** Intl puts a narrow no-break space before AM and PM; the tests read every space as one. */
const plain = (s: string) => s.replace(/\s/g, ' ');
const hhmm = (d: Date) => d.toISOString().slice(11, 16);
/** A student as `name: moment@time reason, …`. */
const said = (s: RecapStudent) =>
  `${s.name}: ${s.moments
    .map((m) => `${m.moment}@${hhmm(m.at)}${m.reason === null ? '' : ` ${m.reason}`}`)
    .join(', ')}`;
/** Their line, each span as `from–to` on the axis, in percent. */
const line = (s: RecapStudent) => s.spans.map((l) => `${l.from}–${l.to}`).join(' ');
const names = (list: readonly RecapStudent[]) => list.map((s) => s.name);

/** ClassEnded's class, at the board's own times. */
function board(): FeedEvent[] {
  return [
    event('session_started', null, 5),
    ...['Ana', 'Marcus', 'Amara', 'Ethan', 'Caleb', 'Lucas'].map((id) => event('tap_in', id, 5)),
    ...['Priya', 'Jaylen', 'Diego'].map((id) => event('tap_in', id, 6)),
    ...['Sofia', 'Tomas', 'Mateo'].map((id) => event('tap_in', id, 7)),
    event('unlock', 'Jaylen', 18, { reason: 'bathroom' }),
    event('protection_off', 'Amara', 22),
    event('refocus', 'Jaylen', 24),
    event('went_silent', 'Tomas', 26),
    event('left_for_other_session', 'Caleb', 27),
    event('unlock', 'Diego', 31),
    event('unlock', 'Ethan', 31, { reason: 'nurse' }),
    event('unlock', 'Lucas', 37, { reason: 'nurse' }),
    event('came_back', 'Tomas', 39),
    // A late tap-in still counts.
    event('tap_in', 'Keisha', 40),
    event('protection_off', 'Lucas', 41),
    event('unlock', 'Mateo', 44, { reason: 'other' }),
    event('session_expired', null, 55),
  ];
}

describe('recapGroups', () => {
  it('groups ClassEnded’s class as the board does, each mark and line where the board draws it', () => {
    const g = groups(board());
    // By when their focus first broke; Diego and Ethan both at 9:31, in the roster's order.
    expect(g.partTime.map(said)).toEqual([
      'Jaylen: in@09:06, unlock@09:18 bathroom, focus@09:24',
      'Amara: in@09:05, off@09:22',
      'Tomas: in@09:07, silent@09:26, back@09:39',
      'Caleb: in@09:05, left@09:27',
      'Diego: in@09:06, unlock@09:31',
      'Ethan: in@09:05, unlock@09:31 nurse',
      'Lucas: in@09:05, unlock@09:37 nurse, off@09:41',
      'Mateo: in@09:07, unlock@09:44 other',
    ]);
    expect(g.partTime.map((s) => s.moments.map((m) => m.x))).toEqual([
      [2, 26, 38],
      [0, 34],
      [4, 42, 68],
      [0, 44],
      [2, 52],
      [0, 52],
      [0, 64, 72],
      [4, 78],
    ]);
    expect(g.partTime.map(line)).toEqual([
      '2–100',
      '0–100',
      '4–100',
      '0–44',
      '2–100',
      '0–100',
      '0–100',
      '4–100',
    ]);
    // In the roster's order, Keisha's late tap-in among them.
    expect(names(g.wholeTime)).toEqual(['Ana', 'Marcus', 'Priya', 'Sofia', 'Keisha']);
    expect(names(g.notJoined)).toEqual(['Zuri', 'Hannah']);
    expect(g.notJoined.map((s) => [s.spans, s.moments])).toEqual([
      [[], []],
      [[], []],
    ]);
  });

  it('lists each student’s moments as their panel does: one rule for both (PV11a)', () => {
    const events = board();
    const g = groups(events);
    for (const s of [...g.partTime, ...g.wholeTime]) {
      const tile: Student = {
        studentId: s.key,
        displayName: s.name,
        state: 'focused',
        joinedAt: new Date(at(5)),
        lastSeenAt: null,
        endedAt: null,
        unlock: null,
        clockOff: false,
      };
      const panel = studentPanel(tile, events, new Date(at(56)));
      const moments = s.moments.map((m) => ({
        key: m.key,
        moment: m.moment,
        at: m.at,
        reason: m.reason,
      }));
      expect(moments).toEqual(panel.moments);
    }
  });

  it('runs the axis from the start to the end, a tick each 10 minutes, AM or PM at its ends', () => {
    // ClassEnded's ticks (PV12b): 6 gaps or fewer.
    const { ticks, step } = groups(board());
    expect(ticks.map((t) => [t.x, plain(t.label)])).toEqual([
      [0, '9:05 AM'],
      [20, '9:15'],
      [40, '9:25'],
      [60, '9:35'],
      [80, '9:45'],
      [100, '9:55 AM'],
    ]);
    expect(step).toBe(20);
  });

  it('keeps 6 gaps or fewer whatever the length: a tick each 5 minutes for 25, each 15 for 75', () => {
    const lasting = (minutes: number) => {
      const end = new Date(Date.parse(SESSION.startedAt) + minutes * 60_000).toISOString();
      return groups([], { session: { ...SESSION, endsAt: end, endedAt: end } });
    };
    expect(lasting(25).step).toBe(20);
    expect(lasting(75).step).toBe(20);
    expect(lasting(60).ticks.length - 1).toBe(6);
    expect(lasting(480).ticks.map((t) => t.x)).toEqual([0, 25, 50, 75, 100]);
  });
});

describe('focused the whole time', () => {
  it('counts a late tap-in from it to the end: one the Start converted, and one held to the bell', () => {
    const g = groups([
      // Converted by the Start: held to the session's start (rule 1).
      event('tap_in', 'Ana', 5),
      event('tap_in', 'Marcus', 40),
      // A phone whose clock ran ahead (S9): its tap held to the bell.
      event('tap_in', 'Priya', 55, { clock_ahead_s: 600 }),
    ]);
    expect(names(g.wholeTime)).toEqual(['Ana', 'Marcus', 'Priya']);
    expect(g.wholeTime.map(line)).toEqual(['0–100', '70–100', '100–100']);
    expect(g.partTime).toEqual([]);
  });

  it('counts a tap again, and a return whose unlock hasn’t reached Bali yet', () => {
    // The phone's return landed first (A12); its unlock, still on its way, isn't in the report
    // yet, so the two agree. Once it lands it is listed, late, and she is focused part of the time.
    const g = groups([
      event('tap_in', 'Ana', 5),
      event('tap_in', 'Ana', 12),
      event('refocus', 'Ana', 20),
    ]);
    expect(g.wholeTime.map(said)).toEqual(['Ana: in@09:05, in@09:12, focus@09:20']);
    expect(g.wholeTime.map(line)).toEqual(['0–100']);
  });

  it('counts no silence the sweep marked only at the bell: the report counts none', () => {
    const events = [event('tap_in', 'Ana', 5), event('went_silent', 'Ana', 55)];
    expect(reportOf(events).silentMinutes).toBe(0);
    expect(names(groups(events).wholeTime)).toEqual(['Ana']);
  });

  it('counts no leave at the bell or after it: the next class’s tap before the sweep', () => {
    // A tap into her next class two minutes after the bell, the sweep not yet round: her switch
    // here is stamped with that tap's time. And a removal past the bell, before the sweep, held to
    // it.
    const g = groups([
      event('tap_in', 'Ana', 5),
      event('tap_in', 'Marcus', 6),
      event('left_for_other_session', 'Ana', 57),
      event('enrollment_removed', 'Marcus', 55),
    ]);
    expect(g.wholeTime.map(said)).toEqual([
      'Ana: in@09:05, left@09:57',
      'Marcus: in@09:06, left@09:55',
    ]);
    // Their line runs to the end, and the axis isn't stretched for a row it doesn't draw.
    expect(g.wholeTime.map(line)).toEqual(['0–100', '2–100']);
    expect(plain(g.ticks.at(-1)?.label ?? '')).toBe('9:55 AM');
  });
});

describe('focused part of the time', () => {
  it('lists an unlock and the return after it, at the session’s start and at its bell', () => {
    const g = groups([
      event('tap_in', 'Ana', 5),
      // A phone whose clock ran behind: held to the start.
      event('unlock', 'Ana', 5, { reason: 'nurse' }),
      event('refocus', 'Ana', 12),
      event('tap_in', 'Marcus', 6),
      // A phone whose clock ran ahead, its unlock applied before the bell: held to the bell.
      event('unlock', 'Marcus', 55, { clock_ahead_s: 300 }),
    ]);
    expect(g.partTime.map(said)).toEqual([
      'Ana: in@09:05, unlock@09:05 nurse, focus@09:12',
      'Marcus: in@09:06, unlock@09:55',
    ]);
    expect(g.partTime.map((s) => s.moments.map((m) => m.x))).toEqual([
      [0, 0, 14],
      [2, 100],
    ]);
    expect(g.wholeTime).toEqual([]);
  });

  it('lists Screen Time off and back on at the session’s start, and off at its bell', () => {
    const g = groups([
      event('tap_in', 'Ana', 5),
      event('protection_off', 'Ana', 5),
      event('protection_on', 'Ana', 20),
      event('tap_in', 'Marcus', 6),
      // A phone whose clock ran ahead, its report applied before the bell: held to the bell.
      event('protection_off', 'Marcus', 55, { clock_ahead_s: 300 }),
    ]);
    expect(g.partTime.map(said)).toEqual([
      'Ana: in@09:05, off@09:05, on@09:20',
      'Marcus: in@09:06, off@09:55',
    ]);
    expect(g.partTime.map(line)).toEqual(['0–100', '2–100']);
    expect(g.partTime[1]?.moments.at(-1)?.x).toBe(100);
  });

  it('lists a silence and the check-in that ended it', () => {
    const g = groups([
      event('tap_in', 'Ana', 5),
      event('went_silent', 'Ana', 26),
      event('came_back', 'Ana', 39),
    ]);
    expect(g.partTime.map(said)).toEqual(['Ana: in@09:05, silent@09:26, back@09:39']);
  });

  it('lists a leave, the line ending there; a switch away and back, the line in two', () => {
    const g = groups([
      event('tap_in', 'Ana', 5),
      event('enrollment_removed', 'Ana', 27),
      event('tap_in', 'Marcus', 6),
      event('left_for_other_session', 'Marcus', 20),
      event('tap_in', 'Marcus', 30),
    ]);
    expect(g.partTime.map(said)).toEqual([
      'Marcus: in@09:06, left@09:20, in@09:30',
      'Ana: in@09:05, left@09:27',
    ]);
    expect(g.partTime.map(line)).toEqual(['2–30 50–100', '0–44']);
  });

  it('draws the line in the order Bali recorded it, a phone’s clock never outrunning a removal', () => {
    // A phone ten minutes ahead (S9) taps in at 9:06, its tap stamped 9:16; the teacher removes her
    // at 9:10 by the server's clock. R2 holds the removal to her tap and counts her no focus: her
    // line is none, never 9:16 to the bell.
    const events = [
      event('tap_in', 'Ana', 16, { clock_ahead_s: 600 }),
      event('enrollment_removed', 'Ana', 10),
    ];
    expect(reportOf(events).focusMinutes).toBe(0);
    const g = groups(events);
    expect(g.partTime.map(said)).toEqual(['Ana: left@09:10, in@09:16']);
    expect(g.partTime.map(line)).toEqual(['22–22']);
  });

  it('ends the line at the session’s end, and draws a leave after it where it was', () => {
    // Unlocked, then a tap into her next class a minute after the bell, before the sweep.
    const g = groups([
      event('tap_in', 'Priya', 5),
      event('unlock', 'Priya', 30),
      event('left_for_other_session', 'Priya', 56),
    ]);
    expect(g.partTime.map(said)).toEqual(['Priya: in@09:05, unlock@09:30, left@09:56']);
    expect(g.partTime.map(line)).toEqual(['0–98.04']);
    expect(g.partTime[0]?.moments.at(-1)?.x).toBe(100);
    expect(plain(g.ticks.at(-1)?.label ?? '')).toBe('9:56 AM');
  });

  it('lists a late unlock, which the report lists, beside the return that went ahead of it', () => {
    // Unlocked at 9:18, back in focus at 9:20 by the phone's order, the unlock landing last (A10,
    // A12): it changed nothing, and R2 lists it all the same.
    const late = [
      event('tap_in', 'Jaylen', 6),
      event('refocus', 'Jaylen', 20),
      event('unlock', 'Jaylen', 18, { reason: 'bathroom', recorded_as: 'superseded' }),
    ];
    expect(reportOf(late).unlocks.map((u) => u.recordedAs)).toEqual(['superseded']);
    expect(groups(late).partTime.map(said)).toEqual([
      'Jaylen: in@09:06, unlock@09:18 bathroom, focus@09:20',
    ]);
    // A return the phone made before its unlock (A13): recorded, never applied, so no moment.
    const stands = [
      event('tap_in', 'Ana', 5),
      event('unlock', 'Ana', 10),
      event('refocus', 'Ana', 9, { recorded_as: 'superseded' }),
    ];
    expect(groups(stands).partTime.map(said)).toEqual(['Ana: in@09:05, unlock@09:10']);
  });

  it('lists an unlock that reached Bali after they left, at the time it was made', () => {
    const g = groups([
      event('tap_in', 'Ana', 5),
      event('enrollment_removed', 'Ana', 22),
      event('unlock', 'Ana', 20, { reason: 'nurse', recorded_as: 'no_live_participation' }),
    ]);
    expect(g.partTime.map(said)).toEqual(['Ana: in@09:05, unlock@09:20 nurse, left@09:22']);
    expect(g.partTime.map(line)).toEqual(['0–34']);
  });

  it('lists a record that reached Bali after the bell: a phone offline when it went off', () => {
    const g = groups([
      event('tap_in', 'Amara', 5),
      event('session_expired', null, 55),
      event('protection_off', 'Amara', 30, { recorded_as: 'after_session_end' }),
    ]);
    expect(g.partTime.map(said)).toEqual(['Amara: in@09:05, off@09:30']);
  });

  it('lists an unlock and Screen Time off after an early End, past the line’s end', () => {
    // Ended at 9:20; at 9:21 two phones that hadn't heard yet unlocked and turned Screen Time off.
    // R2 lists both, so the recap shows both, past where the session's end draws each line to,
    // the axis stretched to them.
    const session = { ...SESSION, endedAt: at(20) };
    const g = groups(
      [
        event('tap_in', 'Ana', 5),
        event('tap_in', 'Marcus', 5),
        event('session_ended', null, 20),
        event('unlock', 'Ana', 21, { recorded_as: 'after_session_end' }),
        event('protection_off', 'Marcus', 21, { recorded_as: 'after_session_end' }),
      ],
      { session },
    );
    expect(g.partTime.map(said)).toEqual([
      'Ana: in@09:05, unlock@09:21',
      'Marcus: in@09:05, off@09:21',
    ]);
    expect(g.partTime.map(line)).toEqual(['0–93.75', '0–93.75']);
    expect(g.partTime.map((s) => s.moments.at(-1)?.x)).toEqual([100, 100]);
    expect(plain(g.ticks.at(-1)?.label ?? '')).toBe('9:21 AM');
  });

  it('places an unlock and a protection off R2 lists that the feed’s read missed', () => {
    // Both landed after the bell, between the two reads: R2 has them, the feed doesn't.
    const read = [event('tap_in', 'Ana', 5), event('tap_in', 'Marcus', 5)];
    const all = [
      ...read,
      event('unlock', 'Ana', 30, { reason: 'other', recorded_as: 'after_session_end' }),
      event('protection_off', 'Marcus', 31, { recorded_as: 'after_session_end' }),
    ];
    const g = groups(read, { report: reportOf(all) });
    expect(g.partTime.map(said)).toEqual([
      'Ana: in@09:05, unlock@09:30 other',
      'Marcus: in@09:05, off@09:31',
    ]);
  });

  it('says each unlock’s reason as R2 does now, else as its latest change does', () => {
    const unlock = event('unlock', 'Ana', 10, { reason: 'nurse' });
    const events = [
      event('tap_in', 'Ana', 5),
      unlock,
      // Changed by the student since (A20): the latest is the one a teacher sees.
      event('unlock_reason_changed', 'Ana', 11, {
        unlock_event_id: unlock.eventId,
        reason: 'bathroom',
      }),
    ];
    expect(groups(events).partTime.map(said)).toEqual(['Ana: in@09:05, unlock@09:10 bathroom']);
    // R2's is the one the report shows, should a change land between the two reads; a newer
    // build's, met mid-deploy, reads as none, as the tile reads it.
    const report = reportOf(events);
    const saying = (reason: string) => ({
      ...report,
      unlocks: report.unlocks.map((u) => ({ ...u, reason: reason as UnlockReason })),
    });
    expect(groups(events, { report: saying('other') }).partTime.map(said)).toEqual([
      'Ana: in@09:05, unlock@09:10 other',
    ]);
    expect(groups(events, { report: saying('counselor') }).partTime.map(said)).toEqual([
      'Ana: in@09:05, unlock@09:10',
    ]);
  });
});

describe('didn’t join', () => {
  it('lists who was on the roster by the session’s end and never joined, in its order', () => {
    const roster = [
      enrolled('Zuri'),
      enrolled('Ana'),
      // Joined the class mid-session, and didn't tap in.
      enrolled('Hannah', 30),
      // Joined the class as it ended, and after it: never in this session's class.
      enrolled('Lucas', 55),
      enrolled('Mateo', 70),
    ];
    const g = groups([event('tap_in', 'Ana', 5)], { roster });
    expect(names(g.notJoined)).toEqual(['Zuri', 'Hannah']);
    expect(names(g.wholeTime)).toEqual(['Ana']);
  });

  it('lists who never joined with an unlock here, the unlock with them, on the roster or not', () => {
    // A tap a later one of hers in another class went ahead of (A14), and the unlock sent under it:
    // filed here with nothing live. She never joined, and the report lists her unlock.
    const g = groups(
      [
        event('tap_in', 'Ana', 5),
        event('tap_in', 'Zuri', 8, { recorded_as: 'superseded' }),
        event('unlock', 'Zuri', 9, { reason: 'nurse', recorded_as: 'no_live_participation' }),
        // Removed from the class since, and so off the roster.
        event('unlock', 'Ines', 26, { recorded_as: 'no_live_participation' }),
      ],
      { roster: [enrolled('Ana'), enrolled('Hannah'), enrolled('Zuri')] },
    );
    expect(g.notJoined.map(said)).toEqual([
      'Hannah: ',
      'Zuri: unlock@09:09 nurse',
      'Ines: unlock@09:26',
    ]);
    expect(g.notJoined.map(line)).toEqual(['', '', '']);
    expect(g.notJoined.map((s) => s.moments.map((m) => m.x))).toEqual([[], [8], [42]]);
  });
});

describe('names and order', () => {
  it('names each student as the grid does; whoever left the class since after the roster', () => {
    const g = groups(
      [
        event('tap_in', 'Hannah', 5),
        event('tap_in', UNNAMED, 6),
        event('tap_in', 'Ana', 7),
        event('unlock', UNNAMED, 20),
      ],
      // Hannah left the class after the session, so she is off its roster now.
      { roster: [enrolled('Ana'), enrolled(UNNAMED)] },
    );
    expect(names(g.partTime)).toEqual(['0199b0a1']);
    expect(names(g.wholeTime)).toEqual(['Ana', 'Hannah']);
  });
});
