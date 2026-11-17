import type {
  ClassDetail,
  FeedEvent,
  RosterResponse,
  SessionReportQuestion,
  SessionReportResponse,
  SessionReportsPage,
  SessionReportSummary,
} from '@bali/shared';
import { describe, expect, it } from 'vitest';

import { ApiError, NetworkError } from './api-client';
import { CANT_REACH, TOO_MANY_TRIES } from './errors';
import { classFigures } from './recap';
import {
  FIRST_READ,
  focusBar,
  focusShare,
  minutesLong,
  readSessionPage,
  readSessionQuestions,
  readSessions,
  reportPath,
  type SessionList,
  sessionRow,
  startRead,
  UUID,
  wholeTimeOf,
} from './reports';

// A class's lessons at 9:05 in New York, each ended by the sweep at its bell, newest first.
const NY = { locale: 'en-US', timeZone: 'America/New_York' };
function lesson(id: string, day: number, over: Partial<SessionReportSummary> = {}) {
  const at = (minute: number) =>
    `2026-10-${String(day).padStart(2, '0')}T13:${String(minute).padStart(2, '0')}:00.000Z`;
  return {
    id,
    startedAt: at(5),
    endsAt: at(30),
    endedAt: at(30),
    ended: true,
    joinedCount: 4,
    focusMinutes: 83,
    averageFocusMinutes: 21,
    silentMinutes: 2,
    unlockCount: 3,
    protectionOffCount: 1,
    ...over,
  } satisfies SessionReportSummary;
}
const MON = lesson('s3', 5);
const SUN = lesson('s2', 4);
const SAT = lesson('s1', 3);
// Running now: R3 lists it first, with no report to open yet.
const RUNNING = lesson('s4', 6, { endedAt: null, ended: false });

const KLASS: ClassDetail = {
  id: 'c1',
  name: 'Biology, period 3',
  joinCode: 'K7Q2MX',
  createdAt: '2026-09-01T12:00:00.000Z',
  liveSessionId: 's4',
};

const CLASS = '/v1/classes/c1';
const NEWEST = '/v1/classes/c1/reports/sessions?limit=10';
const after = (id: string) => `/v1/classes/c1/reports/sessions?limit=10&before=${id}`;
const R2 = (s: SessionReportSummary) => `/v1/classes/c1/reports/sessions/${s.id}`;
const FEED = (s: SessionReportSummary, from: number) => `/v1/sessions/${s.id}/events?after=${from}`;

/** The four who joined each lesson: the first stays focused, the other three don't. */
const FOUR = ['p1', 'p2', 'p3', 'p4'].map((id) => ({ id, displayName: null }));

/**
 * What Bali holds for a lesson's count: its report (R2), all four joined, the second and third
 * unlocking and the fourth turning protection off, which ends their whole time whatever its events
 * say; and its events, read in two pages, the second empty: each tap-in a minute in.
 */
function holding(s: SessionReportSummary, more: FeedEvent[] = []): Record<string, unknown[]> {
  const at = new Date(Date.parse(s.startedAt) + 60_000).toISOString();
  const report: SessionReportResponse = {
    ended: true,
    startedAt: s.startedAt,
    endsAt: s.endsAt,
    endedAt: s.endedAt,
    joined: FOUR,
    focusMinutes: s.focusMinutes,
    averageFocusMinutes: s.averageFocusMinutes,
    silentMinutes: s.silentMinutes,
    unlocks: [FOUR[1], FOUR[2]].map((student, i) => ({
      eventId: `${s.id}-u${i}`,
      student,
      occurredAt: at,
      reason: null,
      recordedAs: null,
    })),
    protectionOffs: [{ eventId: `${s.id}-o`, student: FOUR[3], occurredAt: at, recordedAs: null }],
  };
  const taps: FeedEvent[] = FOUR.map(({ id }, i) => ({
    seq: i + 1,
    eventId: `${s.id}-t${i}`,
    type: 'tap_in',
    userId: id,
    occurredAt: at,
    payload: {},
  }));
  const events = [...taps, ...more];
  const last = events.at(-1)?.seq ?? 0;
  return {
    [R2(s)]: [report],
    [FEED(s, 0)]: [{ events, nextAfter: last }],
    [FEED(s, last)]: [{ events: [], nextAfter: last }],
  };
}
/** Every read of a lesson's count. */
const countReads = (s: SessionReportSummary) => [R2(s), FEED(s, 0), FEED(s, 4)];
const STALE = new ApiError(
  400,
  'bad_input',
  'before is not a session of this class',
  'unknown_cursor',
);

function page(nextBefore: string | null, ...sessions: SessionReportSummary[]): SessionReportsPage {
  return { sessions, nextBefore };
}

/** A fake API: each path answers its values in turn, or throws; every path asked is recorded. */
function fakeApi(answers: Record<string, unknown[]>) {
  const asked: string[] = [];
  return {
    asked,
    get<T>(path: string): Promise<T> {
      asked.push(path);
      const answer = answers[path]?.shift();
      if (answer === undefined) return Promise.reject(new Error(`unexpected ${path}`));
      return answer instanceof Error ? Promise.reject(answer) : Promise.resolve(answer as T);
    },
  };
}

/** Each lesson's count, as Bali holds it. */
const holdingAll = (...sessions: SessionReportSummary[]) =>
  Object.assign({}, ...sessions.map((s) => holding(s))) as Record<string, unknown[]>;

/** The list once its newest page, `first`, has answered, each lesson's count with it. */
async function loaded(first: SessionReportsPage, counted = new Map<string, number>()) {
  const counts = holdingAll(...first.sessions.filter((s) => s.ended));
  const api = fakeApi({ [CLASS]: [KLASS], [NEWEST]: [first], ...counts });
  return readSessions(api, 'c1', FIRST_READ, 'newest', counted);
}

describe('readSessions', () => {
  it('reads the newest ten with the class, listing the sessions over, each with its whole-time count', async () => {
    const api = fakeApi({
      [CLASS]: [KLASS],
      [NEWEST]: [page('s2', RUNNING, MON, SUN)],
      ...holdingAll(MON, SUN),
    });
    const list = await readSessions(api, 'c1', FIRST_READ, 'newest');
    expect(list).toEqual({
      className: 'Biology, period 3',
      sessions: [MON, SUN],
      wholeTime: { s3: 1, s2: 1 },
      nextBefore: 's2',
      loaded: true,
      reading: null,
      failure: null,
      restarted: false,
    });
    // The one running has no count to read: it isn't listed.
    expect(api.asked.sort()).toEqual(
      [CLASS, NEWEST, ...countReads(MON), ...countReads(SUN)].sort(),
    );
  });

  it('counts as the recap does, from the session’s events too: going silent before the bell ends it', async () => {
    // The first of the four goes quiet ten minutes in: none of the four stayed.
    const silent: FeedEvent = {
      seq: 5,
      eventId: 'quiet',
      type: 'went_silent',
      userId: 'p1',
      occurredAt: new Date(Date.parse(MON.startedAt) + 10 * 60_000).toISOString(),
      payload: {},
    };
    const api = fakeApi({
      [CLASS]: [KLASS],
      [NEWEST]: [page(null, MON)],
      ...holding(MON, [silent]),
    });
    expect((await readSessions(api, 'c1', FIRST_READ, 'newest')).wholeTime).toEqual({ s3: 0 });
  });

  it('reads no count for a session nobody joined', async () => {
    const empty = lesson('s0', 2, { joinedCount: 0, averageFocusMinutes: null, focusMinutes: 0 });
    const api = fakeApi({ [CLASS]: [KLASS], [NEWEST]: [page(null, empty)] });
    const list = await readSessions(api, 'c1', FIRST_READ, 'newest');
    expect(list).toMatchObject({ sessions: [empty], wholeTime: {}, failure: null });
    expect(api.asked.sort()).toEqual([CLASS, NEWEST]);
  });

  it('keeps each count for the page, read again only once its figures change', async () => {
    const counted = new Map<string, number>();
    const first = fakeApi({ [CLASS]: [KLASS], [NEWEST]: [page(null, MON)], ...holding(MON) });
    await readSessions(first, 'c1', FIRST_READ, 'newest', counted);
    // The class picked again: its page read afresh, its count kept.
    const again = fakeApi({ [CLASS]: [KLASS], [NEWEST]: [page(null, MON)] });
    expect((await readSessions(again, 'c1', FIRST_READ, 'newest', counted)).wholeTime).toEqual({
      s3: 1,
    });
    expect(again.asked.sort()).toEqual([CLASS, NEWEST]);
    // A late unlock landed since: R3's count of them moved, so the session is counted again.
    const late = { ...MON, unlockCount: MON.unlockCount + 1 };
    const moved = fakeApi({ [CLASS]: [KLASS], [NEWEST]: [page(null, late)], ...holding(late) });
    await readSessions(moved, 'c1', FIRST_READ, 'newest', counted);
    expect(moved.asked).toEqual(expect.arrayContaining(countReads(late)));
  });

  it('says a count that failed as the page failing, where it was asked, the counts in kept for Try again', async () => {
    const counted = new Map<string, number>();
    const answers = {
      [CLASS]: [KLASS],
      [NEWEST]: [page(null, MON, SUN)],
      ...holdingAll(MON, SUN),
      [R2(SUN)]: [new NetworkError()],
    };
    const failed = await readSessions(fakeApi(answers), 'c1', FIRST_READ, 'newest', counted);
    expect(failed).toMatchObject({
      sessions: [],
      reading: null,
      failure: { at: 'newest', message: CANT_REACH },
    });
    // Monday's count, in before Sunday's failed, isn't read again.
    await new Promise((resolve) => setTimeout(resolve, 0));
    const retry = fakeApi({ [CLASS]: [KLASS], [NEWEST]: [page(null, MON, SUN)], ...holding(SUN) });
    const read = await readSessions(retry, 'c1', startRead(failed, 'newest'), 'newest', counted);
    expect(read).toMatchObject({ wholeTime: { s3: 1, s2: 1 }, failure: null });
    expect(retry.asked.filter((path) => path.includes('s3'))).toEqual([]);
  });

  it('reads no sessions when the class has none over, its first one running included', async () => {
    for (const first of [page(null), page(null, RUNNING)]) {
      const list = await loaded(first);
      expect(list.sessions).toEqual([]);
      expect(list.nextBefore).toBeNull();
      expect(list.loaded).toBe(true);
    }
  });

  it('puts Show earlier’s page after those read, each session once, until the end', async () => {
    const list = await loaded(page('s2', MON, SUN));
    // A session started between the two reads moves none: the cursor names a row (R3).
    const api = fakeApi({ [after('s2')]: [page(null, SUN, SAT)], ...holding(SAT) });
    const more = await readSessions(api, 'c1', startRead(list, 'earlier'), 'earlier');
    expect(more.sessions).toEqual([MON, SUN, SAT]);
    expect(more.wholeTime).toEqual({ s3: 1, s2: 1, s1: 1 });
    expect(more.nextBefore).toBeNull();
    expect(more.reading).toBeNull();
    // Only the new session is counted: Sunday's count came with the newest page.
    expect(api.asked.sort()).toEqual([after('s2'), ...countReads(SAT)].sort());
  });

  it('says why the newest page failed, in the list’s place', async () => {
    for (const fails of [CLASS, NEWEST]) {
      const answers = {
        [CLASS]: [KLASS],
        [NEWEST]: [page(null, MON)],
        [fails]: [new NetworkError()],
      };
      const list = await readSessions(fakeApi(answers), 'c1', FIRST_READ, 'newest');
      expect(list).toMatchObject({
        loaded: false,
        reading: null,
        failure: { at: 'newest', message: CANT_REACH },
      });
    }
  });

  it('says why Show earlier’s page failed where it was asked, the sessions read kept', async () => {
    const list = await loaded(page('s2', MON, SUN));
    const busy = new ApiError(429, 'rate_limited', 'too many requests from this account');
    const api = fakeApi({ [after('s2')]: [busy] });
    const more = await readSessions(api, 'c1', startRead(list, 'earlier'), 'earlier');
    expect(more).toMatchObject({
      sessions: [MON, SUN],
      nextBefore: 's2',
      reading: null,
      failure: { at: 'earlier', message: TOO_MANY_TRIES },
      restarted: false,
    });
  });

  it('reads the newest page again for a cursor the class doesn’t hold, and says so', async () => {
    const counted = new Map<string, number>();
    const list = await loaded(page('s2', MON, SUN), counted);
    const api = fakeApi({
      [after('s2')]: [STALE],
      [CLASS]: [KLASS],
      [NEWEST]: [page('s3', RUNNING, MON)],
    });
    const again = await readSessions(api, 'c1', startRead(list, 'earlier'), 'earlier', counted);
    expect(again).toMatchObject({
      sessions: [MON],
      wholeTime: { s3: 1 },
      nextBefore: 's3',
      reading: null,
      failure: null,
      restarted: true,
    });
    expect(api.asked.slice(0, 1)).toEqual([after('s2')]);
    // Monday's count kept for the page: only the page is read again.
    expect(api.asked.slice(1).sort()).toEqual([CLASS, NEWEST]);
  });

  it('says why the newest page failed when reading it again, the sessions read kept', async () => {
    const list = await loaded(page('s2', MON, SUN));
    const api = fakeApi({
      [after('s2')]: [STALE],
      [CLASS]: [KLASS],
      [NEWEST]: [new NetworkError()],
    });
    // Even a list still marked restarted (startRead clears it) comes back unmarked (S4a).
    const marked = { ...startRead(list, 'earlier'), restarted: true };
    const again = await readSessions(api, 'c1', marked, 'earlier');
    // No cursor kept, so Show earlier never offers the one the server refused (R5's review).
    expect(again).toMatchObject({
      sessions: [MON, SUN],
      nextBefore: null,
      reading: null,
      failure: { at: 'newest', message: CANT_REACH },
      restarted: false,
    });
  });

  it('reads nothing for Show earlier at the end, the list as it was (R5’s review)', async () => {
    const list = await loaded(page(null, MON, SUN));
    const api = fakeApi({});
    const same = await readSessions(api, 'c1', startRead(list, 'earlier'), 'earlier');
    expect(same).toEqual({ ...list, reading: null });
    expect(api.asked).toEqual([]);
  });

  it('reads the newest page once for a cursor refused there, never again and again', async () => {
    const api = fakeApi({ [CLASS]: [KLASS], [NEWEST]: [STALE] });
    const list = await readSessions(api, 'c1', FIRST_READ, 'newest');
    expect(list.failure).toEqual({ at: 'newest', message: STALE.message });
    expect(api.asked).toHaveLength(2);
  });

  it('puts the class id and the cursor in the path as one segment and one value each', async () => {
    const nobody = lesson('s0', 2, { joinedCount: 0, averageFocusMinutes: null, focusMinutes: 0 });
    const api = fakeApi({
      '/v1/classes/a%2Fb': [{ ...KLASS, id: 'a/b' }],
      '/v1/classes/a%2Fb/reports/sessions?limit=10': [page('x&y', nobody)],
      '/v1/classes/a%2Fb/reports/sessions?limit=10&before=x%26y': [page(null)],
    });
    const list = await readSessions(api, 'a/b', FIRST_READ, 'newest');
    expect((await readSessions(api, 'a/b', list, 'earlier')).nextBefore).toBeNull();
  });
});

describe('wholeTimeOf', () => {
  it('reads the session’s report and its events, the class and the session one segment each', async () => {
    const odd = { ...MON, id: 'x/y' };
    const counts = holding(odd);
    const api = fakeApi({
      '/v1/classes/a%2Fb/reports/sessions/x%2Fy': counts[R2(odd)],
      '/v1/sessions/x%2Fy/events?after=0': counts[FEED(odd, 0)],
      '/v1/sessions/x%2Fy/events?after=4': counts[FEED(odd, 4)],
    });
    expect(await wholeTimeOf(api, 'a/b', odd)).toBe(1);
    expect(api.asked).toHaveLength(3);
  });
});

describe('a session’s average focus as its bar, and the share of class time spent focused (LO8)', () => {
  // Ended early, at 9:41 for a 9:05 start: 36 minutes long.
  const EARLY = lesson('s5', 2, { endedAt: '2026-10-02T13:41:00.000Z', averageFocusMinutes: 35 });

  it('is its average out of its length, start to end in whole minutes', () => {
    expect(minutesLong(MON)).toBe(25);
    expect(focusBar(MON)).toEqual({ words: '21 of 25 min', percent: 84 });
    // An early End counts to the End, as the table's times say it.
    expect(focusBar(EARLY)).toEqual({ words: '35 of 36 min', percent: (35 / 36) * 100 });
    // Not marked over yet: to its bell.
    expect(focusBar({ ...MON, endedAt: null })?.words).toBe('21 of 25 min');
    // Its exact length rounded, as R2 rounds the average: 35 min 20 s is 35.
    const seconds = { startedAt: '2026-10-02T13:05:50.000Z', endedAt: '2026-10-02T13:41:10.000Z' };
    expect(focusBar({ ...EARLY, ...seconds })?.words).toBe('35 of 35 min');
  });

  it('has no bar for a session nobody joined, and never runs past its track', () => {
    expect(focusBar({ ...MON, averageFocusMinutes: null })).toBeNull();
    expect(focusBar({ ...MON, endedAt: MON.startedAt })).toEqual({
      words: '21 of 0 min',
      percent: 0,
    });
    expect(focusBar({ ...MON, averageFocusMinutes: 26 })?.percent).toBe(100);
    expect(focusBar({ ...MON, averageFocusMinutes: 1250 }, 'en-US')?.words).toBe('1,250 of 25 min');
  });

  it('shares the class’s focus minutes over its students’ time, every session someone joined weighed by it', () => {
    // 83 of 4 × 25 = 100 minutes, and 35 × 2 = 70 of 2 × 36 = 72: 153 of 172 is 88.95 %.
    const two = { ...EARLY, joinedCount: 2, focusMinutes: 70 };
    expect(focusShare([MON, two])).toBe(88);
    expect(focusShare([MON])).toBe(83);
  });

  it('rounds down, never claiming more than was kept, exact where the share is whole', () => {
    // 29 of 100 is 29 %: 0.29 × 100 in floating point is 28.999…, which a careless floor says 28.
    const hundred = lesson('s6', 2, { joinedCount: 4, focusMinutes: 29 });
    expect(focusShare([hundred])).toBe(29);
    expect(focusShare([{ ...hundred, focusMinutes: 99 }])).toBe(99);
    expect(focusShare([{ ...hundred, focusMinutes: 100 }])).toBe(100);
    // A clock's rounding past the whole: never over a hundred.
    expect(focusShare([{ ...hundred, focusMinutes: 101 }])).toBe(100);
  });

  it('has none when nobody joined any session listed, or none is listed', () => {
    const nobody = lesson('s0', 2, { joinedCount: 0, averageFocusMinutes: null, focusMinutes: 0 });
    expect(focusShare([nobody])).toBeNull();
    expect(focusShare([])).toBeNull();
    // A session nobody joined weighs nothing beside one somebody did.
    expect(focusShare([nobody, MON])).toBe(83);
  });
});

describe('startRead', () => {
  it('starts a read, its failure said until the answer, the place lost gone with it', () => {
    // Try again reads with its line kept, so its button holds in place (ReportRetryStates).
    const said: SessionList = {
      ...FIRST_READ,
      loaded: true,
      reading: null,
      failure: { at: 'earlier', message: 'nope' },
      restarted: true,
    };
    expect(startRead(said, 'earlier')).toEqual({
      ...said,
      reading: 'earlier',
      restarted: false,
    });
  });

  it('lets the answer settle the failure: gone once read, said again if not', async () => {
    const failed: SessionList = {
      ...FIRST_READ,
      reading: null,
      failure: { at: 'newest', message: 'nope' },
    };
    const read = await readSessions(
      fakeApi({ [CLASS]: [KLASS], [NEWEST]: [page(null, MON)], ...holding(MON) }),
      'c1',
      startRead(failed, 'newest'),
      'newest',
    );
    expect(read).toMatchObject({ reading: null, failure: null, sessions: [MON] });
    const again = await readSessions(
      fakeApi({ [CLASS]: [new NetworkError()], [NEWEST]: [page(null, MON)] }),
      'c1',
      startRead(failed, 'newest'),
      'newest',
    );
    expect(again).toMatchObject({ reading: null, failure: { at: 'newest' } });
  });
});

describe('sessionRow', () => {
  it('says when the session ran, and the class’s figures as its recap says them', () => {
    const row = sessionRow(MON, NY);
    expect({ ...row, times: row.times.replace(/\s/g, ' ') }).toEqual({
      day: 'Mon, Oct 5',
      // Reports' board: the start's AM left off when the end's is the same (LO8).
      times: '9:05 to 9:30 AM',
      figures: { joined: '4', focus: '83', average: '21', silent: '2' },
      unlocks: '3',
      protectionOffs: '1',
    });
    // As the recap card says them from R2's report of the 4 who joined (`RecapBody`).
    const report = { focusMinutes: 83, averageFocusMinutes: 21, silentMinutes: 2 };
    expect(row.figures).toEqual(classFigures(4, report, NY.locale));
  });

  it('keeps the start’s AM or PM when the end’s isn’t the same', () => {
    // 11:30 AM to 12:20 PM in New York.
    const noon = lesson('s7', 6, {
      startedAt: '2026-10-06T15:30:00.000Z',
      endsAt: '2026-10-06T16:20:00.000Z',
      endedAt: '2026-10-06T16:20:00.000Z',
    });
    expect(sessionRow(noon, NY).times.replace(/\s/g, ' ')).toBe('11:30 AM to 12:20 PM');
    // A 24-hour clock has no AM or PM to leave off.
    expect(sessionRow(MON, { ...NY, locale: 'en-GB' }).times).toBe('9:05 to 9:30');
  });

  it('has no figures when nobody joined, and still counts what was recorded', () => {
    const empty = lesson('s0', 2, {
      joinedCount: 0,
      focusMinutes: 0,
      averageFocusMinutes: null,
      silentMinutes: 0,
      unlockCount: 1,
      protectionOffCount: 0,
    });
    expect(sessionRow(empty, NY)).toMatchObject({
      figures: null,
      unlocks: '1',
      protectionOffs: '0',
    });
  });

  it('writes large counts in the viewer’s own format', () => {
    const big = lesson('s9', 2, { focusMinutes: 1250, unlockCount: 1200 });
    expect(sessionRow(big, NY)).toMatchObject({ unlocks: '1,200' });
    expect(sessionRow(big, NY).figures?.focus).toBe('1,250');
  });
});

describe('a session’s own page (PV14)', () => {
  const SESSION = '0199e3a1-0000-7000-8000-00000000000a';
  const CLASS_ID = '0199e3a1-0000-7000-8000-00000000000c';
  const KLASS_PATH = `/v1/classes/${CLASS_ID}`;
  const REPORT_PATH = `${KLASS_PATH}/reports/sessions/${SESSION}`;
  const FEED = `/v1/sessions/${SESSION}/events?after=0`;
  const tap: FeedEvent = {
    seq: 1,
    eventId: 'e1',
    type: 'tap_in',
    userId: 'u1',
    occurredAt: MON.startedAt,
    payload: null,
  };
  const REPORT: SessionReportResponse = {
    ended: true,
    startedAt: MON.startedAt,
    endsAt: MON.endsAt,
    endedAt: MON.endedAt,
    joined: [{ id: 'u1', displayName: 'Ana' }],
    focusMinutes: 25,
    averageFocusMinutes: 25,
    silentMinutes: 0,
    unlocks: [],
    protectionOffs: [],
  };
  const ROSTER: RosterResponse = {
    students: [
      { enrollmentId: 'n1', studentId: 'u1', displayName: 'Ana', joinedAt: MON.startedAt },
    ],
  };
  const answers = (over: Record<string, unknown[]> = {}) => ({
    [REPORT_PATH]: [REPORT],
    [FEED]: [{ events: [tap], nextAfter: 1 }],
    [`/v1/sessions/${SESSION}/events?after=1`]: [{ events: [], nextAfter: 1 }],
    [`${KLASS_PATH}/roster`]: [ROSTER],
    ...over,
  });

  it('reads its report, its events and the class’s roster, when it ran from the report', async () => {
    const api = fakeApi(answers());
    expect(await readSessionPage(api, CLASS_ID, SESSION)).toEqual({
      kind: 'ready',
      session: { startedAt: MON.startedAt, endsAt: MON.endsAt, endedAt: MON.endedAt },
      report: REPORT,
      events: [tap],
      roster: ROSTER.students,
    });
    // The three at once: the report and the roster asked before the feed's second page.
    expect(api.asked.slice(0, 3).sort()).toEqual(
      [REPORT_PATH, FEED, `${KLASS_PATH}/roster`].sort(),
    );
  });

  it('keeps a session not marked over as none, its end its bell', async () => {
    const running = { ...REPORT, ended: false, endedAt: null };
    const read = await readSessionPage(
      fakeApi(answers({ [REPORT_PATH]: [running] })),
      CLASS_ID,
      SESSION,
    );
    expect(read).toMatchObject({ kind: 'ready', session: { endedAt: null, endsAt: MON.endsAt } });
  });

  it('says why any of the three failed, the roster’s and the feed’s included, for Try again', async () => {
    for (const failing of [REPORT_PATH, FEED, `${KLASS_PATH}/roster`]) {
      const api = fakeApi(answers({ [failing]: [new NetworkError()] }));
      expect(await readSessionPage(api, CLASS_ID, SESSION), failing).toEqual({
        kind: 'error',
        message: CANT_REACH,
      });
    }
    const busy = new ApiError(429, 'rate_limited', 'too many requests', undefined, 1);
    const api = fakeApi(answers({ [REPORT_PATH]: [busy] }));
    expect(await readSessionPage(api, CLASS_ID, SESSION)).toEqual({
      kind: 'error',
      message: TOO_MANY_TRIES,
    });
  });

  it('says a report that doesn’t say when it ran (an API before PV14) failed, never draws it', async () => {
    const old: SessionReportResponse = { ...REPORT };
    delete old.startedAt;
    delete old.endsAt;
    delete old.endedAt;
    const api = fakeApi(answers({ [REPORT_PATH]: [old] }));
    expect(await readSessionPage(api, CLASS_ID, SESSION)).toEqual({
      kind: 'error',
      message: 'Something went wrong. Try again.',
    });
  });

  it('puts the class and the session in the paths as one segment each', async () => {
    const api = fakeApi({});
    await readSessionPage(api, 'a/b', 'c/d');
    expect(api.asked.sort()).toEqual([
      '/v1/classes/a%2Fb/reports/sessions/c%2Fd',
      '/v1/classes/a%2Fb/roster',
      '/v1/sessions/c%2Fd/events?after=0',
    ]);
  });

  it('has a path of its own, its class then its session', () => {
    expect(reportPath(CLASS_ID, SESSION)).toBe(`/reports/${CLASS_ID}/${SESSION}`);
    expect(reportPath('a/b', 'c?d')).toBe('/reports/a%2Fb/c%3Fd');
  });

  it('takes ids as the API mints them, and nothing else (santa’s review on PV13)', () => {
    expect(UUID.test(SESSION)).toBe(true);
    expect(UUID.test(SESSION.toUpperCase())).toBe(true);
    // `..` survives encodeURIComponent, and would read another route in a class's place.
    for (const other of ['..', '.', '', 'c1', `${SESSION}/..`, ` ${SESSION}`, `${SESSION}x`]) {
      expect(UUID.test(other), other).toBe(false);
    }
  });
});

describe('a session’s questions, its report page’s Questions card (L7c)', () => {
  const SESSION = '0199e3a1-0000-7000-8000-00000000000a';
  const CLASS_ID = '0199e3a1-0000-7000-8000-00000000000c';
  const QUESTIONS = `/v1/classes/${CLASS_ID}/reports/sessions/${SESSION}/questions`;
  const asked = (id: string, counts: number[] | null): SessionReportQuestion => ({
    id,
    prompt: 'Which value of x solves x² − 5x + 6 = 0?',
    options: ['x = 1', 'x = 2', 'x = 4', 'x = 6'],
    correctOption: 1,
    revealed: counts !== null,
    open: false,
    openedAt: MON.startedAt,
    answered: counts === null ? 2 : 21,
    eligible: 28,
    counts,
  });

  it('reads them through L3c’s route, in the order the server gives, its totals as it counted them', async () => {
    // The later first: the order asked is the server's, never sorted here.
    const questions = [asked('q2', null), asked('q1', [3, 14, 1, 3])];
    const api = fakeApi({ [QUESTIONS]: [{ questions }] });
    expect(await readSessionQuestions(api, CLASS_ID, SESSION)).toEqual({
      kind: 'ready',
      questions,
    });
    expect(api.asked).toEqual([QUESTIONS]);
  });

  it('reads none asked as none, for no card', async () => {
    const api = fakeApi({ [QUESTIONS]: [{ questions: [] }] });
    expect(await readSessionQuestions(api, CLASS_ID, SESSION)).toEqual({
      kind: 'ready',
      questions: [],
    });
  });

  it('says any failure as the card’s own, for its Try again', async () => {
    for (const failure of [
      new NetworkError(),
      new ApiError(404, 'not_found', 'no such session', 'session_not_found'),
      new ApiError(429, 'rate_limited', 'too many requests', undefined, 1),
      new ApiError(500, 'internal', 'something broke'),
    ]) {
      const api = fakeApi({ [QUESTIONS]: [failure] });
      expect(await readSessionQuestions(api, CLASS_ID, SESSION), failure.message).toEqual({
        kind: 'error',
      });
    }
  });

  it('puts the class and the session in its path as one segment each', async () => {
    const api = fakeApi({});
    await readSessionQuestions(api, 'a/b', 'c/d');
    expect(api.asked).toEqual(['/v1/classes/a%2Fb/reports/sessions/c%2Fd/questions']);
  });
});
