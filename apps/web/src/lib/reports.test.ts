import type { ClassDetail, SessionReportsPage, SessionReportSummary } from '@bali/shared';
import { describe, expect, it } from 'vitest';

import { ApiError, NetworkError } from './api-client';
import { CANT_REACH, TOO_MANY_TRIES } from './errors';
import { recapView } from './recap';
import { FIRST_READ, readSessions, type SessionList, sessionRow, startRead } from './reports';

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
const NEWEST = '/v1/classes/c1/reports/sessions';
const after = (id: string) => `/v1/classes/c1/reports/sessions?before=${id}`;
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

/** The list once its newest page, `first`, has answered. */
async function loaded(first: SessionReportsPage): Promise<SessionList> {
  return readSessions(fakeApi({ [CLASS]: [KLASS], [NEWEST]: [first] }), 'c1', FIRST_READ, 'newest');
}

describe('readSessions', () => {
  it('reads the newest page with the class, listing the sessions the server has marked over', async () => {
    const api = fakeApi({ [CLASS]: [KLASS], [NEWEST]: [page('s2', RUNNING, MON, SUN)] });
    const list = await readSessions(api, 'c1', FIRST_READ, 'newest');
    expect(list).toEqual({
      className: 'Biology, period 3',
      sessions: [MON, SUN],
      nextBefore: 's2',
      loaded: true,
      reading: null,
      failure: null,
      restarted: false,
    });
    expect(api.asked.sort()).toEqual([CLASS, NEWEST]);
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
    const api = fakeApi({ [after('s2')]: [page(null, SUN, SAT)] });
    const more = await readSessions(api, 'c1', startRead(list, 'earlier'), 'earlier');
    expect(more.sessions).toEqual([MON, SUN, SAT]);
    expect(more.nextBefore).toBeNull();
    expect(more.reading).toBeNull();
    expect(api.asked).toEqual([after('s2')]);
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
    const list = await loaded(page('s2', MON, SUN));
    const api = fakeApi({
      [after('s2')]: [STALE],
      [CLASS]: [KLASS],
      [NEWEST]: [page('s3', RUNNING, MON)],
    });
    const again = await readSessions(api, 'c1', startRead(list, 'earlier'), 'earlier');
    expect(again).toMatchObject({
      sessions: [MON],
      nextBefore: 's3',
      reading: null,
      failure: null,
      restarted: true,
    });
    expect(api.asked.slice(0, 1)).toEqual([after('s2')]);
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
    const api = fakeApi({
      '/v1/classes/a%2Fb': [{ ...KLASS, id: 'a/b' }],
      '/v1/classes/a%2Fb/reports/sessions': [page('x&y', MON)],
      '/v1/classes/a%2Fb/reports/sessions?before=x%26y': [page(null)],
    });
    const list = await readSessions(api, 'a/b', FIRST_READ, 'newest');
    expect((await readSessions(api, 'a/b', list, 'earlier')).nextBefore).toBeNull();
  });
});

describe('startRead', () => {
  it('starts a read, and what the last one said goes with it', () => {
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
      failure: null,
      restarted: false,
    });
  });
});

describe('sessionRow', () => {
  it('says when the session ran, and the class’s figures as its recap says them', () => {
    const row = sessionRow(MON, NY);
    expect({ ...row, when: row.when.replace(/\s/g, ' ') }).toEqual({
      when: 'Mon, Oct 5, 9:05 AM to 9:30 AM',
      figures: { joined: '4', focus: '83 min', average: '21 min', silent: '2 min' },
      unlocks: '3',
      protectionOffs: '1',
    });
    const report = {
      ended: true,
      joined: [],
      focusMinutes: 83,
      averageFocusMinutes: 21,
      silentMinutes: 2,
      unlocks: [],
      protectionOffs: [],
    };
    const joined = Array.from({ length: 4 }, (_, i) => ({ id: `u${i}`, displayName: null }));
    expect(row.figures).toEqual(recapView({ ...report, joined }, NY).stats);
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
    expect(sessionRow(big, NY).figures?.focus).toBe('1,250 min');
  });
});
