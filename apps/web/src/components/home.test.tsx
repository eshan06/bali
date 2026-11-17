// @vitest-environment jsdom
import type {
  EventsPage,
  FeedEvent,
  MeResponse,
  RosterResponse,
  SessionReportResponse,
  SessionSnapshot,
  SnapshotStudent,
} from '@bali/shared';
import { act, cleanup, render, screen, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { type ApiClient, createApiClient } from '@/lib/api-client';
import type { TaughtClass } from '@/lib/classes';
import { CANT_REACH } from '@/lib/errors';
import { fromSnapshot } from '@/lib/grid-state';
import { bellTime } from '@/lib/session-controls';

import {
  checkOn,
  dayOf,
  LiveWellView,
  nextTurn,
  presentHref,
  studentHref,
  TeacherHome,
} from './home';
import type { GridNow } from './live-grid';

/*
 * A teacher's Home, one page for their classes (LO3; the lock-only canvas's Main, HomeIdle,
 * HomeStates and PhonePages, its other moments on HomeMoments), as a teacher meets it (the owner's
 * decision of 2026-10-22: the portal's tests drive the page). Bali's answers come from a stand-in
 * `fetch` under the portal's own client, each held until the test gives it where a test says so; no
 * stream runs, so a live class is its snapshot.
 */

const bali = vi.hoisted(() => {
  /** A request on its way: what was sent, and its answer, the test's to give. */
  interface Call {
    key: string;
    body: unknown;
    answer: (res: Response) => void;
  }
  /** Each route's answer, by "METHOD path": [status, body], or held for the test. */
  const routes = new Map<string, () => [number, unknown] | 'hold'>();
  const held: Call[] = [];
  const sent: string[] = [];
  const fetch = (url: string | URL | Request, init?: RequestInit) =>
    new Promise<Response>((answer, fail) => {
      init?.signal?.addEventListener('abort', () =>
        fail(new DOMException('The operation was aborted.', 'AbortError')),
      );
      const key = `${init?.method ?? 'GET'} ${(url as string).replace('http://api', '')}`;
      sent.push(key);
      const body = typeof init?.body === 'string' ? (JSON.parse(init.body) as unknown) : null;
      const route = routes.get(key) ?? routes.get(key.replace(/\?.*$/, ''));
      const said = route
        ? route()
        : ([404, { error: { code: 'not_found', message: key } }] as const);
      if (said === 'hold') held.push({ key, body, answer });
      else if (said[0] === 0) fail(new TypeError('Failed to fetch'));
      else answer(Response.json(said[1], { status: said[0] }));
    });
  // One sign-out for every render, as the hook's memo keeps it: the grid reads once as it opens.
  const signOut = () => undefined;
  return { routes, held, sent, fetch, signOut, client: null as ApiClient | null };
});

vi.mock('@/lib/use-api', () => ({ useApi: () => bali.client, useSignOut: () => bali.signOut }));
vi.mock('@/lib/sse-client', () => ({ createSseClient: () => ({ close: () => undefined }) }));
vi.mock('@/lib/monitoring', () => ({ captureApiFailure: vi.fn() }));

beforeAll(() => {
  // jsdom draws a `<dialog>` but has no `showModal` or `close`: these do what the browser does.
  HTMLDialogElement.prototype.showModal = function showModal(this: HTMLDialogElement) {
    this.setAttribute('open', '');
  };
  HTMLDialogElement.prototype.close = function close(this: HTMLDialogElement) {
    if (!this.open) return;
    this.removeAttribute('open');
    this.dispatchEvent(new Event('close'));
  };
});

beforeEach(() => {
  bali.client = createApiClient({
    baseUrl: 'http://api',
    getToken: () => 'tok',
    fetchImpl: bali.fetch,
  });
  bali.routes.set('GET /v1/blocks', () => [200, { blocks: [] }]);
});

afterEach(() => {
  // Focus off first, so no Try again unmounted here hands focus on in the next test's page.
  if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
  cleanup();
  vi.useRealTimers();
  bali.routes.clear();
  bali.held.length = 0;
  bali.sent.length = 0;
});

/** Bali's answers so far, and what they set off, drawn. */
const settle = () =>
  act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 20));
  });

/** The request held for `key`, answered now with `body` (status 200 unless given). */
async function give(key: string, body: unknown, status = 200) {
  const at = bali.held.findIndex((call) => call.key === key);
  if (at < 0) throw new Error(`no ${key} on its way`);
  const [call] = bali.held.splice(at, 1);
  await act(async () => {
    call?.answer(Response.json(body, { status }));
    await new Promise((resolve) => setTimeout(resolve, 20));
  });
}

const NOW = Date.now();
const iso = (ms: number) => new Date(ms).toISOString();
const MIN = 60_000;
const BELL = iso(NOW + 23 * MIN + 4000);

function taught(
  id: string,
  name: string,
  over: { count?: number; running?: { id: string; endsAt: string }; last?: string } = {},
): TaughtClass {
  const { count = 26, running = null, last } = over;
  return {
    id,
    name,
    teacher: { displayName: 'Ms. Rivera' },
    enrollmentId: null,
    liveSession: null,
    summary: {
      studentCount: count,
      runningSession: running,
      lastSession: last
        ? { id: `s-${id}`, startedAt: last, endedAt: iso(Date.parse(last) + 50 * MIN) }
        : null,
    },
  };
}

const LIVE = taught('c3', 'Biology, period 3', { count: 28, running: { id: 'S', endsAt: BELL } });
const TODAY = taught('c1', 'Period 1 Biology', { last: iso(NOW - 3 * 60 * MIN) });
const NEVER = taught('c6', 'Period 6 AP Biology', { count: 24 });

const me = (classes: TaughtClass[]): MeResponse => ({
  user: { id: 'u1', role: 'teacher', displayName: 'Ms. Rivera' },
  classes,
  session: null,
  armed: false,
});

/** Home as the page draws it, for `classes`, its reads and its answers' handlers given. */
function home(classes: TaughtClass[], over: Partial<Parameters<typeof TeacherHome>[0]> = {}) {
  const onRead = vi.fn();
  const onRetry = vi.fn(() => Promise.resolve());
  const view = render(
    <main>
      <TeacherHome
        me={me(classes)}
        failed={null}
        now={NOW}
        onRead={onRead}
        onRetry={onRetry}
        {...over}
      />
    </main>,
  );
  return { ...view, onRead, onRetry };
}

/** A student in Bali's read of a session: focused, heard from 10 s ago, unless told. */
function student(name: string, over: Partial<SnapshotStudent> = {}): SnapshotStudent {
  return {
    enrollmentId: `e-${name}`,
    studentId: `u-${name}`,
    displayName: name,
    state: 'focused',
    joinedAt: iso(NOW - 20 * MIN),
    lastSeenAt: iso(NOW - 10_000),
    endedAt: null,
    unlock: null,
    protectionOffAfterEnd: false,
    ...over,
  };
}

const absent = { state: null, joinedAt: null, lastSeenAt: null };

/** Main's 28: 24 focused, Ethan unlocked, Tomás silent 5 minutes, Zuri and Hannah not here. */
const MAIN = [
  ...Array.from({ length: 24 }, (_, i) => student(`Student ${i + 1}`)),
  student('Ethan Park', {
    state: 'unlocked',
    unlock: { eventId: 'v1', reason: 'nurse', recordedAs: null, occurredAt: iso(NOW - 4 * MIN) },
  }),
  student('Tomás Herrera', { lastSeenAt: iso(NOW - 5 * MIN - 20_000) }),
  student('Zuri Mensah', absent),
  student('Hannah Levi', absent),
];

const snapshot = (
  students: SnapshotStudent[],
  over: Partial<SessionSnapshot['session']> = {},
  ended = false,
): SessionSnapshot => ({
  session: { id: 'S', classId: 'c3', startedAt: iso(NOW - 26 * MIN), endsAt: BELL, ...over },
  ended,
  latestSeq: 12,
  students,
});

/** Each row of Check on: its chip's words, then each name in it, no-break spaces read as spaces. */
const checks = (well: HTMLElement) =>
  within(well)
    .queryAllByRole('listitem')
    .map((row) =>
      [...row.querySelectorAll('span > span, a, p > span')].map((e) =>
        e.textContent?.replaceAll('\u00a0', ' '),
      ),
    );

/** Monday, October 12, 2026, 12:30 PM UTC: the same day everywhere from UTC−11 to UTC+11. */
const DAY = Date.parse('2026-10-12T12:30:00.000Z');

describe('Home’s head (Main, HomeIdle, PhonePages)', () => {
  it('is Classes, focusable for a redeem, over today’s date, with New class, which opens its dialog', async () => {
    const user = userEvent.setup();
    home([TODAY]);
    const heading = screen.getByRole('heading', { level: 1, name: 'Classes' });
    expect(heading.getAttribute('tabindex')).toBe('-1');
    expect(heading.nextElementSibling?.textContent).toBe(dayOf(NOW));
    const button = screen.getByRole('button', { name: 'New class' });
    expect(button.getAttribute('aria-haspopup')).toBe('dialog');
    await user.click(button);
    expect(screen.getByRole('dialog', { name: 'New class' })).toBeDefined();
    expect(document.activeElement).toBe(screen.getByRole('textbox', { name: 'Class name' }));
  });

  it('says the date as the board does, and turns it at midnight by this computer’s clock', () => {
    const at = Date.parse('2026-10-12T14:30:00.000Z');
    expect(dayOf(at, { locale: 'en-US', timeZone: 'UTC' })).toBe('Monday, October 12');
    const local = (h: number, m = 0, d = 12) => new Date(2026, 9, d, h, m).getTime();
    expect(nextTurn(local(9))).toBe(local(0, 0, 13));
    expect(nextTurn(local(23, 59))).toBe(local(0, 0, 13));
    expect(nextTurn(local(0))).toBe(local(0, 0, 13));
  });

  it('says a later read that failed under the head with Try again, over what was read before', async () => {
    const user = userEvent.setup();
    let answerRetry: () => void = () => undefined;
    const onRetry = vi.fn(
      () =>
        new Promise<void>((done) => {
          answerRetry = () => done();
        }),
    );
    const { rerender } = home([NEVER], { failed: CANT_REACH, onRetry });
    expect(screen.getByRole('alert').textContent).toBe(CANT_REACH);
    expect(screen.getByRole('link', { name: 'Period 6 AP Biology' })).toBeDefined();
    const again = screen.getByRole('button', { name: 'Try again' });
    await user.click(again);
    // Held as Loading… until the account answers, its line kept, focus on it.
    expect(onRetry).toHaveBeenCalledOnce();
    expect(again.textContent).toBe('Loading…');
    expect(again.getAttribute('aria-disabled')).toBe('true');
    expect(document.activeElement).toBe(again);
    // Read: the line and its Try again go, focus on Your classes.
    rerender(
      <main>
        <TeacherHome me={me([NEVER])} failed={null} now={NOW} onRead={vi.fn()} onRetry={onRetry} />
      </main>,
    );
    await act(async () => {
      answerRetry();
      await new Promise((resolve) => setTimeout(resolve, 40));
    });
    expect(screen.queryByRole('alert')).toBeNull();
    expect(document.activeElement).toBe(screen.getByRole('heading', { name: 'Your classes' }));
  });
});

describe('Home’s failure line, another way (HomeMoments)', () => {
  it('names what didn’t load when Bali answered with a failure, so a reason written for a log never stands alone', () => {
    home([NEVER], { failed: 'internal error' });
    expect(screen.getByRole('alert').textContent).toBe(
      "Couldn't load your classes. internal error",
    );
  });
});

describe('Your classes (Main, HomeIdle)', () => {
  it('lists each class once, in the account’s order: its name to its page, its students, its last session and Start…', () => {
    const morning = '2026-10-12T12:05:00.000Z';
    const friday = '2026-10-09T12:00:00.000Z';
    home(
      [
        taught('c1', 'Period 1 Biology', { last: morning }),
        taught('c2', 'Period 2 Biology', { last: friday }),
        NEVER,
      ],
      { now: DAY },
    );
    const table = screen.getByRole('table');
    expect(
      within(table)
        .getAllByRole('columnheader')
        .map((th) => th.textContent),
    ).toEqual(['Class', 'Students', 'Last session', 'Open or start']);
    const rows = within(table).getAllByRole('row').slice(1);
    expect(
      rows.map((row) =>
        within(row)
          .getAllByRole('cell')
          .map((td) => td.textContent),
      ),
    ).toEqual([
      ['Period 1 Biology', '26', `Today, ${bellTime(morning)}`, 'Start…'],
      ['Period 2 Biology', '26', 'Friday', 'Start…'],
      ['Period 6 AP Biology', '24', 'No sessions yet', 'Start…'],
    ]);
    const name = screen.getByRole('link', { name: 'Period 1 Biology' });
    expect(name.getAttribute('href')).toBe('/classes/c1');
    // Its id, for focus after New class makes it.
    expect(name.id).toBe('class-c1');
    const start = within(rows[0]).getByRole('link', { name: 'Start…' });
    expect(start.getAttribute('href')).toBe('/classes/c1');
    // Each described by its class's name, so a list of links tells them apart.
    expect(screen.getByRole('link', { name: 'Start…', description: 'Period 1 Biology' })).toBe(
      start,
    );
  });

  it('marks a class whose session runs: the live green, “Live until” its bell, and Open; at the bell, Start… again', () => {
    bali.routes.set('GET /v1/sessions/S', () => 'hold');
    const { rerender } = home([LIVE, TODAY]);
    const row = screen.getAllByRole('row')[1];
    expect(row.className).toContain('[&>td]:bg-live-fill');
    expect(within(row).getByText(`Live until ${bellTime(BELL)}`)).toBeDefined();
    const open = within(row).getByRole('link', { name: 'Open' });
    expect(open.getAttribute('href')).toBe('/classes/c3');
    expect(screen.getByRole('link', { name: 'Open', description: 'Biology, period 3' })).toBe(open);
    rerender(
      <main>
        <TeacherHome
          me={me([LIVE, TODAY])}
          failed={null}
          now={Date.parse(BELL)}
          onRead={vi.fn()}
          onRetry={() => Promise.resolve()}
        />
      </main>,
    );
    const after = screen.getAllByRole('row')[1];
    expect(after.className).not.toContain('bg-live-fill');
    expect(within(after).getByRole('link', { name: 'Start…' })).toBeDefined();
  });

  it('shows a new teacher the first class well in its place, its Create a class opening New class (HomeStates)', async () => {
    const user = userEvent.setup();
    home([]);
    expect(screen.queryByRole('table')).toBeNull();
    expect(screen.getByRole('heading', { name: 'Set up your first class' })).toBeDefined();
    expect(
      screen.getByText(
        'Name it, then put its join code on the board. Students join with it in the Bali app.',
      ),
    ).toBeDefined();
    await user.click(screen.getByRole('button', { name: 'Create a class' }));
    expect(screen.getByRole('dialog', { name: 'New class' })).toBeDefined();
    // Your block beside it, none yet.
    expect(await screen.findByText('No block registered yet.')).toBeDefined();
  });
});

describe('a class live (Main; HomeMoments)', () => {
  it('heads its well with its name, “Live until” its bell and the time left, its count loading until its session is read', () => {
    bali.routes.set('GET /v1/sessions/S', () => 'hold');
    home([LIVE, TODAY]);
    const well = screen.getByRole('region', { name: 'Biology, period 3' });
    const name = within(well).getByRole('heading', { level: 2, name: 'Biology, period 3' });
    expect(name.nextElementSibling?.textContent).toBe(`Live until ${bellTime(BELL)}`);
    expect(name.nextElementSibling?.querySelector('time')?.getAttribute('dateTime')).toBe(BELL);
    expect(within(well).getByText('left')).toBeDefined();
    expect(within(well).getByRole('status').textContent).toBe('Loading this session…');
    expect(within(well).queryByText(/focused/)).toBeNull();
    // The way in is there all along, each described by the class's name.
    expect(within(well).getByRole('link', { name: 'Open the class' }).getAttribute('href')).toBe(
      '/classes/c3',
    );
    expect(
      screen
        .getByRole('link', { name: 'Present', description: 'Biology, period 3' })
        .getAttribute('href'),
    ).toBe(presentHref('c3'));
    expect(presentHref('c3')).toBe('/classes/c3?present');
    // Over the classes: the well first.
    expect(well.compareDocumentPosition(screen.getByRole('table'))).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
  });

  it('counts the class focused, then who to check on, a row per state, each name to the student on the class’s page', async () => {
    bali.routes.set('GET /v1/sessions/S', () => [200, snapshot(MAIN)]);
    home([LIVE]);
    const well = screen.getByRole('region', { name: 'Biology, period 3' });
    await within(well).findByText('of 28 focused');
    expect(within(well).getByText('24')).toBeDefined();
    expect(within(well).getByRole('heading', { level: 3 }).textContent).toBe('Check on 4');
    expect(checks(well)).toEqual([
      ['Unlocked', 'Ethan Park'],
      ['Silent · 5 min', 'Tomás Herrera'],
      ['Not here', 'Zuri Mensah', 'Hannah Levi'],
    ]);
    expect(within(well).getByRole('link', { name: 'Ethan Park' }).getAttribute('href')).toBe(
      studentHref('c3', 'u-Ethan Park'),
    );
    expect(studentHref('c3', 'u1')).toBe('/classes/c3?student=u1');
    // Never a reason or a time: the student's record holds them (the owner, 2026-11-16).
    expect(well.textContent).not.toMatch(/Nurse|ago/);
    // Home's reads, every one: the grid's snapshot and Your block's list, nothing of its own.
    expect([...new Set(bali.sent)].sort()).toEqual(['GET /v1/blocks', 'GET /v1/sessions/S']);
  });

  it('says everyone’s focused in one line, and no students yet for a class with none (LiveStates, HomeMoments)', async () => {
    bali.routes.set('GET /v1/sessions/S', () => [200, snapshot([student('Ana Rodríguez')])]);
    home([LIVE]);
    const well = screen.getByRole('region', { name: 'Biology, period 3' });
    expect(await within(well).findByText("Everyone's focused.")).toBeDefined();
    expect(within(well).queryByText(/Check on/)).toBeNull();
    cleanup();
    bali.routes.set('GET /v1/sessions/S', () => [200, snapshot([])]);
    home([LIVE]);
    const empty = screen.getByRole('region', { name: 'Biology, period 3' });
    expect(await within(empty).findByText('No students yet.')).toBeDefined();
    expect(within(empty).getByText('of 0 focused')).toBeDefined();
    expect(within(empty).queryByText("Everyone's focused.")).toBeNull();
  });

  it('draws a well per class live, in the account’s order', () => {
    const second = taught('c4', 'Period 4 Biology', {
      running: { id: 'S4', endsAt: iso(NOW + 34 * MIN) },
    });
    bali.routes.set('GET /v1/sessions/S', () => 'hold');
    bali.routes.set('GET /v1/sessions/S4', () => 'hold');
    home([LIVE, TODAY, second]);
    expect(screen.getAllByRole('region').map((r) => r.querySelector('h2')?.textContent)).toEqual([
      'Biology, period 3',
      'Period 4 Biology',
      'Your classes',
      'Your block',
    ]);
  });

  it('lets a well go the moment the server ends its session, and reads the classes again; a later bell reads them too', async () => {
    bali.routes.set('GET /v1/sessions/S', () => 'hold');
    const { onRead } = home([LIVE]);
    await give('GET /v1/sessions/S', snapshot(MAIN, {}, true));
    expect(screen.queryByRole('region', { name: 'Biology, period 3' })).toBeNull();
    expect(onRead).toHaveBeenCalledOnce();
    // Its row too, at once, before the classes are read again: Start…, not "Live until".
    const row = screen.getAllByRole('row')[1];
    expect(row.className).not.toContain('bg-live-fill');
    expect(row.textContent).not.toMatch(/Live until/);
    expect(within(row).getByRole('link', { name: 'Start…' })).toBeDefined();
    cleanup();
    bali.routes.set('GET /v1/sessions/S', () => [
      200,
      snapshot(MAIN, { endsAt: iso(Date.parse(BELL) + 5 * MIN) }),
    ]);
    const later = home([LIVE]);
    await screen.findByText('of 28 focused');
    expect(later.onRead).toHaveBeenCalledOnce();
    // The well keeps to the later bell meanwhile.
    expect(
      screen.getByRole('heading', { level: 2, name: 'Biology, period 3' }).nextElementSibling
        ?.textContent,
    ).toBe(`Live until ${bellTime(iso(Date.parse(BELL) + 5 * MIN))}`);
  });

  it('says a session read that failed with Try again, held until the grid’s read again answers, focus then on its name', async () => {
    const user = userEvent.setup();
    let failing = true;
    bali.routes.set('GET /v1/sessions/S', () => (failing ? [0, null] : 'hold'));
    home([LIVE]);
    const well = screen.getByRole('region', { name: 'Biology, period 3' });
    const alert = await within(well).findByRole('alert');
    expect(alert.textContent).toBe(`Couldn't load this session. ${CANT_REACH}`);
    failing = false;
    const again = within(well).getByRole('button', { name: 'Try again' });
    await user.click(again);
    expect(again.textContent).toBe('Loading…');
    await give('GET /v1/sessions/S', snapshot(MAIN));
    expect(within(well).queryByRole('alert')).toBeNull();
    expect(within(well).getByText('of 28 focused')).toBeDefined();
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 40));
    });
    expect(document.activeElement).toBe(within(well).getByRole('heading', { level: 2 }));
  });
});

describe('a live well’s rarer moments (LiveWellView; HomeMoments)', () => {
  const grid = (over: Partial<GridNow> = {}): GridNow => ({
    students: fromSnapshot(snapshot(MAIN)),
    now: new Date(NOW),
    error: null,
    retry: () => undefined,
    retrying: false,
    stale: null,
    ...over,
  });
  const well = (g: GridNow) =>
    render(
      <LiveWellView
        classId="c3"
        name="Biology, period 3"
        grid={g}
        startedAt={iso(NOW - 26 * MIN)}
        endsAt={BELL}
      />,
    );

  it('says a lost or quiet live feed over the count, a status, its age unsaid as it ticks; the count and Check on faded, names plain', () => {
    well(grid({ stale: { reason: 'reconnecting', secondsAgo: 40 } }));
    const lost = screen.getByRole('status');
    expect(lost.textContent).toBe('Reconnecting… last updated 40s ago');
    expect(lost.querySelector('[aria-live="off"]')?.textContent).toBe('40s ago');
    expect(lost.nextElementSibling?.className).toContain('opacity-60');
    expect(screen.getByRole('heading', { level: 3 }).parentElement?.className).toBe('opacity-60');
    // As they were at the last update, nothing to follow.
    expect(screen.queryByRole('link', { name: 'Ethan Park' })).toBeNull();
    expect(screen.getByText('Ethan Park').tagName).toBe('SPAN');
    cleanup();
    well(grid({ stale: { reason: 'stale', secondsAgo: 120 } }));
    expect(screen.getByRole('status').textContent).toBe(
      'Live feed has gone quiet. Last updated 2 min ago.',
    );
    cleanup();
    well(grid());
    expect(screen.queryByRole('status')).toBeNull();
    expect(screen.getByRole('link', { name: 'Ethan Park' })).toBeDefined();
  });

  it('keeps a read’s failure said even once a later read fills the grid, as the class page does', () => {
    well(grid({ error: CANT_REACH }));
    expect(screen.getByRole('alert').textContent).toBe(`Couldn't load this session. ${CANT_REACH}`);
    expect(screen.queryByText(/focused/)).toBeNull();
    expect(screen.queryByRole('heading', { level: 3 })).toBeNull();
  });

  it('lists Check on’s rarer rows in the unlocks’, protection off’s, Silent’s, Not here’s, then Left’s order, a silence of another length its own row', () => {
    const at = new Date(NOW);
    const rows = checkOn(
      fromSnapshot(
        snapshot([
          student('Caleb', { endedAt: iso(NOW - 3 * MIN) }),
          student('Zuri', absent),
          student('Tomás', { lastSeenAt: iso(NOW - 5 * MIN - 20_000) }),
          student('Wei', { lastSeenAt: iso(NOW - 9 * MIN - 20_000) }),
          student('Amara', { state: 'protection_off' }),
          student('Mateo', {
            state: 'unlocked',
            endedAt: iso(NOW - 2 * MIN),
            unlock: {
              eventId: 'v2',
              reason: null,
              recordedAs: null,
              occurredAt: iso(NOW - 9 * MIN),
            },
          }),
          student('Ethan', {
            state: 'unlocked',
            unlock: {
              eventId: 'v1',
              reason: 'nurse',
              recordedAs: null,
              occurredAt: iso(NOW - MIN),
            },
          }),
          student('Ana'),
          student('Noor', { lastSeenAt: iso(NOW - 5 * MIN - 30_000) }),
        ]),
      ),
      at,
    );
    expect(rows.map((r) => [r.words, ...r.students.map((s) => s.displayName)])).toEqual([
      ['Unlocked', 'Ethan'],
      ['Left · unlocked', 'Mateo'],
      ['Protection off', 'Amara'],
      ['Silent · 5 min', 'Tomás', 'Noor'],
      ['Silent · 9 min', 'Wei'],
      ['Not here', 'Zuri'],
      ['Left', 'Caleb'],
    ]);
  });

  it('names a student in a rarer state alone, never saying everyone’s focused while one isn’t', () => {
    well(
      grid({
        students: fromSnapshot(
          snapshot([student('Ana'), student('Amara', { state: 'protection_off' })]),
        ),
      }),
    );
    expect(screen.getByText('of 2 focused').previousElementSibling?.textContent).toBe('1');
    expect(screen.queryByText("Everyone's focused.")).toBeNull();
    expect(screen.getByRole('heading', { level: 3 }).textContent).toBe('Check on 1');
    expect(screen.getByRole('link', { name: 'Amara' }).closest('li')?.textContent).toBe(
      'Protection offAmara',
    );
  });

  it('keeps a Silent row the same row as its minutes turn, so a name focused in it keeps focus', () => {
    const silent = fromSnapshot(
      snapshot([student('Tomás', { lastSeenAt: iso(NOW - 5 * MIN - 20_000) })]),
    );
    const { rerender } = well(grid({ students: silent }));
    const name = screen.getByRole('link', { name: 'Tomás' });
    name.focus();
    rerender(
      <LiveWellView
        classId="c3"
        name="Biology, period 3"
        grid={grid({ students: silent, now: new Date(NOW + MIN) })}
        startedAt={iso(NOW - 26 * MIN)}
        endsAt={BELL}
      />,
    );
    expect(name.closest('li')?.textContent).toMatch(/^Silent.·.6 minTomás$/);
    expect(document.activeElement).toBe(name);
  });
});

describe('Last session (HomeIdle; HomeMoments)', () => {
  const LAST_START = iso(NOW - 3 * 60 * MIN);
  const LAST_END = iso(Date.parse(LAST_START) + 50 * MIN);
  const IDLE = [taught('c1', 'Period 1 Biology', { last: LAST_START }), NEVER];
  const REPORT = `GET /v1/classes/c1/reports/sessions/s-c1`;
  const EVENTS = 'GET /v1/sessions/s-c1/events';
  const ROSTER = 'GET /v1/classes/c1/roster';
  const names = Array.from({ length: 26 }, (_, i) => `Student ${i + 1}`);
  const report = (joined: number, unlocks: number): SessionReportResponse => ({
    ended: true,
    startedAt: LAST_START,
    endsAt: LAST_END,
    endedAt: LAST_END,
    joined: names.slice(0, joined).map((n) => ({ id: `u-${n}`, displayName: n })),
    focusMinutes: joined * 47,
    averageFocusMinutes: joined ? 47 : null,
    silentMinutes: 0,
    unlocks: names.slice(0, unlocks).map((n, i) => ({
      eventId: `v${i}`,
      student: { id: `u-${n}`, displayName: n },
      occurredAt: iso(Date.parse(LAST_START) + 18 * MIN),
      reason: null,
      recordedAs: null,
    })),
    protectionOffs: [],
  });
  const events = (unlocks: number): EventsPage => ({
    events: names.slice(0, unlocks).map((n, i): FeedEvent => ({
      seq: i + 1,
      eventId: `v${i}`,
      type: 'unlock',
      userId: `u-${n}`,
      occurredAt: iso(Date.parse(LAST_START) + 18 * MIN),
      payload: {},
    })),
    nextAfter: unlocks,
  });
  const roster: RosterResponse = {
    students: names.map((n) => ({
      enrollmentId: `e-${n}`,
      studentId: `u-${n}`,
      displayName: n,
      joinedAt: iso(NOW - 30 * 24 * 60 * MIN),
    })),
  };
  function answers(joined: number, unlocks: number) {
    // A page an earlier call answered goes, so these events are the ones read.
    for (const key of bali.routes.keys()) if (key.startsWith(`${EVENTS}?`)) bali.routes.delete(key);
    bali.routes.set(REPORT, () => [200, report(joined, unlocks)]);
    bali.routes.set(EVENTS, () => [200, events(unlocks)]);
    bali.routes.set(`${EVENTS}?after=${unlocks}`, () => [200, { events: [], nextAfter: unlocks }]);
    bali.routes.set(ROSTER, () => [200, roster]);
  }
  const figures = (section: HTMLElement) =>
    [...section.querySelectorAll('dl > div')].map((d) => [
      d.querySelector('dd')?.textContent,
      d.querySelector('dt')?.textContent,
    ]);

  it('names the class and when it ran, then who stayed focused the whole time, the unlocks and who didn’t join, as the recap counts them', async () => {
    answers(25, 1);
    home(IDLE);
    const section = screen.getByRole('region', { name: 'Last session' });
    expect(within(section).getByText('Period 1 Biology')).toBeDefined();
    expect(within(section).getByRole('status').textContent).toBe('Loading the last session…');
    expect(within(section).queryByRole('link')).toBeNull();
    await within(section).findByText('stayed focused the whole time');
    expect(figures(section)).toEqual([
      ['24 of 25', 'stayed focused the whole time'],
      ['1', 'emergency unlock'],
      ['1', "didn't join"],
    ]);
    const recap = within(section).getByRole('link', { name: 'Open the recap' });
    expect(recap.getAttribute('href')).toBe('/classes/c1');
    expect(
      screen.getByRole('link', { name: 'Open the recap', description: 'Period 1 Biology' }),
    ).toBe(recap);
    // The recap's own three reads, once each, and Your block's list: Home reads nothing else.
    expect(bali.sent.filter((key) => key === REPORT)).toHaveLength(1);
    expect(bali.sent.filter((key) => key === ROSTER)).toHaveLength(1);
    expect([...new Set(bali.sent)].sort()).toEqual(
      ['GET /v1/blocks', REPORT, `${EVENTS}?after=0`, `${EVENTS}?after=1`, ROSTER].sort(),
    );
  });

  it('counts unlocks as unlocks, and says nobody joined in the figures’ place, the unlocks kept if any', async () => {
    answers(25, 2);
    home(IDLE);
    const section = screen.getByRole('region', { name: 'Last session' });
    await within(section).findByText('emergency unlocks');
    expect(figures(section)[1]).toEqual(['2', 'emergency unlocks']);
    cleanup();
    answers(0, 0);
    home(IDLE);
    const nobody = screen.getByRole('region', { name: 'Last session' });
    expect(await within(nobody).findByText('Nobody joined this session.')).toBeDefined();
    expect(figures(nobody)).toEqual([]);
    expect(within(nobody).getByRole('link', { name: 'Open the recap' })).toBeDefined();
    cleanup();
    answers(0, 1);
    home(IDLE);
    const unlocked = screen.getByRole('region', { name: 'Last session' });
    expect(await within(unlocked).findByText('Nobody joined this session.')).toBeDefined();
    expect(figures(unlocked)).toEqual([['1', 'emergency unlock']]);
  });

  it('says a read that failed with Try again, which reads all three again, held until it answers, focus then on its title', async () => {
    const user = userEvent.setup();
    answers(25, 1);
    bali.routes.set(ROSTER, () => [0, null]);
    home(IDLE);
    const section = screen.getByRole('region', { name: 'Last session' });
    const alert = await within(section).findByRole('alert');
    expect(alert.textContent).toBe(`Couldn't load the last session. ${CANT_REACH}`);
    expect(within(section).queryByRole('link')).toBeNull();
    bali.routes.set(ROSTER, () => 'hold');
    const again = within(section).getByRole('button', { name: 'Try again' });
    await user.click(again);
    expect(again.textContent).toBe('Loading…');
    expect(within(section).getByRole('alert')).toBeDefined();
    await give(ROSTER, roster);
    expect(within(section).queryByRole('alert')).toBeNull();
    expect(figures(section)[0]).toEqual(['24 of 25', 'stayed focused the whole time']);
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 40));
    });
    expect(document.activeElement).toBe(
      within(section).getByRole('heading', { name: 'Last session' }),
    );
  });

  it('shows none while a class runs, past its bell too until the classes are read again, and none before a first session ends', async () => {
    bali.routes.set('GET /v1/sessions/S', () => 'hold');
    answers(25, 1);
    const live = taught('c3', 'Biology, period 3', {
      count: 28,
      running: { id: 'S', endsAt: BELL },
      last: iso(NOW - 26 * 60 * MIN),
    });
    const { rerender } = home([live, ...IDLE]);
    expect(screen.queryByRole('region', { name: 'Last session' })).toBeNull();
    rerender(
      <main>
        <TeacherHome
          me={me([live, ...IDLE])}
          failed={null}
          now={Date.parse(BELL) + 1000}
          onRead={vi.fn()}
          onRetry={() => Promise.resolve()}
        />
      </main>,
    );
    expect(screen.queryByRole('region', { name: 'Biology, period 3' })).toBeNull();
    expect(screen.queryByRole('region', { name: 'Last session' })).toBeNull();
    cleanup();
    home([NEVER]);
    expect(screen.queryByRole('region', { name: 'Last session' })).toBeNull();
    await settle();
    expect(bali.sent.some((key) => key.includes('/reports/'))).toBe(false);
  });
});

describe('New class from Home (ClassFlows)', () => {
  it('reads the classes again at its answer, and a class made offers its join code and Open the class', async () => {
    const user = userEvent.setup();
    bali.routes.set('POST /v1/classes', () => [
      201,
      {
        id: 'c9',
        name: 'Period 4 Biology',
        joinCode: 'Q5FU3U',
        createdAt: iso(NOW),
        liveSessionId: null,
      },
    ]);
    const { onRead } = home([TODAY]);
    await user.click(screen.getByRole('button', { name: 'New class' }));
    await user.type(screen.getByRole('textbox', { name: 'Class name' }), 'Period 4 Biology{Enter}');
    const made = await screen.findByRole('dialog', { name: 'Period 4 Biology' });
    expect(onRead).toHaveBeenCalledOnce();
    expect(within(made).getByText('Q5FU3U')).toBeDefined();
    expect(within(made).getByRole('link', { name: 'Open the class' }).getAttribute('href')).toBe(
      '/classes/c9',
    );
  });
});
