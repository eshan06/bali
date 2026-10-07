import type {
  FeedEvent,
  ReportStudent,
  SessionReportResponse,
  SessionReportsPage,
  SessionReportSummary,
  UnlockReason,
} from '@bali/shared';
import { UNLOCK_REASONS } from '@bali/shared';
import { describe, expect, it } from 'vitest';

import { ApiError, NetworkError } from './api-client';
import { CANT_REACH, TOO_MANY_TRIES } from './errors';
import { latestEnded, loadRecap, type RecapState, recapView, sessionTimes } from './recap';

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
  unlockCount: 3,
  protectionOffCount: 1,
};
const RUNNING: SessionReportSummary = { ...SESSION, id: 's2', endedAt: null, ended: false };

const maya: ReportStudent = { id: '0199b0a1-0000-7000-8000-000000000001', displayName: 'Maya' };
const theo: ReportStudent = { id: '0199b0a1-0000-7000-8000-000000000002', displayName: 'Theo' };
const priya: ReportStudent = { id: '0199b0a1-0000-7000-8000-000000000003', displayName: 'Priya' };
const unnamed: ReportStudent = { id: '0199b0a1-ffff-7000-8000-000000000004', displayName: null };

const REPORT: SessionReportResponse = {
  ended: true,
  joined: [theo, maya, unnamed, priya],
  focusMinutes: 83,
  averageFocusMinutes: 21,
  silentMinutes: 2,
  unlocks: [
    {
      eventId: 'u1',
      student: maya,
      occurredAt: '2026-10-04T13:11:00.000Z',
      reason: 'bathroom',
      recordedAs: null,
    },
    // Late (A10): it changed nothing, and is listed all the same.
    {
      eventId: 'u2',
      student: theo,
      occurredAt: '2026-10-04T13:18:00.000Z',
      reason: null,
      recordedAs: 'superseded',
    },
    // A newer build's reason, met mid-deploy.
    {
      eventId: 'u3',
      student: theo,
      occurredAt: '2026-10-04T13:24:00.000Z',
      reason: 'counselor' as UnlockReason,
      recordedAs: null,
    },
  ],
  protectionOffs: [
    { eventId: 'p1', student: priya, occurredAt: '2026-10-04T13:22:00.000Z', recordedAs: null },
  ],
};

/** The session's feed, as the catch-up read pages it: one page, then an empty one. */
const EVENTS: FeedEvent[] = [
  {
    seq: 1,
    eventId: 'e1',
    type: 'tap_in',
    userId: theo.id,
    occurredAt: '2026-10-04T13:05:00.000Z',
    payload: {},
  },
];

/** Intl puts a narrow no-break space before AM and PM; the tests read every space as one. */
const plain = (s: string) => s.replace(/\s/g, ' ');

function page(...sessions: SessionReportSummary[]): SessionReportsPage {
  return { sessions, nextBefore: null };
}

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

async function states(api: ReturnType<typeof fakeApi>, classId = 'c1'): Promise<RecapState[]> {
  const shown: RecapState[] = [];
  await loadRecap(api, classId, undefined, (s) => shown.push(s));
  return shown;
}

const LIST = '/v1/classes/c1/reports/sessions?limit=1';
const ONE = '/v1/classes/c1/reports/sessions/s1';
const FEED = '/v1/sessions/s1/events?after=0';
const FEED_END = '/v1/sessions/s1/events?after=1';
const READ = { [FEED]: { events: EVENTS, nextAfter: 1 }, [FEED_END]: { events: [], nextAfter: 1 } };

describe('latestEnded', () => {
  it('is the newest session once the server has marked it over', () => {
    expect(latestEnded(page(SESSION))).toBe(SESSION);
  });

  it('is none while the newest runs, or waits for the sweep, whatever ended before it', () => {
    expect(latestEnded(page(RUNNING, SESSION))).toBeNull();
    expect(latestEnded(page())).toBeNull();
  });
});

describe('loadRecap', () => {
  it('reads the newest session, then its report and its events together', async () => {
    const api = fakeApi({ [LIST]: page(SESSION), [ONE]: REPORT, ...READ });
    expect(await states(api)).toEqual([
      { kind: 'loading', session: SESSION },
      { kind: 'ready', session: SESSION, report: REPORT, events: EVENTS },
    ]);
    expect(api.asked).toEqual([LIST, ONE, FEED, FEED_END]);
  });

  it('shows nothing for a class with no session over, and reads no report', async () => {
    for (const sessions of [page(), page(RUNNING, SESSION)]) {
      const api = fakeApi({ [LIST]: sessions });
      expect(await states(api)).toEqual([{ kind: 'none' }]);
      expect(api.asked).toEqual([LIST]);
    }
  });

  it('says why any read failed, the events’ included, for the card’s Try again', async () => {
    const noList = fakeApi({ [LIST]: new NetworkError() });
    expect(await states(noList)).toEqual([{ kind: 'error', message: CANT_REACH }]);

    const busy = new ApiError(429, 'rate_limited', 'too many requests from this account');
    const noReport = fakeApi({ [LIST]: page(SESSION), [ONE]: busy, ...READ });
    expect(await states(noReport)).toEqual([
      { kind: 'loading', session: SESSION },
      { kind: 'error', message: TOO_MANY_TRIES },
    ]);

    // The timeline is the recap: its events unread, its figures are never shown without it.
    for (const failing of [FEED, FEED_END]) {
      const noEvents = fakeApi({
        [LIST]: page(SESSION),
        [ONE]: REPORT,
        ...READ,
        [failing]: new NetworkError(),
      });
      expect(await states(noEvents)).toEqual([
        { kind: 'loading', session: SESSION },
        { kind: 'error', message: CANT_REACH },
      ]);
    }
  });

  it('reads a session the reports page opened, its report and events alone (R5)', async () => {
    const api = fakeApi({ [ONE]: REPORT, ...READ });
    const shown: RecapState[] = [];
    await loadRecap(api, 'c1', SESSION, (s) => shown.push(s));
    expect(shown).toEqual([
      { kind: 'loading', session: SESSION },
      { kind: 'ready', session: SESSION, report: REPORT, events: EVENTS },
    ]);
    expect(api.asked).toEqual([ONE, FEED, FEED_END]);

    const failing = fakeApi({ [ONE]: REPORT, [FEED]: new NetworkError() });
    const failed: RecapState[] = [];
    await loadRecap(failing, 'c1', SESSION, (s) => failed.push(s));
    expect(failed.at(-1)).toEqual({ kind: 'error', message: CANT_REACH });
  });

  it('puts the class id in the path as one segment', async () => {
    const api = fakeApi({ '/v1/classes/a%2Fb/reports/sessions?limit=1': page() });
    expect(await states(api, 'a/b')).toEqual([{ kind: 'none' }]);
  });
});

describe('sessionTimes', () => {
  it('says the day, and its start to its end, in the viewer’s own format', () => {
    expect(plain(sessionTimes(SESSION, NY))).toBe('Sun, Oct 4, 9:05 AM to 9:30 AM');
  });

  it('ends where the teacher ended it, and at the bell where nothing has marked it yet', () => {
    const early = { ...SESSION, endedAt: '2026-10-04T13:21:00.000Z' };
    expect(plain(sessionTimes(early, NY))).toBe('Sun, Oct 4, 9:05 AM to 9:21 AM');
    expect(plain(sessionTimes(RUNNING, NY))).toBe('Sun, Oct 4, 9:05 AM to 9:30 AM');
  });
});

describe('recapView', () => {
  it('gives the class’s figures, each a number in the viewer’s format, nothing per student', () => {
    expect(recapView(SESSION, REPORT, EVENTS, NY).stats).toEqual({
      joined: '4',
      focus: '83',
      average: '21',
      silent: '2',
    });
    expect(recapView(SESSION, { ...REPORT, focusMinutes: 1214 }, EVENTS, NY).stats?.focus).toBe(
      '1,214',
    );
  });

  it('has no figures when nobody joined, and still marks what was recorded', () => {
    const nobody = { ...REPORT, joined: [], averageFocusMinutes: null };
    const view = recapView(SESSION, nobody, [], NY);
    expect(view.stats).toBeNull();
    // Every unlock and protection off R2 lists keeps its row (the timeline's own tests say more).
    expect(view.timeline.rows.map((r) => r.name)).toEqual(['Maya', 'Theo', 'Priya']);
  });

  it('gives Present the same figures and the same marks, never an unlock’s reason (#265)', () => {
    const teacher = recapView(SESSION, REPORT, EVENTS, NY);
    const projected = recapView(SESSION, REPORT, EVENTS, NY, true);
    expect(projected.stats).toEqual(teacher.stats);
    const reasons = (view: typeof teacher) =>
      view.timeline.rows.flatMap((r) => r.marks.map((m) => m.reason)).filter(Boolean);
    expect(reasons(teacher)).toEqual(['No reason given', 'No reason given', 'Bathroom']);
    expect(reasons(projected)).toEqual([]);
    for (const reason of UNLOCK_REASONS) {
      const report = { ...REPORT, unlocks: [{ ...REPORT.unlocks[0], reason }] };
      expect(reasons(recapView(SESSION, report, EVENTS, NY, true))).toEqual([]);
    }
  });
});
