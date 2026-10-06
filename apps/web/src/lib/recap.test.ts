import type {
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
  it('reads the newest session, then its report', async () => {
    const api = fakeApi({ [LIST]: page(SESSION), [ONE]: REPORT });
    expect(await states(api)).toEqual([
      { kind: 'loading', session: SESSION },
      { kind: 'ready', session: SESSION, report: REPORT },
    ]);
    expect(api.asked).toEqual([LIST, ONE]);
  });

  it('shows nothing for a class with no session over, and reads no report', async () => {
    for (const sessions of [page(), page(RUNNING, SESSION)]) {
      const api = fakeApi({ [LIST]: sessions });
      expect(await states(api)).toEqual([{ kind: 'none' }]);
      expect(api.asked).toEqual([LIST]);
    }
  });

  it('says why either read failed, for the card’s Try again', async () => {
    const noList = fakeApi({ [LIST]: new NetworkError() });
    expect(await states(noList)).toEqual([{ kind: 'error', message: CANT_REACH }]);

    const busy = new ApiError(429, 'rate_limited', 'too many requests from this account');
    const noReport = fakeApi({ [LIST]: page(SESSION), [ONE]: busy });
    expect(await states(noReport)).toEqual([
      { kind: 'loading', session: SESSION },
      { kind: 'error', message: TOO_MANY_TRIES },
    ]);
  });

  it('reads a session the reports page opened, its report alone (R5)', async () => {
    const api = fakeApi({ [ONE]: REPORT });
    const shown: RecapState[] = [];
    await loadRecap(api, 'c1', SESSION, (s) => shown.push(s));
    expect(shown).toEqual([
      { kind: 'loading', session: SESSION },
      { kind: 'ready', session: SESSION, report: REPORT },
    ]);
    expect(api.asked).toEqual([ONE]);

    const failing = fakeApi({ [ONE]: new NetworkError() });
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
  const view = recapView(REPORT, NY);

  it('gives the class’s figures and nothing per student', () => {
    expect(view.stats).toEqual({
      joined: '4',
      focus: '83 min',
      average: '21 min',
      silent: '2 min',
    });
  });

  it('names who joined in R2’s order, an account with no name by the start of its id', () => {
    expect(view.joined.map((s) => s.name)).toEqual(['Theo', 'Maya', '0199b0a1', 'Priya']);
  });

  it('lists every unlock with its time and reason, one with none or an unknown one said so', () => {
    expect(view.unlocks.map((u) => [u.key, u.name, plain(u.time), u.reason])).toEqual([
      ['u1', 'Maya', '9:11 AM', 'Bathroom'],
      ['u2', 'Theo', '9:18 AM', 'No reason given'],
      ['u3', 'Theo', '9:24 AM', 'No reason given'],
    ]);
  });

  it('lists every protection off with its time, and no reason', () => {
    expect(view.protectionOffs.map((p) => [p.key, p.name, plain(p.time), p.reason])).toEqual([
      ['p1', 'Priya', '9:22 AM', undefined],
    ]);
  });

  it('has no figures when nobody joined, and still lists what was recorded', () => {
    const empty = recapView(
      {
        ...REPORT,
        joined: [],
        focusMinutes: 0,
        averageFocusMinutes: null,
        silentMinutes: 0,
        protectionOffs: [],
      },
      NY,
    );
    expect(empty.stats).toBeNull();
    expect(empty.joined).toEqual([]);
    expect(empty.unlocks).toHaveLength(3);
  });

  it('reads the reasons a student can pick as their phone shows them', () => {
    const reasons = (['bathroom', 'nurse', 'other'] as const).map(
      (reason) =>
        recapView({ ...REPORT, unlocks: [{ ...REPORT.unlocks[0], reason }] }, NY).unlocks[0].reason,
    );
    expect(reasons).toEqual(['Bathroom', 'Nurse', 'Other']);
  });
});

describe('the recap in Present, the projector the class can see (D2g)', () => {
  // A session that ends while the page is projected shows its recap on the projector: a reason
  // is the student's to the teacher alone (#265), so it stays off, and nothing else changes.
  it('lists every unlock by who and when, never its reason; the rest as the teacher sees it', () => {
    const teacher = recapView(REPORT, NY);
    const projected = recapView(REPORT, NY, true);
    expect(projected.unlocks.map((u) => [u.key, u.name, plain(u.time), u.reason])).toEqual([
      ['u1', 'Maya', '9:11 AM', undefined],
      ['u2', 'Theo', '9:18 AM', undefined],
      ['u3', 'Theo', '9:24 AM', undefined],
    ]);
    expect(projected.stats).toEqual(teacher.stats);
    expect(projected.joined).toEqual(teacher.joined);
    expect(projected.protectionOffs).toEqual(teacher.protectionOffs);
  });

  it('keeps every reason a student can pick off it', () => {
    for (const reason of UNLOCK_REASONS) {
      const report = { ...REPORT, unlocks: [{ ...REPORT.unlocks[0], reason }] };
      expect(recapView(report, NY, true).unlocks[0].reason).toBeUndefined();
      expect(recapView(report, NY).unlocks[0].reason).toBeDefined();
    }
  });
});
