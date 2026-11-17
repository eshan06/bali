// @vitest-environment jsdom
import type {
  ClassDetail,
  EventsPage,
  MeResponse,
  ReportStudent,
  SessionReportResponse,
  SessionReportsPage,
  SessionReportSummary,
} from '@bali/shared';
import { act, cleanup, render, screen, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Me } from '@/components/shell';
import { type ApiClient, createApiClient } from '@/lib/api-client';
import { CANT_REACH } from '@/lib/errors';
import { CSV_COLUMNS, sessionsCsv } from '@/lib/report-csv';
import { sessionRow } from '@/lib/reports';

import ClassReports from '../classes/[id]/reports/page';
import ReportsPage from './page';

/*
 * Reports (LO8), as a teacher uses it (the owner's decision of 2026-10-22: the portal's tests drive
 * the page), from the lock-only canvas's Reports, HomeStates and PhonePages, its other moments on
 * ReportsMoments (drawn first): a tab per class, the share of the listed sessions' class time spent
 * focused, Download CSV, and the sessions, ten a page, each with how many stayed focused the whole
 * time, as the recap counts them. The shell's read of the account is the test's; Bali's answers come
 * from a stand-in `fetch` under the portal's own client, every request counted.
 */

const nav = vi.hoisted(() => ({
  router: { replace: vi.fn(), push: vi.fn() },
  params: new URLSearchParams(),
  redirect: vi.fn(),
}));
const shell = vi.hoisted((): { me: unknown } => ({ me: null }));
const bali = vi.hoisted(() => {
  const sent: string[] = [];
  /** Bali's answers, by "METHOD path"; anything else is a 404 the test sees. */
  const routes = new Map<string, () => Promise<Response>>();
  const fetch = (url: string | URL | Request, init?: RequestInit) => {
    const key = `${init?.method ?? 'GET'} ${(url as string).replace('http://api', '')}`;
    sent.push(key);
    const route = routes.get(key);
    if (route) return route();
    const error = { code: 'not_found', message: `nothing at ${key}` };
    return Promise.resolve(Response.json({ error }, { status: 404 }));
  };
  return { sent, routes, fetch, client: null as ApiClient | null };
});

vi.mock('next/navigation', () => ({
  useRouter: () => nav.router,
  useSearchParams: () => nav.params,
  redirect: nav.redirect,
}));
vi.mock('@/components/shell', () => ({ useMe: () => shell.me }));
vi.mock('@/lib/use-api', () => ({ useApi: () => bali.client, useSignOut: () => () => undefined }));
vi.mock('@/lib/monitoring', () => ({ captureApiFailure: vi.fn() }));

const uuid = (n: number) => `019a0000-0000-7000-8000-${String(n).padStart(12, '0')}`;
const C1 = uuid(901);
const C2 = uuid(902);
const CLASSES = [
  { id: C1, name: 'Biology, period 3' },
  { id: C2, name: 'Period 1 Biology' },
];
const ANA: ReportStudent = { id: uuid(1), displayName: 'Ana Rodríguez' };
const BEN: ReportStudent = { id: uuid(2), displayName: 'Ben Okafor' };
const CAL: ReportStudent = { id: uuid(3), displayName: 'Cal Brooks' };

/** A lesson over at its bell, 50 minutes from 14:05 UTC on `day`, three joined, one unlock. */
function lesson(n: number, day: string, over: Partial<SessionReportSummary> = {}) {
  return {
    id: uuid(n),
    startedAt: `${day}T14:05:00.000Z`,
    endsAt: `${day}T14:55:00.000Z`,
    endedAt: `${day}T14:55:00.000Z`,
    ended: true,
    joinedCount: 3,
    focusMinutes: 141,
    averageFocusMinutes: 47,
    silentMinutes: 0,
    unlockCount: 1,
    protectionOffCount: 0,
    ...over,
  } satisfies SessionReportSummary;
}
const MON = lesson(12, '2026-10-12', {
  focusMinutes: 144,
  averageFocusMinutes: 48,
  unlockCount: 2,
});
const FRI = lesson(9, '2026-10-09');
const NOBODY = lesson(1, '2026-10-01', {
  endsAt: '2026-10-01T14:06:00.000Z',
  endedAt: '2026-10-01T14:06:00.000Z',
  joinedCount: 0,
  focusMinutes: 0,
  averageFocusMinutes: null,
  unlockCount: 0,
});
const SEP = lesson(30, '2026-09-30', {
  focusMinutes: 150,
  averageFocusMinutes: 50,
  unlockCount: 0,
});

const klass = (id: string) => `/v1/classes/${id}`;
const NEWEST = (id = C1) => `GET ${klass(id)}/reports/sessions?limit=10`;
const EARLIER = (before: string, id = C1) =>
  `GET ${klass(id)}/reports/sessions?limit=10&before=${before}`;
const REPORT = (s: SessionReportSummary, id = C1) => `GET ${klass(id)}/reports/sessions/${s.id}`;
const EVENTS = (s: SessionReportSummary, after: number) =>
  `GET /v1/sessions/${s.id}/events?after=${after}`;

const ok = (body: unknown) => () => Promise.resolve(Response.json(body));
const down = () => Promise.reject(new TypeError('Failed to fetch'));
/** An answer held until the test lets it go. */
function held(body: unknown) {
  let release = () => undefined as void;
  const answer = new Promise<Response>((resolve) => {
    release = () => resolve(Response.json(body));
  });
  return { route: () => answer, release };
}

/**
 * Bali holding a session: its report (R2), everyone joined, those `unlocked` listed with an unlock
 * ten minutes in; its events, each tap-in a minute in, read in two pages, the second empty.
 */
function holds(s: SessionReportSummary, unlocked: ReportStudent[] = [BEN], id = C1) {
  const at = (minutes: number) =>
    new Date(Date.parse(s.startedAt) + minutes * 60_000).toISOString();
  const report: SessionReportResponse = {
    ended: true,
    startedAt: s.startedAt,
    endsAt: s.endsAt,
    endedAt: s.endedAt,
    joined: [ANA, BEN, CAL],
    focusMinutes: s.focusMinutes,
    averageFocusMinutes: s.averageFocusMinutes,
    silentMinutes: 0,
    unlocks: unlocked.map((student, i) => ({
      eventId: `${s.id}-u${i}`,
      student,
      occurredAt: at(10),
      reason: null,
      recordedAs: null,
    })),
    protectionOffs: [],
  };
  const events: EventsPage = {
    events: [ANA, BEN, CAL].map((student, i) => ({
      seq: i + 1,
      eventId: `${s.id}-t${i}`,
      type: 'tap_in',
      userId: student.id,
      occurredAt: at(1),
      payload: {},
    })),
    nextAfter: 3,
  };
  bali.routes.set(REPORT(s, id), ok(report));
  bali.routes.set(EVENTS(s, 0), ok(events));
  bali.routes.set(EVENTS(s, 3), ok({ events: [], nextAfter: 3 }));
  return report;
}

/** The class `id` holding `sessions`, newest first, `before` the cursor to earlier ones. */
function lists(sessions: SessionReportSummary[], before: string | null = null, id = C1) {
  const name = CLASSES.find((c) => c.id === id)?.name ?? 'A class';
  const detail: ClassDetail = {
    id,
    name,
    joinCode: 'K7Q2MX',
    createdAt: '2026-09-01T12:00:00.000Z',
    liveSessionId: null,
  };
  bali.routes.set(`GET ${klass(id)}`, ok(detail));
  bali.routes.set(NEWEST(id), ok({ sessions, nextBefore: before } satisfies SessionReportsPage));
}

const account = (classes = CLASSES): MeResponse => ({
  user: { id: uuid(500), role: 'teacher', displayName: 'Ms. Rivera' },
  classes: classes as MeResponse['classes'],
  session: null,
  armed: false,
});

/** Reports as it opens for a teacher whose account the shell read, `?class=` as given. */
function open(
  classParam: string | null = null,
  home: Me['home'] = { kind: 'teacher', me: account() },
) {
  nav.params = new URLSearchParams(classParam === null ? '' : `class=${classParam}`);
  shell.me = {
    home,
    me: home === null || home.kind === 'invite' ? null : home.me,
    error: null,
    load: vi.fn(),
    refresh: vi.fn(() => Promise.resolve()),
  } satisfies Me;
  return render(
    <main>
      <ReportsPage />
    </main>,
  );
}

/** Each row of the sessions' table, its cells' words. */
function rows() {
  const table = screen.getByRole('table', { name: 'Sessions, newest first' });
  return [...table.querySelectorAll('tr')].map((row) =>
    [...row.querySelectorAll('th, td')].map((cell) => cell.textContent),
  );
}

/** A file saved, its bytes read as they are, the byte-order mark kept. */
async function textOf(blob: Blob) {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  return new TextDecoder('utf-8', { ignoreBOM: true }).decode(bytes);
}
const when = (s: SessionReportSummary) => {
  const { day, times } = sessionRow(s);
  return `${day},${times}`;
};

beforeEach(() => {
  sessionStorage.setItem('bali.access_token', 'tok');
  bali.client = createApiClient({
    baseUrl: 'http://api',
    getToken: () => 'tok',
    fetchImpl: bali.fetch,
  });
});

afterEach(() => {
  if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
  cleanup();
  vi.restoreAllMocks();
  sessionStorage.clear();
  bali.routes.clear();
  bali.sent.length = 0;
  nav.router.replace.mockClear();
});

describe('Reports as a teacher opens it (Reports, PhonePages; LO8)', () => {
  it('is headed Reports over a tab per class, the one ?class= names marked, else the first', async () => {
    lists([], null, C2);
    open(C2);
    expect(screen.getByRole('heading', { level: 1, name: 'Reports' })).toBeDefined();
    const tabs = within(screen.getByRole('navigation', { name: 'Class' })).getAllByRole('link');
    const current = (tab: HTMLElement) => tab.getAttribute('aria-current');
    expect(tabs.map((t) => [t.textContent, t.getAttribute('href'), current(t)])).toEqual([
      ['Biology, period 3', `/reports?class=${C1}`, null],
      ['Period 1 Biology', `/reports?class=${C2}`, 'page'],
    ]);
    // v2's framing line and its pills' "All classes" are gone with its look.
    expect(screen.queryByText(/conversation starters/)).toBeNull();
    expect(screen.queryByText('All classes')).toBeNull();
    await screen.findByText('When a session ends, its report shows here.');
    cleanup();
    lists([]);
    open();
    const first = within(screen.getByRole('navigation', { name: 'Class' })).getByRole('link', {
      name: 'Biology, period 3',
    });
    expect(first.getAttribute('aria-current')).toBe('page');
  });

  it('reads the class’s newest ten, each someone joined counted as its recap counts it, no other', async () => {
    lists([MON, FRI, NOBODY]);
    holds(MON, [BEN, CAL]);
    holds(FRI);
    open();
    await screen.findByRole('table', { name: 'Sessions, newest first' });
    expect(rows()).toEqual([
      [
        'Session',
        'Joined',
        'Focused the whole time',
        'Average time focused',
        'Emergency unlocks',
        'Protection off',
      ],
      [when(MON), '3', '1', '48 of 50 min', '2', '0'],
      [when(FRI), '3', '2', '47 of 50 min', '1', '0'],
      // No zeros for a session nobody joined, as its recap says (R5): one cell across three.
      [when(NOBODY), 'Nobody joined', '0', '0'],
    ]);
    expect(screen.getByRole('cell', { name: 'Nobody joined' }).getAttribute('colspan')).toBe('3');
    // The session nobody joined has no count to read.
    expect(bali.sent.filter((key) => key.includes(NOBODY.id))).toEqual([]);
    expect(bali.sent).toEqual(
      expect.arrayContaining([NEWEST(), REPORT(MON), EVENTS(MON, 0), EVENTS(MON, 3), REPORT(FRI)]),
    );
  });

  it('heads each row with its session, a link to its own page, its day over its times', async () => {
    lists([MON, NOBODY]);
    holds(MON);
    open();
    const table = await screen.findByRole('table', { name: 'Sessions, newest first' });
    const heads = within(table).getAllByRole('rowheader');
    expect(heads).toHaveLength(2);
    // One link a row, its day and its times its words, so two sessions of a day never read alike.
    const links = heads.map((head) => within(head).getByRole('link'));
    expect(links.map((link) => [link.textContent, link.getAttribute('href')])).toEqual([
      [when(MON), `/reports/${C1}/${MON.id}`],
      [when(NOBODY), `/reports/${C1}/${NOBODY.id}`],
    ]);
    // The average's bar is its words' picture alone: hidden from a screen reader, its share drawn.
    const bar = within(screen.getByRole('table')).getByText('48 of 50 min').querySelector('span');
    expect(bar?.getAttribute('aria-hidden')).toBe('true');
    expect((bar?.firstElementChild as HTMLElement).style.width).toBe('96%');
  });

  it('says the share of the listed sessions’ class time spent focused, rounded down', async () => {
    // (144 + 141 + 150) of 3 × 50 × 3 = 435 of 450 minutes: 96.67 %, said 96 %.
    lists([MON, FRI, NOBODY, SEP]);
    for (const s of [MON, FRI, SEP]) holds(s);
    open();
    const share = await screen.findByText('of class time spent focused');
    expect(share.parentElement?.textContent).toBe(
      `${new Intl.NumberFormat(undefined, { style: 'percent' }).format(0.96)}of class time spent focused`,
    );
  });

  it('saves the sessions listed as a CSV, a row each, with no student’s name', async () => {
    lists([MON, FRI, NOBODY]);
    holds(MON, [BEN, CAL]);
    holds(FRI);
    const saved: Blob[] = [];
    URL.createObjectURL = vi.fn((blob: Blob) => {
      saved.push(blob);
      return 'blob:reports';
    });
    URL.revokeObjectURL = vi.fn();
    const clicked: { name: string; href: string }[] = [];
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
      this: HTMLAnchorElement,
    ) {
      clicked.push({ name: this.download, href: this.href });
    });
    open();
    await userEvent.setup().click(await screen.findByRole('button', { name: 'Download CSV' }));
    expect(clicked).toEqual([{ name: 'Biology, period 3 sessions.csv', href: 'blob:reports' }]);
    const text = await textOf(saved[0]);
    expect(saved[0].type).toBe('text/csv;charset=utf-8');
    // The table's sessions and their counts, as `sessionsCsv` writes them (lib/report-csv.test.ts).
    const wholeTime = { [MON.id]: 1, [FRI.id]: 2 };
    expect(text).toBe(
      sessionsCsv('Biology, period 3', { sessions: [MON, FRI, NOBODY], wholeTime }),
    );
    const lines = text.slice(1).trimEnd().split('\r\n');
    expect(lines[0]).toBe(CSV_COLUMNS.join(','));
    expect(lines).toHaveLength(4);
    // The session totals alone: no student's name, nor their id.
    for (const student of [ANA, BEN, CAL]) {
      expect(text).not.toContain(student.displayName);
      expect(text).not.toContain(student.id);
    }
  });

  it('has no share when nobody joined any session listed: Download CSV alone (ReportsMoments)', async () => {
    lists([NOBODY]);
    open();
    await screen.findByRole('table', { name: 'Sessions, newest first' });
    expect(screen.queryByText('of class time spent focused')).toBeNull();
    expect(screen.getByRole('button', { name: 'Download CSV' })).toBeDefined();
  });

  it('says there is none yet for a class with no session over, and for a teacher with no class, no tabs', async () => {
    lists([]);
    open();
    await screen.findByText('When a session ends, its report shows here.');
    expect(screen.queryByRole('table')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Download CSV' })).toBeNull();
    cleanup();
    bali.sent.length = 0;
    open(null, { kind: 'teacher', me: account([]) });
    expect(screen.getByText('When a session ends, its report shows here.')).toBeDefined();
    expect(screen.queryByRole('navigation', { name: 'Class' })).toBeNull();
    expect(bali.sent).toEqual([]);
  });

  it('reads no class for an account the 13+ check never passed: none yet, no tabs (PV15)', () => {
    open(null, { kind: 'invite' });
    expect(screen.getByText('When a session ends, its report shows here.')).toBeDefined();
    expect(screen.queryByRole('navigation', { name: 'Class' })).toBeNull();
    expect(bali.sent).toEqual([]);
  });

  it('sends a tab with no sign-in to sign in, reading nothing', () => {
    sessionStorage.clear();
    open();
    expect(nav.router.replace).toHaveBeenCalledWith('/login');
    expect(bali.sent).toEqual([]);
  });

  it('takes only a class id from ?class=, so no other path reaches the API (santa’s review, PV13)', async () => {
    lists([]);
    open('..%2F..%2Fme');
    await screen.findByText('When a session ends, its report shows here.');
    expect(bali.sent.every((key) => key.startsWith(`GET ${klass(C1)}`))).toBe(true);
  });
});

describe('Reports in between (ReportsMoments, drawn first)', () => {
  it('says it is loading the sessions under the tabs until they are read and counted', async () => {
    lists([MON]);
    // The page read, its one session's count still on its way.
    const report = held(holds(MON));
    bali.routes.set(REPORT(MON), report.route);
    open();
    const line = await screen.findByRole('status');
    expect(line.textContent).toBe('Loading sessions…');
    expect(screen.getByRole('navigation', { name: 'Class' })).toBeDefined();
    await act(() => Promise.resolve());
    expect(bali.sent).toContain(REPORT(MON));
    expect(screen.queryByRole('table')).toBeNull();
    expect(screen.queryByText('of class time spent focused')).toBeNull();
    await act(async () => {
      report.release();
      await Promise.resolve();
    });
    await screen.findByRole('table', { name: 'Sessions, newest first' });
    expect(screen.queryByText('Loading sessions…')).toBeNull();
  });

  it('says why the sessions didn’t load, Try again held while it reads them, then focus on the table', async () => {
    bali.routes.set(`GET ${klass(C1)}`, down);
    bali.routes.set(NEWEST(), down);
    open();
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toBe(`Couldn't load the sessions. ${CANT_REACH}`);
    const again = screen.getByRole('button', { name: 'Try again' });
    expect(screen.queryByText('Loading sessions…')).toBeNull();
    const answer = held({ sessions: [MON], nextBefore: null });
    lists([MON]);
    bali.routes.set(NEWEST(), answer.route);
    holds(MON);
    const user = userEvent.setup();
    await user.click(again);
    // Its line kept and Try again held as Loading… until Bali answers, so focus stays on it.
    expect(again.getAttribute('aria-busy')).toBe('true');
    expect(again.textContent).toBe('Loading…');
    expect(screen.getByRole('alert')).toBeDefined();
    expect(screen.queryByText('Loading sessions…')).toBeNull();
    await act(async () => {
      answer.release();
      await Promise.resolve();
    });
    const table = await screen.findByRole('table', { name: 'Sessions, newest first' });
    await act(() => new Promise((frame) => requestAnimationFrame(frame)));
    expect(document.activeElement).toBe(table);
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('says a count that failed as the sessions not loading; Try again reads only the counts not in', async () => {
    lists([MON, FRI]);
    holds(MON);
    holds(FRI);
    bali.routes.set(REPORT(FRI), () =>
      Promise.resolve(
        Response.json({ error: { code: 'internal', message: 'internal error' } }, { status: 500 }),
      ),
    );
    open();
    expect((await screen.findByRole('alert')).textContent).toMatch(
      /^Couldn.t load the sessions\. /,
    );
    expect(screen.queryByRole('table')).toBeNull();
    holds(FRI);
    bali.sent.length = 0;
    await userEvent.setup().click(screen.getByRole('button', { name: 'Try again' }));
    await screen.findByRole('table', { name: 'Sessions, newest first' });
    // Monday's count was in: only Friday's is read again, with the page.
    expect(bali.sent.filter((key) => key.includes(MON.id))).toEqual([]);
    expect(bali.sent).toContain(REPORT(FRI));
  });

  it('shows earlier sessions, each counted, Show earlier held while it reads, then gone, focus on the table', async () => {
    lists([MON], MON.id);
    holds(MON);
    holds(FRI);
    const answer = held({ sessions: [FRI, NOBODY], nextBefore: null });
    bali.routes.set(EARLIER(MON.id), answer.route);
    open();
    const show = await screen.findByRole('button', { name: 'Show earlier' });
    const user = userEvent.setup();
    await user.click(show);
    expect(show.textContent).toBe('Loading…');
    expect(show.getAttribute('aria-busy')).toBe('true');
    // The sessions listed, the share and Download CSV stay as they are meanwhile.
    expect(rows()).toHaveLength(2);
    expect(screen.getByRole('button', { name: 'Download CSV' })).toBeDefined();
    await act(async () => {
      answer.release();
      await Promise.resolve();
    });
    await screen.findByRole('cell', { name: 'Nobody joined' });
    expect(
      rows()
        .slice(1)
        .map((r) => r[0]),
    ).toEqual([when(MON), when(FRI), when(NOBODY)]);
    expect(rows()[2]?.[2]).toBe('2');
    expect(screen.queryByRole('button', { name: /Show earlier|Loading/ })).toBeNull();
    await act(() => new Promise((frame) => requestAnimationFrame(frame)));
    expect(document.activeElement).toBe(screen.getByRole('table'));
  });

  it('says earlier sessions didn’t load, Try again in Show earlier’s place, the sessions listed kept', async () => {
    lists([MON], MON.id);
    holds(MON);
    bali.routes.set(EARLIER(MON.id), down);
    open();
    await userEvent.setup().click(await screen.findByRole('button', { name: 'Show earlier' }));
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toBe(`Couldn't load earlier sessions. ${CANT_REACH}`);
    expect(screen.getByRole('button', { name: 'Try again' })).toBeDefined();
    expect(screen.queryByRole('button', { name: 'Show earlier' })).toBeNull();
    expect(rows()).toHaveLength(2);
    expect(screen.getByText('of class time spent focused')).toBeDefined();
  });

  it('says the place was lost when the class no longer holds the cursor, the newest read again', async () => {
    lists([MON], MON.id);
    holds(MON);
    const stale = {
      code: 'bad_input',
      message: 'before is not a session',
      reason: 'unknown_cursor',
    };
    bali.routes.set(EARLIER(MON.id), () =>
      Promise.resolve(Response.json({ error: stale }, { status: 400 })),
    );
    open();
    await userEvent.setup().click(await screen.findByRole('button', { name: 'Show earlier' }));
    const line = await screen.findByText(
      'Bali lost your place in the list, so it starts again from the newest session.',
    );
    expect(line.getAttribute('role')).toBe('status');
    expect(rows()).toHaveLength(2);
  });

  it('starts another class’s list afresh as it is picked, and reads no count again for a class picked again', async () => {
    lists([MON]);
    holds(MON);
    lists([SEP], null, C2);
    holds(SEP, [BEN], C2);
    const view = open();
    await screen.findByRole('table');
    nav.params = new URLSearchParams(`class=${C2}`);
    view.rerender(
      <main>
        <ReportsPage />
      </main>,
    );
    // Never the last class's rows under this one's tab.
    expect(screen.queryByRole('link', { name: new RegExp(sessionRow(MON).day) })).toBeNull();
    await screen.findByRole('link', { name: new RegExp(sessionRow(SEP).day) });
    bali.sent.length = 0;
    nav.params = new URLSearchParams(`class=${C1}`);
    view.rerender(
      <main>
        <ReportsPage />
      </main>,
    );
    await screen.findByRole('link', { name: new RegExp(sessionRow(MON).day) });
    expect(bali.sent.sort()).toEqual([`GET ${klass(C1)}`, NEWEST()].sort());
  });

  it('scrolls sideways in a box of its own, at least 720 px wide on a phone, each cell on one line', async () => {
    lists([MON]);
    holds(MON);
    open();
    const table = await screen.findByRole('table');
    expect(table.parentElement?.className.split(' ')).toContain('overflow-x-auto');
    expect(table.className.split(' ')).toEqual(
      expect.arrayContaining([
        'max-[760px]:min-w-180',
        'max-[760px]:[&_:is(th,td)]:whitespace-nowrap',
      ]),
    );
  });
});

describe('a class’s old reports URL', () => {
  it('lands on Reports with that class picked', async () => {
    await ClassReports({ params: Promise.resolve({ id: C1 }) });
    expect(nav.redirect).toHaveBeenLastCalledWith(`/reports?class=${C1}`);
    await ClassReports({ params: Promise.resolve({ id: 'a&b' }) });
    expect(nav.redirect).toHaveBeenLastCalledWith('/reports?class=a%26b');
  });
});
