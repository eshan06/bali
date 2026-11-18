// @vitest-environment jsdom
import {
  type ClassDetail,
  type FeedEvent,
  MAX_SESSION_MINUTES,
  type ReportStudent,
  type RosterStudent,
  type SessionReportResponse,
  type SessionReportSummary,
  type SessionReportUnlock,
} from '@bali/shared';
import { act, cleanup, render, screen, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { lockButton } from '@/components/button';
import { CountContext } from '@/components/count';
import { type ApiClient, createApiClient } from '@/lib/api-client';
import { ACCOUNT_DELETED, CANT_REACH, NOT_A_BLOCK_ID, NOT_A_SESSION_LENGTH } from '@/lib/errors';
import { bellTime } from '@/lib/session-controls';

import ClassDetailPage from './page';

/*
 * A class's page before it starts (LO4), as a teacher meets it (the portal's tests drive the page,
 * the owner, 2026-10-22): the lock-only canvas's ClassPage, its in-between states as ClassStates
 * draws them and as LO4 drew the rest first (ClassBeforeStates, intermediate states). Bali's answers
 * come from a stand-in `fetch` under the portal's own API client; one can be held for the test to
 * give, or never come (`down`). Converted from `app/class-page.test.ts`'s source text where its
 * pins covered this part.
 */

const bali = vi.hoisted(() => {
  const CLASS = '019a0000-0000-7000-8000-0000000000c1';
  const LAST = '019a0000-0000-7000-8000-000000000004';
  const klass: ClassDetail = {
    id: CLASS,
    name: 'Biology, period 3',
    joinCode: 'VMAF7E',
    createdAt: '2026-09-01T14:00:00.000Z',
    liveSessionId: null,
  };
  const student = (id: string, displayName: string): RosterStudent => ({
    enrollmentId: `e-${id}`,
    studentId: id,
    displayName,
    joinedAt: '2026-09-02T14:00:00.000Z',
  });
  const ana = student('u-ana', 'Ana Rodríguez');
  const marcus = student('u-marcus', 'Marcus Bell');
  /** What Bali holds, and how each request goes, by "METHOD path". */
  const now = {
    students: [ana, marcus] as RosterStudent[],
    /** Whether the teacher has a block. */
    block: true,
    /** The teacher's account deleted on its way: a register refused for good. */
    accountDeleted: false,
    /** The class's last session over, and its report's who joined and unlocks; none by default. */
    last: null as SessionReportSummary | null,
    joined: [] as ReportStudent[],
    unlocks: [] as SessionReportUnlock[],
    events: [] as FeedEvent[],
    /** Requests that get no answer (the network fails). */
    down: new Set<string>(),
    /** A request whose answer waits for the test (`holding`). */
    hold: null as string | null,
  };
  const report = (): SessionReportResponse => ({
    ended: true,
    joined: now.joined,
    focusMinutes: 40,
    averageFocusMinutes: 40,
    silentMinutes: 0,
    unlocks: now.unlocks,
    protectionOffs: [],
  });
  const reports = `/v1/classes/${CLASS}/reports/sessions`;
  const routes: Record<string, (body: unknown) => [number, unknown]> = {
    [`GET /v1/classes/${CLASS}`]: () => [200, klass],
    [`GET /v1/classes/${CLASS}/roster`]: () => [200, { students: now.students }],
    'GET /v1/blocks': () => [
      200,
      {
        blocks: now.block
          ? [{ id: 'b1', tagId: 'T7XK2M9QPF', createdAt: '2026-10-04T14:00:00.000Z' }]
          : [],
      },
    ],
    'POST /v1/blocks': (body) =>
      now.accountDeleted
        ? [409, { error: { code: 'conflict', reason: 'account_deleted', message: 'deleted' } }]
        : [
            201,
            {
              id: 'b2',
              tagId: (body as { tagId: string }).tagId,
              createdAt: new Date().toISOString(),
            },
          ],
    [`GET ${reports}?limit=1`]: () => [
      200,
      { sessions: now.last ? [now.last] : [], nextBefore: null },
    ],
    [`GET ${reports}/${LAST}`]: () => [200, report()],
    [`GET ${reports}/${LAST}/questions`]: () => [200, { questions: [] }],
    [`GET /v1/sessions/${LAST}/events?after=0`]: () => [
      200,
      { events: now.events, nextAfter: now.events.at(-1)?.seq ?? 0 },
    ],
  };
  const sent: { key: string; body: unknown }[] = [];
  const unexpected: string[] = [];
  const holding: (() => void)[] = [];
  const fetch = (url: string | URL | Request, init?: RequestInit) => {
    const key = `${init?.method ?? 'GET'} ${(url as string).replace('http://api', '')}`;
    const body = typeof init?.body === 'string' ? (JSON.parse(init.body) as unknown) : null;
    sent.push({ key, body });
    const wait = key === now.hold ? new Promise<void>((go) => holding.push(go)) : null;
    return (wait ?? Promise.resolve()).then(() => {
      if (now.down.has(key)) throw new TypeError('Failed to fetch');
      // A page of events past the first is the last: empty.
      const more = /^GET \/v1\/sessions\/[^/]+\/events\?after=(\d+)$/.exec(key);
      const route = routes[key];
      let answer: [number, unknown];
      if (route) answer = route(body);
      else if (more) answer = [200, { events: [], nextAfter: Number(more[1]) }];
      else {
        unexpected.push(key);
        answer = [404, { error: { code: 'not_found', message: 'not found' } }];
      }
      return Response.json(answer[1], { status: answer[0] });
    });
  };
  return {
    CLASS,
    LAST,
    ana,
    marcus,
    now,
    sent,
    unexpected,
    holding,
    fetch,
    router: { replace: vi.fn(), push: vi.fn() },
    client: null as ApiClient | null,
  };
});

vi.mock('next/navigation', () => ({
  useParams: () => ({ id: bali.CLASS }),
  useRouter: () => bali.router,
}));
vi.mock('@/lib/auth', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/auth')>()),
  getAccessToken: () => 'token',
}));
vi.mock('@/lib/use-api', () => ({ useApi: () => bali.client, useSignOut: () => undefined }));
vi.mock('@/lib/monitoring', () => ({ captureApiFailure: vi.fn() }));

beforeEach(() => {
  bali.client = createApiClient({
    baseUrl: 'http://api',
    getToken: () => 'token',
    fetchImpl: bali.fetch,
  });
});

afterEach(() => {
  if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
  cleanup();
  localStorage.clear();
  sessionStorage.clear();
  Object.assign(bali.now, {
    students: [bali.ana, bali.marcus],
    block: true,
    accountDeleted: false,
    last: null,
    joined: [],
    unlocks: [],
    events: [],
    hold: null,
  });
  bali.now.down.clear();
  bali.holding.length = 0;
  bali.sent.length = 0;
  bali.unexpected.length = 0;
});

const CLASS_KEY = `GET /v1/classes/${bali.CLASS}`;
const START_KEY = `POST /v1/classes/${bali.CLASS}/sessions`;
const LAST_KEY = `GET /v1/classes/${bali.CLASS}/reports/sessions?limit=1`;
const START = /^Start (\d+-minute )?session$/;

/** The page in a `<main>`, as the shell's (PagePlace). */
function open() {
  const user = userEvent.setup();
  render(
    <main>
      <ClassDetailPage />
    </main>,
  );
  return user;
}
const name = () => screen.getByRole('heading', { level: 1, name: 'Biology, period 3' });
const button = (name: string | RegExp) => screen.getByRole('button', { name });
const posted = (key: string) => bali.sent.filter((r) => r.key === key);
/** What Bali set off, drawn. */
const settle = () =>
  act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 20));
  });
/** A session over at `ended`, `minutes` long. */
const over = (ended: Date, minutes = 50): SessionReportSummary => ({
  id: bali.LAST,
  startedAt: new Date(ended.getTime() - minutes * 60_000).toISOString(),
  endsAt: ended.toISOString(),
  endedAt: ended.toISOString(),
  ended: true,
  joinedCount: bali.now.joined.length,
  focusMinutes: 40,
  averageFocusMinutes: 40,
  silentMinutes: 0,
  unlockCount: bali.now.unlocks.length,
  protectionOffCount: 0,
});
const daysAgo = (days: number) => new Date(Date.now() - days * 86_400_000);

describe('a class before it starts (ClassPage)', () => {
  it('holds the well’s place with Loading… until the class is read, never Start: one may be live', async () => {
    bali.now.hold = CLASS_KEY;
    open();
    const loading = await screen.findByRole('status');
    expect(loading.textContent).toBe('Loading…');
    const held = screen.getByRole('heading', { level: 1 });
    expect(held.textContent).toBe('…');
    // In the captions' ink, its line's place held, so nothing moves as the class lands.
    expect(held.className).toMatch(/\btext-text-tertiary\b/);
    expect(held.nextElementSibling?.textContent).toBe(String.fromCharCode(160));
    expect(screen.queryByText('Session length')).toBeNull();
    expect(screen.queryByRole('button', { name: START })).toBeNull();
    expect(screen.queryByRole('heading', { name: 'Students' })).toBeNull();

    await act(async () => {
      bali.holding.shift()?.();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    await screen.findByRole('button', { name: 'Start 50-minute session' });
    expect(bali.unexpected).toEqual([]);
  });

  it('shows the name over its students, the class’s reports, the lengths with Start, and the students', async () => {
    const user = open();
    const start = await screen.findByRole('button', { name: 'Start 50-minute session' });
    expect(name().nextElementSibling?.textContent).toBe('2 students');
    const reports = screen.getByRole('link', { name: 'This class’s reports'.replace('’', "'") });
    expect(reports.getAttribute('href')).toBe(`/reports?class=${bali.CLASS}`);
    // The well: its lengths, 50 picked by default, then Start; no line for a class never run.
    const well = screen.getByRole('form', { name: 'Session length' });
    expect(
      within(well)
        .getAllByRole('radio')
        .map((r) => (r as HTMLInputElement).value),
    ).toEqual(['25', '50', '75', 'other']);
    expect(within(well).getByRole('radio', { name: '50 min' })).toHaveProperty('checked', true);
    // The radio is clipped away, so its segment draws the focus ring.
    const segment = within(well).getByRole('radio', { name: '50 min' }).closest('label');
    expect(segment?.className).toMatch(/\bhas-focus-visible:outline-2\b/);
    expect(well.contains(start)).toBe(true);
    expect(screen.queryByText(/stayed focused|nobody joined/)).toBeNull();
    // The students: their count and names, the join code behind Add students.
    const students = screen.getByRole('heading', { level: 2, name: 'Students' });
    expect(students.nextElementSibling?.textContent).toBe('2');
    expect(screen.getAllByRole('listitem').map((li) => li.textContent)).toEqual([
      'Ana Rodríguez',
      'Marcus Bell',
    ]);
    const add = button('Add students');
    expect(add.getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByText('VMAF7E', { ignore: 'dialog *' })).toBeNull();

    await user.click(add);
    expect(add.getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByText('VMAF7E', { ignore: 'dialog *' })).toBeDefined();
    expect(
      screen.getByText('New students type it in the Bali app to join this class.'),
    ).toBeDefined();
    expect(button('Copy code')).toBeDefined();
    expect(button('New code')).toBeDefined();
    await user.click(add);
    expect(screen.queryByText('VMAF7E', { ignore: 'dialog *' })).toBeNull();
    expect(document.activeElement).toBe(add);
    expect(bali.unexpected).toEqual([]);
  });

  it('says one student as one', async () => {
    bali.now.students = [bali.ana];
    open();
    await screen.findByRole('button', { name: 'Start 50-minute session' });
    expect(name().nextElementSibling?.textContent).toBe('1 student');
  });

  it('never says the class didn’t load for its roster’s failure while the class is on its way', async () => {
    bali.now.hold = CLASS_KEY;
    bali.now.down.add(`GET /v1/classes/${bali.CLASS}/roster`);
    open();
    await vi.waitFor(() => expect(posted(`GET /v1/classes/${bali.CLASS}/roster`)).toHaveLength(1));
    await settle();
    // Only the class's own read fails the class: its place still says Loading…, nothing alerts.
    expect(screen.getByRole('status').textContent).toBe('Loading…');
    expect(screen.queryByRole('alert')).toBeNull();

    await act(async () => {
      bali.holding.shift()?.();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    // Read, the class shows, and the roster's failure is said under its header.
    await screen.findByRole('button', { name: 'Start 50-minute session' });
    expect(screen.getByRole('alert').textContent).toBe(`Couldn't load this class. ${CANT_REACH}`);
  });

  it('shows a new class’s join code at once, no Add students, and says it has no students yet', async () => {
    bali.now.students = [];
    open();
    await screen.findByText('No students yet.');
    expect(name().nextElementSibling?.textContent).toBe('0 students');
    expect(screen.getByText('VMAF7E', { ignore: 'dialog *' })).toBeDefined();
    expect(screen.queryByRole('button', { name: 'Add students' })).toBeNull();
    expect(screen.queryAllByRole('listitem')).toEqual([]);
  });

  it('says on Start the length picked; Other… asks for minutes, refusing a length it can’t start under the help', async () => {
    const user = open();
    await screen.findByRole('button', { name: 'Start 50-minute session' });
    await user.click(screen.getByRole('radio', { name: '25 min' }));
    expect(button(START).textContent).toBe('Start 25-minute session');

    await user.click(screen.getByRole('radio', { name: 'Other…' }));
    const minutes = screen.getByRole('spinbutton', { name: 'Minutes' });
    expect(screen.getByText(`A whole number from 1 to ${MAX_SESSION_MINUTES}.`)).toBeDefined();
    expect(button(START).textContent).toBe('Start session');
    await user.click(button(START));
    const said = screen.getByRole('alert');
    expect(said.textContent).toBe(NOT_A_SESSION_LENGTH);
    expect(document.activeElement).toBe(minutes);
    expect(minutes.getAttribute('aria-invalid')).toBe('true');
    expect(minutes.getAttribute('aria-describedby')?.split(' ')).toContain(said.id);
    expect(posted(START_KEY)).toEqual([]);

    await user.type(minutes, '40');
    expect(screen.queryByRole('alert')).toBeNull();
    expect(button(START).textContent).toBe('Start 40-minute session');
  });

  it('holds Start and the lengths while a Start is on its way: Starting…, the lengths dimmed, a pick changing nothing', async () => {
    bali.now.hold = START_KEY;
    const user = open();
    const start = await screen.findByRole('button', { name: 'Start 50-minute session' });
    // The lock-only look's button, Starting… with it (LO13; ClassPage).
    expect(start.className).toBe(lockButton('primary', 'md'));
    await user.click(start);
    expect(start.textContent).toBe('Starting…');
    expect(start.className).toBe(lockButton('primary', 'md'));
    expect(start.getAttribute('aria-busy')).toBe('true');
    expect(start.getAttribute('aria-disabled')).toBe('true');
    expect(document.activeElement).toBe(start);
    await user.click(screen.getByRole('radio', { name: '25 min' }));
    expect(screen.getByRole('radio', { name: '50 min' })).toHaveProperty('checked', true);
    expect(screen.getByRole('radio', { name: '25 min' }).closest('div')?.className).toMatch(
      /\bopacity-55\b/,
    );
    // A second press sends nothing.
    await user.click(start);
    expect(posted(START_KEY)).toHaveLength(1);
    expect(bali.holding).toHaveLength(1);
  });

  it('says a Start that failed across the well’s foot, Start become Try again; another length puts Start back', async () => {
    bali.now.down.add(START_KEY);
    const user = open();
    const start = await screen.findByRole('button', { name: 'Start 50-minute session' });
    await user.click(start);
    // No answer: the class is read again first, and runs nothing, so the failure is said.
    const said = await screen.findByRole('alert');
    expect(said.textContent).toBe(CANT_REACH);
    expect(start.textContent).toBe('Try again');
    expect(document.activeElement).toBe(start);
    expect(screen.getByRole('form', { name: 'Session length' }).contains(said)).toBe(true);

    // Try again sends the same Start again, its failure said again.
    await user.click(start);
    await vi.waitFor(() => expect(posted(START_KEY)).toHaveLength(2));
    expect(posted(START_KEY).map((r) => r.body)).toEqual([
      { durationMinutes: 50 },
      { durationMinutes: 50 },
    ]);
    expect((await screen.findByRole('alert')).textContent).toBe(CANT_REACH);

    await user.click(screen.getByRole('radio', { name: '25 min' }));
    expect(screen.queryByRole('alert')).toBeNull();
    expect(start.textContent).toBe('Start 25-minute session');
    expect(bali.unexpected).toEqual([]);
  });
});

describe('a class before it starts, no block yet (ClassStates)', () => {
  it('asks for the block first, no Start: its code checked, refused, sent again, then Start in its place', async () => {
    bali.now.block = false;
    const user = open();
    await screen.findByRole('heading', { level: 2, name: 'Register your block first' });
    expect(screen.getByText('10 letters and digits, written on your block.')).toBeDefined();
    expect(screen.queryByRole('button', { name: START })).toBeNull();
    const code = screen.getByRole('textbox', { name: 'Block code' });

    // The lock-only look's primary button, Registering… and Try again with it (LO13).
    expect(button('Register block').className).toBe(lockButton('primary', 'md'));
    // Not a block's code: said under the form, nothing sent, focus on the code.
    await user.type(code, 'ABC');
    await user.click(button('Register block'));
    expect(screen.getByRole('alert').textContent).toBe(NOT_A_BLOCK_ID);
    expect(document.activeElement).toBe(code);
    expect(code.getAttribute('aria-invalid')).toBe('true');
    expect(posted('POST /v1/blocks')).toEqual([]);

    // No answer: said, Register block become Try again, which sends it again.
    bali.now.down.add('POST /v1/blocks');
    await user.clear(code);
    await user.type(code, 't7xk 2m9q pf');
    await user.click(button('Register block'));
    expect((await screen.findByRole('alert')).textContent).toBe(CANT_REACH);
    bali.now.down.clear();
    await user.click(button('Try again'));

    const start = await screen.findByRole('button', { name: 'Start 50-minute session' });
    expect(screen.queryByText('Register your block first')).toBeNull();
    await vi.waitFor(() => expect(document.activeElement).toBe(start));
    expect(posted('POST /v1/blocks').map((r) => r.body)).toEqual([
      { tagId: 'T7XK2M9QPF' },
      { tagId: 'T7XK2M9QPF' },
    ]);
    expect(bali.unexpected).toEqual([]);
  });

  it('counts a block once Bali has registered it, never one refused', async () => {
    bali.now.block = false;
    const count = vi.fn();
    const user = userEvent.setup();
    render(
      <CountContext.Provider value={count}>
        <main>
          <ClassDetailPage />
        </main>
      </CountContext.Provider>,
    );
    const code = await screen.findByRole('textbox', { name: 'Block code' });
    await user.type(code, 'T7XK2M9QPF');
    // Refused for the account (deleted on its way): said, final, Register block kept, no count.
    bali.now.accountDeleted = true;
    await user.click(button('Register block'));
    expect((await screen.findByRole('alert')).textContent).toBe(ACCOUNT_DELETED);
    expect(button('Register block')).toBeDefined();
    expect(count).not.toHaveBeenCalled();

    bali.now.accountDeleted = false;
    await user.click(button('Register block'));
    await screen.findByRole('button', { name: 'Start 50-minute session' });
    expect(count.mock.calls).toEqual([['portal_block_registered']]);
  });

  it('offers Start when Bali couldn’t list the blocks: a session starts without one', async () => {
    bali.now.down.add('GET /v1/blocks');
    open();
    await screen.findByRole('button', { name: 'Start 50-minute session' });
    expect(screen.queryByText('Register your block first')).toBeNull();
  });
});

describe('a class before it starts, what didn’t load (ClassBeforeStates)', () => {
  it('says a class that didn’t load in the well’s place, with Try again; read, the page, focus on its name', async () => {
    bali.now.down.add(CLASS_KEY);
    const user = open();
    const said = await screen.findByRole('alert');
    expect(said.textContent).toBe(`Couldn't load this class. ${CANT_REACH}`);
    expect(screen.queryByRole('button', { name: START })).toBeNull();
    expect(screen.queryByRole('heading', { name: 'Students' })).toBeNull();

    bali.now.down.clear();
    await user.click(button('Try again'));
    await screen.findByRole('button', { name: 'Start 50-minute session' });
    expect(screen.queryByRole('alert')).toBeNull();
    await vi.waitFor(() => expect(document.activeElement).toBe(name()));
  });

  it('says students that didn’t load under the header, the join code still behind Add students', async () => {
    bali.now.down.add(`GET /v1/classes/${bali.CLASS}/roster`);
    const user = open();
    const said = await screen.findByRole('alert');
    expect(said.textContent).toBe(`Couldn't load this class. ${CANT_REACH}`);
    // Under the header, before the well, which shows once the last session is found (LO7).
    const well = await screen.findByRole('form', { name: 'Session length' });
    expect(said.compareDocumentPosition(well)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    expect(name().nextElementSibling?.textContent).toBe(String.fromCharCode(160));
    expect(screen.queryAllByRole('listitem')).toEqual([]);
    await user.click(button('Add students'));
    expect(screen.getByText('VMAF7E', { ignore: 'dialog *' })).toBeDefined();

    bali.now.down.clear();
    await user.click(button('Try again'));
    await screen.findByText('Ana Rodríguez');
    expect(name().nextElementSibling?.textContent).toBe('2 students');
    expect(screen.queryByRole('alert')).toBeNull();
  });
});

describe('a class before it starts, its last session', () => {
  /** Ana focused the whole time; Marcus used Emergency Unlock. */
  function lastSession(ended: Date) {
    bali.now.joined = [
      { id: 'u-ana', displayName: 'Ana Rodríguez' },
      { id: 'u-marcus', displayName: 'Marcus Bell' },
    ];
    bali.now.last = over(ended);
    const at = (minutes: number) => new Date(ended.getTime() - minutes * 60_000).toISOString();
    bali.now.events = [
      { seq: 1, eventId: 'e1', type: 'tap_in', userId: 'u-ana', occurredAt: at(49), payload: {} },
      {
        seq: 2,
        eventId: 'e2',
        type: 'tap_in',
        userId: 'u-marcus',
        occurredAt: at(48),
        payload: {},
      },
      {
        seq: 3,
        eventId: 'e3',
        type: 'unlock',
        userId: 'u-marcus',
        occurredAt: at(20),
        payload: {},
      },
    ];
    bali.now.unlocks = [
      {
        eventId: 'e3',
        student: { id: 'u-marcus', displayName: 'Marcus Bell' },
        occurredAt: at(20),
        reason: null,
        recordedAs: null,
      },
    ];
  }

  it('says its day and how many who joined stayed focused the whole time, with its report', async () => {
    lastSession(daysAgo(3));
    open();
    // The day it started, by this computer's calendar.
    const started = new Date(bali.now.last?.startedAt ?? '');
    const day = started.toLocaleDateString(undefined, { weekday: 'long' });
    const line = await screen.findByText(`On ${day}, 1 of 2 stayed focused the whole time.`, {
      exact: false,
    });
    const report = within(line).getByRole('link', { name: 'Open the report' });
    expect(report.getAttribute('href')).toBe(`/reports/${bali.CLASS}/${bali.LAST}`);
    // Not the recap's card, which is the day it ended.
    expect(screen.queryByRole('region', { name: 'Last session' })).toBeNull();
    expect(name().nextElementSibling?.textContent).toBe('2 students');
    expect(bali.unexpected).toEqual([]);
  });

  it('says its date past a week, and that nobody joined when nobody did', async () => {
    bali.now.last = over(daysAgo(10));
    open();
    const started = new Date(bali.now.last.startedAt);
    const when = started.toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric',
      year: started.getFullYear() === new Date().getFullYear() ? undefined : 'numeric',
    });
    await screen.findByText(`On ${when}, nobody joined.`, { exact: false });
  });

  it('says a last session that didn’t load with Try again; read, the line, focus on it', async () => {
    lastSession(daysAgo(2));
    bali.now.down.add(LAST_KEY);
    const user = open();
    const said = await screen.findByRole('alert');
    expect(said.textContent).toBe(`Couldn't load the last session. ${CANT_REACH}`);

    bali.now.down.clear();
    await user.click(button('Try again'));
    const line = await screen.findByText(/1 of 2 stayed focused the whole time\./);
    expect(screen.queryByRole('alert')).toBeNull();
    await vi.waitFor(() => expect(document.activeElement).toBe(line));
  });
});

describe('a class after the bell, the day its session ended (LO7; ClassEnded, ClassEndedStates)', () => {
  // 9:05 to 9:55 this morning, whatever the time now: over today.
  const ended = () => new Date(new Date().setHours(9, 55, 0, 0));
  const COUNT = { level: 2, name: '1 of 2 stayed focused the whole time' } as const;
  const REPORT_KEY = `GET /v1/classes/${bali.CLASS}/reports/sessions/${bali.LAST}`;
  const ROSTER_KEY = `GET /v1/classes/${bali.CLASS}/roster`;

  /** Ana focused the whole time; Marcus used Emergency Unlock; Zuri, on the roster, never came. */
  function endedToday() {
    const end = ended();
    bali.now.joined = [
      { id: 'u-ana', displayName: 'Ana Rodríguez' },
      { id: 'u-marcus', displayName: 'Marcus Bell' },
    ];
    bali.now.last = over(end);
    const at = (minutes: number) => new Date(end.getTime() - minutes * 60_000).toISOString();
    bali.now.events = [
      { seq: 1, eventId: 'e1', type: 'tap_in', userId: 'u-ana', occurredAt: at(50), payload: {} },
      {
        seq: 2,
        eventId: 'e2',
        type: 'tap_in',
        userId: 'u-marcus',
        occurredAt: at(49),
        payload: {},
      },
      {
        seq: 3,
        eventId: 'e3',
        type: 'unlock',
        userId: 'u-marcus',
        occurredAt: at(20),
        payload: { reason: 'nurse' },
      },
    ];
    bali.now.unlocks = [
      {
        eventId: 'e3',
        student: { id: 'u-marcus', displayName: 'Marcus Bell' },
        occurredAt: at(20),
        reason: 'nurse',
        recordedAs: null,
      },
    ];
    bali.now.students = [
      bali.ana,
      bali.marcus,
      { ...bali.ana, enrollmentId: 'e-zuri', studentId: 'u-zuri', displayName: 'Zuri Mensah' },
    ];
  }

  it('is the recap: its end under the name, Open the report and Start another session, no Start and no students', async () => {
    endedToday();
    open();
    await screen.findByRole('heading', COUNT);
    // "3 students", then "Ended at 9:55 AM", as ClassEnded's line says it.
    expect(name().nextElementSibling?.textContent).toBe(
      `3 studentsEnded at ${bellTime(ended().toISOString())}`,
    );
    // Open the report: Reports with this class picked, as ClassEnded links it.
    const report = screen.getByRole('link', { name: 'Open the report' });
    expect(report.getAttribute('href')).toBe(`/reports?class=${bali.CLASS}`);
    expect(screen.getByRole('button', { name: 'Start another session' })).toBeTruthy();
    expect(screen.queryByRole('link', { name: "This class's reports" })).toBeNull();
    expect(screen.queryByRole('form', { name: 'Session length' })).toBeNull();
    expect(screen.queryByRole('heading', { name: 'Students' })).toBeNull();
    // ClassEnded draws no Present, and no How it ended.
    expect(screen.queryByRole('button', { name: 'Present' })).toBeNull();
    expect(screen.queryByText(/How it ended/)).toBeNull();
    expect(screen.queryByText(/stayed focused the whole time\./)).toBeNull();
    // Who wasn't focused the whole time, who was, and who didn't join, from the roster.
    expect(screen.getByRole('button', { name: 'Marcus Bell' })).toBeTruthy();
    expect(screen.getByText('1 stayed focused the whole time')).toBeTruthy();
    expect(screen.getByText("Didn't join: Zuri Mensah")).toBeTruthy();
    await settle();
    expect(bali.unexpected).toEqual([]);
  });

  it('holds the well’s place until the last session is found, so Start never shows and then goes', async () => {
    endedToday();
    bali.now.hold = LAST_KEY;
    open();
    await screen.findByRole('heading', { level: 1, name: 'Biology, period 3' });
    await settle();
    expect(screen.getByRole('status').textContent).toBe('Loading…');
    expect(screen.queryByRole('button', { name: START })).toBeNull();
    await act(async () => {
      bali.holding.shift()?.();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    // Found: the head at once, the recap's place saying so until it is read.
    await screen.findByRole('button', { name: 'Start another session' });
    await screen.findByRole('heading', COUNT);
    expect(screen.queryByRole('button', { name: START })).toBeNull();
  });

  it('says the recap is being read under its head while its report is on its way', async () => {
    endedToday();
    bali.now.hold = REPORT_KEY;
    open();
    await screen.findByRole('button', { name: 'Start another session' });
    expect(screen.getByRole('status').textContent).toBe('Loading the last session…');
    await act(async () => {
      bali.holding.shift()?.();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    await screen.findByRole('heading', COUNT);
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('opens a student’s record from their name, their unlock’s reason in it', async () => {
    endedToday();
    const user = open();
    await user.click(await screen.findByRole('button', { name: 'Marcus Bell' }));
    const record = screen.getByRole('complementary', { name: 'Marcus Bell' });
    expect(
      within(record)
        .getAllByRole('listitem')
        .map((i) => i.textContent),
    ).toEqual([
      expect.stringMatching(/Tapped in and focused$/),
      expect.stringMatching(/Used Emergency UnlockNurse$/),
    ]);
  });

  it('Start another session: the page before a session, Today’s line with its report, focus on Start', async () => {
    endedToday();
    const user = open();
    await user.click(await screen.findByRole('button', { name: 'Start another session' }));
    const start = screen.getByRole('button', { name: 'Start 50-minute session' });
    expect(document.activeElement).toBe(start);
    expect(name().nextElementSibling?.textContent).toBe('3 students');
    const line = screen.getByText('Today, 1 of 2 stayed focused the whole time.', { exact: false });
    const report = within(line).getByRole('link', { name: 'Open the report' });
    expect(report.getAttribute('href')).toBe(`/reports/${bali.CLASS}/${bali.LAST}`);
    expect(screen.queryByRole('heading', COUNT)).toBeNull();
    expect(screen.getByRole('heading', { name: 'Students' })).toBeTruthy();
  });

  it('with no block yet, Start another session puts focus on the class’s name', async () => {
    endedToday();
    bali.now.block = false;
    const user = open();
    await user.click(await screen.findByRole('button', { name: 'Start another session' }));
    await screen.findByRole('heading', { name: 'Register your block first' });
    expect(document.activeElement).toBe(name());
  });

  it('says students that didn’t load under the head, the recap waiting; Try again, the recap', async () => {
    endedToday();
    bali.now.down.add(ROSTER_KEY);
    const user = open();
    await screen.findByRole('button', { name: 'Start another session' });
    const said = await screen.findByRole('alert');
    expect(said.textContent).toBe(`Couldn't load this class. ${CANT_REACH}`);
    expect(name().nextElementSibling?.textContent).toBe(
      `Ended at ${bellTime(ended().toISOString())}`,
    );
    expect(screen.queryByRole('heading', COUNT)).toBeNull();
    expect(screen.queryByRole('status')).toBeNull();

    bali.now.down.clear();
    await user.click(button('Try again'));
    await screen.findByRole('heading', COUNT);
    expect(screen.queryByRole('alert')).toBeNull();
    await vi.waitFor(() => expect(document.activeElement).toBe(name()));
  });

  it('shows the page before a session when its report didn’t load, the line saying why; Try again, the recap, focus on the class’s name', async () => {
    endedToday();
    bali.now.down.add(REPORT_KEY);
    const user = open();
    const said = await screen.findByRole('alert');
    expect(said.textContent).toBe(`Couldn't load the last session. ${CANT_REACH}`);
    expect(screen.getByRole('button', { name: START })).toBeTruthy();

    bali.now.down.clear();
    await user.click(button('Try again'));
    await screen.findByRole('heading', COUNT);
    expect(screen.queryByRole('button', { name: START })).toBeNull();
    await vi.waitFor(() => expect(document.activeElement).toBe(name()));
  });
});
