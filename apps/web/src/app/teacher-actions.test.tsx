// @vitest-environment jsdom
import type {
  ClassDetail,
  Deck,
  MeResponse,
  RosterResponse,
  SavedQuestion,
  SessionReportResponse,
  SessionReportSummary,
  SessionSnapshot,
  TeacherQuestion,
} from '@bali/shared';
import { act, cleanup, render, screen, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { type ReactNode, StrictMode } from 'react';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { CountContext, useCountOpened } from '@/components/count';
import { DecksPanel } from '@/components/decks-panel';
import { SessionReportPage } from '@/components/session-report';
import { Shell } from '@/components/shell';
import { type ApiClient, createApiClient } from '@/lib/api-client';

import CallbackPage from './auth/callback/page';
import ClassDetailPage from './classes/[id]/page';
import ClassesPage from './classes/page';
import HomePage from './page';

/*
 * A teacher's actions, counted for PostHog through Bali's API (A3b; ARCHITECTURE, "Analytics
 * (PostHog)"), as a teacher makes them (the owner's decision of 2026-10-22: the portal's tests drive
 * the page): each one posted to `POST /v1/me/actions` once it has happened, under a UUIDv7 of its
 * own, never one that failed, never for a student, and an opening once however React draws it. A
 * count that fails changes nothing on screen. Every page sits in the shell, whose one read of the
 * account is the gate, in React's Strict Mode, which runs each effect twice as a page opens, as
 * the development build does. Bali's answers come from a stand-in `fetch` under the portal's own
 * client; the sign-in's token from a stand-in for Cognito's.
 */

const bali = vi.hoisted(() => {
  const CLASS = '019a0000-0000-7000-8000-0000000000c1';
  const SESSION = '019a0000-0000-7000-8000-000000000005';
  const LAST = '019a0000-0000-7000-8000-000000000004';
  const QUESTION = '019a0000-0000-7000-8000-0000000000a1';
  const at = Date.now();
  const iso = (minutes: number) => new Date(at + minutes * 60_000).toISOString();
  const session = { id: SESSION, classId: CLASS, startedAt: iso(-10), endsAt: iso(40) };
  /** What Bali holds: whose account, whether the class runs, and how each request goes. */
  const now = {
    role: 'teacher' as 'teacher' | 'student',
    running: false,
    /** The class's last session, over: the recap's. */
    ranBefore: false,
    /** The counts' answer: `{}`, no answer at all, or a 500. */
    actions: 'ok' as 'ok' | 'down' | 'error',
    /** Requests Bali fails with a 500, by "METHOD path". */
    refused: new Set<string>(),
    /** A request whose answer waits for the test (`holding`). */
    hold: null as string | null,
    path: '/',
  };
  const holding: (() => void)[] = [];
  const me = (): MeResponse => ({
    user: { id: 'u-rivera', role: now.role, displayName: 'Ms. Rivera' },
    classes: [],
    session: null,
    armed: false,
  });
  const klass = (): ClassDetail => ({
    id: CLASS,
    name: 'Biology, period 3',
    joinCode: 'VMAF7E',
    createdAt: '2026-09-01T14:00:00.000Z',
    liveSessionId: now.running ? SESSION : null,
  });
  const roster: RosterResponse = {
    students: [
      {
        enrollmentId: 'e-ana',
        studentId: 'u-ana',
        displayName: 'Ana Rodríguez',
        joinedAt: '2026-09-02T14:00:00.000Z',
      },
    ],
  };
  const snapshot: SessionSnapshot = {
    session,
    ended: false,
    latestSeq: 4,
    students: [
      {
        enrollmentId: 'e-ana',
        studentId: 'u-ana',
        displayName: 'Ana Rodríguez',
        state: 'focused',
        joinedAt: session.startedAt,
        lastSeenAt: new Date(at - 10_000).toISOString(),
        endedAt: null,
        unlock: null,
        protectionOffAfterEnd: false,
      },
    ],
    question: null,
    presentation: null,
  };
  const last: SessionReportSummary = {
    id: LAST,
    startedAt: iso(-1440),
    endsAt: iso(-1390),
    endedAt: iso(-1390),
    ended: true,
    joinedCount: 1,
    focusMinutes: 50,
    averageFocusMinutes: 50,
    silentMinutes: 0,
    unlockCount: 0,
    protectionOffCount: 0,
  };
  const report: SessionReportResponse = {
    ended: true,
    startedAt: last.startedAt,
    endsAt: last.endsAt,
    endedAt: last.endedAt,
    joined: [{ id: 'u-ana', displayName: 'Ana Rodríguez' }],
    focusMinutes: 50,
    averageFocusMinutes: 50,
    silentMinutes: 0,
    unlocks: [],
    protectionOffs: [],
  };
  const saved: SavedQuestion = {
    id: '019a0000-0000-7000-8000-0000000000b1',
    prompt: 'What is 7 × 8?',
    options: ['54', '56'],
    correctOption: 1,
    eventId: '019a0000-0000-7000-8000-0000000000b2',
    createdAt: iso(-60),
    updatedAt: iso(-60),
  };
  const question: TeacherQuestion = {
    id: QUESTION,
    prompt: saved.prompt,
    options: saved.options,
    correctOption: 1,
    revealed: false,
    open: true,
  };
  const deck: Deck = {
    id: '019a0000-0000-7000-8000-0000000000d1',
    title: 'Factoring quadratics',
    status: 'ready',
    bytes: 1_200_000,
    sha256: '1'.repeat(64),
    pageCount: 12,
    rejection: null,
    createdAt: iso(-1440),
  };
  /** Every route a page here reads or sends to, as Bali answers it. */
  const routes: Record<string, () => [number, unknown]> = {
    'GET /v1/me/age-check': () => [200, { passed: true }],
    'GET /v1/me': () => [200, me()],
    'POST /v1/me/actions': () =>
      now.actions === 'error' ? [500, { error: { code: 'internal', message: 'boom' } }] : [200, {}],
    [`GET /v1/classes/${CLASS}`]: () => [200, klass()],
    [`GET /v1/classes/${CLASS}/roster`]: () => [200, roster],
    [`POST /v1/classes/${CLASS}/sessions`]: () => {
      now.running = true;
      return [201, { outcome: 'created', session, armedConverted: 0 }];
    },
    [`GET /v1/sessions/${SESSION}`]: () => [200, snapshot],
    [`POST /v1/sessions/${SESSION}/extend`]: () => [
      200,
      { outcome: 'extended', session: { id: SESSION, classId: CLASS, endsAt: iso(45) } },
    ],
    [`POST /v1/sessions/${SESSION}/end`]: () => {
      now.running = false;
      return [200, { outcome: 'ended', endedParticipations: 1 }];
    },
    [`GET /v1/classes/${CLASS}/reports/sessions?limit=1`]: () => [
      200,
      { sessions: now.ranBefore ? [last] : [], nextBefore: null },
    ],
    [`GET /v1/classes/${CLASS}/reports/sessions/${LAST}`]: () => [200, report],
    [`GET /v1/classes/${CLASS}/reports/sessions/${LAST}/questions`]: () => [200, { questions: [] }],
    'GET /v1/saved-questions': () => [200, { savedQuestions: [saved] }],
    [`POST /v1/sessions/${SESSION}/questions`]: () => [201, { outcome: 'opened', question }],
    [`GET /v1/questions/${QUESTION}/results`]: () => [
      200,
      { answered: 0, eligible: 1, open: true, correctOption: 1, revealed: false, counts: null },
    ],
    'GET /v1/decks': () => [200, { decks: [deck] }],
    'GET /v1/blocks': () => [200, { blocks: [] }],
    'POST /v1/blocks': () => [
      201,
      { id: '019a0000-0000-7000-8000-0000000000e1', tagId: 'BALI7Q2M4X', createdAt: iso(0) },
    ],
    'POST /v1/classes': () => [
      201,
      {
        id: '019a0000-0000-7000-8000-0000000000c2',
        name: 'Period 4 Biology',
        joinCode: 'Q5FU3U',
        createdAt: iso(0),
        liveSessionId: null,
      },
    ],
  };
  /** Every request a page sent, in order, as it sent it; and any Bali has no answer for. */
  const sent: { key: string; body: unknown }[] = [];
  const unexpected: string[] = [];
  const fetch = (url: string | URL | Request, init?: RequestInit) => {
    const key = `${init?.method ?? 'GET'} ${(url as string).replace('http://api', '')}`;
    sent.push({ key, body: typeof init?.body === 'string' ? JSON.parse(init.body) : null });
    if (key === 'POST /v1/me/actions' && now.actions === 'down') {
      return Promise.reject(new TypeError('Failed to fetch'));
    }
    const moments = /^GET \/v1\/sessions\/[^/]+\/events\?after=(\d+)$/.exec(key);
    const route = moments
      ? (): [number, unknown] => [200, { events: [], nextAfter: Number(moments[1]) }]
      : routes[key];
    const wait = key === now.hold ? new Promise<void>((go) => holding.push(go)) : null;
    return (wait ?? Promise.resolve()).then(() => {
      let answer: [number, unknown];
      if (now.refused.has(key)) answer = [500, { error: { code: 'internal', message: 'boom' } }];
      else if (route) answer = route();
      else {
        unexpected.push(key);
        answer = [404, { error: { code: 'not_found', message: 'not found' } }];
      }
      return Response.json(answer[1], { status: answer[0] });
    });
  };
  return {
    CLASS,
    SESSION,
    LAST,
    now,
    holding,
    sent,
    unexpected,
    fetch,
    router: { replace: vi.fn(), push: vi.fn() },
    signOut: vi.fn(),
    client: null as ApiClient | null,
  };
});

vi.mock('next/navigation', () => ({
  useParams: () => ({ id: bali.CLASS }),
  usePathname: () => bali.now.path,
  useRouter: () => bali.router,
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock('@/lib/use-api', () => ({ useApi: () => bali.client, useSignOut: () => bali.signOut }));
// No stream runs: the live grid is its snapshot.
vi.mock('@/lib/sse-client', () => ({ createSseClient: () => ({ close: () => undefined }) }));
vi.mock('@/lib/monitoring', () => ({ captureApiFailure: vi.fn() }));

const UUID_V7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const COUNT = 'POST /v1/me/actions';

/**
 * Each count Bali was sent, in order, by name: each body the name and a UUIDv7 of its own, and
 * nothing else.
 */
function counted(): string[] {
  const bodies = bali.sent
    .filter(({ key }) => key === COUNT)
    .map(({ body }) => body as Record<string, unknown>);
  for (const body of bodies) {
    expect(Object.keys(body).sort()).toEqual(['event', 'eventId']);
    expect(body.eventId).toMatch(UUID_V7);
  }
  expect(new Set(bodies.map(({ eventId }) => eventId)).size).toBe(bodies.length);
  return bodies.map(({ event }) => event as string);
}

/** Whether the last count went after the last request of `key`, the action it counts. */
const countedAfter = (key: string) => {
  const keys = bali.sent.map((request) => request.key);
  return keys.lastIndexOf(COUNT) > keys.lastIndexOf(key);
};

/** A page in the shell, as the root layout draws it, in Strict Mode. */
const inShell = (page: ReactNode) => (
  <StrictMode>
    <Shell>{page}</Shell>
  </StrictMode>
);

/** A page at `path`, opened signed in, in the shell. */
function open(path: string, page: ReactNode) {
  bali.now.path = path;
  return render(inShell(page));
}

/** Bali's answers so far, and what they set off, drawn. */
const settle = () =>
  act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 20));
  });

/** The request held (`now.hold`), answered now. */
const release = () =>
  act(async () => {
    bali.holding.shift()?.();
    await new Promise((resolve) => setTimeout(resolve, 20));
  });

/** The browser's Escape on an open modal: `cancel`, then closed unless that was prevented. */
function escape(e: KeyboardEvent) {
  const dialog = document.querySelector<HTMLDialogElement>('dialog[open]');
  if (e.key !== 'Escape' || !dialog) return;
  const cancel = new Event('cancel', { cancelable: true });
  dialog.dispatchEvent(cancel);
  if (!cancel.defaultPrevented) dialog.close();
}
const showModal = Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, 'showModal');
const closeModal = Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, 'close');
beforeAll(() => {
  // jsdom draws a `<dialog>` but has no `showModal` or `close`: these do what the browser does.
  HTMLDialogElement.prototype.showModal = function (this: HTMLDialogElement) {
    this.setAttribute('open', '');
  };
  HTMLDialogElement.prototype.close = function (this: HTMLDialogElement) {
    if (!this.open) return;
    this.removeAttribute('open');
    this.dispatchEvent(new Event('close'));
  };
  document.addEventListener('keydown', escape);
});
afterAll(() => {
  document.removeEventListener('keydown', escape);
  for (const [name, was] of [
    ['showModal', showModal],
    ['close', closeModal],
  ] as const) {
    if (was) Object.defineProperty(HTMLDialogElement.prototype, name, was);
    else delete (HTMLDialogElement.prototype as Partial<HTMLDialogElement>)[name];
  }
});

beforeEach(() => {
  sessionStorage.setItem('bali.access_token', 'token');
  bali.client = createApiClient({
    baseUrl: 'http://api',
    getToken: () => 'token',
    fetchImpl: bali.fetch,
  });
});

afterEach(() => {
  // Focus off first, so nothing unmounted here hands focus on in the next test's page.
  if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
  cleanup();
  vi.unstubAllGlobals();
  sessionStorage.clear();
  window.history.replaceState(null, '', '/');
  Object.assign(bali.now, {
    role: 'teacher',
    running: false,
    ranBefore: false,
    actions: 'ok',
    hold: null,
    path: '/',
  });
  bali.now.refused.clear();
  bali.holding.length = 0;
  bali.sent.length = 0;
  bali.unexpected.length = 0;
  bali.router.replace.mockClear();
});

/** Back from Cognito's sign-in page with its code: the callback opens, Cognito answers the code. */
function backFromSignIn() {
  sessionStorage.clear();
  sessionStorage.setItem('bali.pkce.state', 'st');
  sessionStorage.setItem('bali.pkce.verifier', 'v');
  window.history.replaceState(null, '', '/auth/callback?code=c&state=st');
  vi.stubGlobal(
    'fetch',
    vi.fn(() => Promise.resolve(Response.json({ access_token: 'token' }))),
  );
}

describe('a sign-in (portal_signed_in)', () => {
  it('counts once, as the account first reads as a teacher’s: never at the callback, another page or a reload', async () => {
    backFromSignIn();
    const { rerender } = open('/auth/callback', <CallbackPage />);
    await vi.waitFor(() => expect(bali.router.replace).toHaveBeenCalledWith('/'));
    // Signed in, the account not read yet: nothing counted.
    await settle();
    expect(counted()).toEqual([]);

    // Home, where the callback sends it: the account read, a teacher's, counted.
    bali.now.path = '/';
    rerender(inShell(<p>The home page</p>));
    await vi.waitFor(() => expect(counted()).toEqual(['portal_signed_in']));
    expect(countedAfter('GET /v1/me')).toBe(true);
    expect(screen.getByText('The home page')).toBeTruthy();

    // Another page, and a reload: the account kept, then read again by a new shell; none counted.
    bali.now.path = '/classes';
    rerender(inShell(<p>The classes page</p>));
    await screen.findByText('The classes page');
    cleanup();
    open('/', <p>The home page</p>);
    await screen.findByRole('navigation', { name: 'Main' });
    await settle();
    expect(counted()).toEqual(['portal_signed_in']);
    expect(bali.sent.filter(({ key }) => key === 'GET /v1/me')).toHaveLength(2);
    expect(bali.unexpected).toEqual([]);
  });

  it('counts a student’s sign-in never: their home sends nothing', async () => {
    bali.now.role = 'student';
    backFromSignIn();
    const { rerender } = open('/auth/callback', <CallbackPage />);
    await vi.waitFor(() => expect(bali.router.replace).toHaveBeenCalledWith('/'));
    bali.now.path = '/';
    rerender(inShell(<HomePage />));
    await screen.findByRole('heading', { level: 1, name: 'Your classes' });
    await settle();
    expect(counted()).toEqual([]);
    expect(bali.unexpected).toEqual([]);
  });
});

/**
 * The class page, signed in as a teacher: live, its grid read, or its Start's card. Its controls
 * are found once the shell shows the page, the account read; in Present, which the shell never
 * hides, at once.
 */
async function classPage(running: boolean) {
  bali.now.running = running;
  const user = userEvent.setup();
  open(`/classes/${bali.CLASS}`, <ClassDetailPage />);
  if (running) {
    await screen.findByRole('button', { name: 'End session' });
    await screen.findByText('Ana Rodríguez');
  } else await screen.findByRole('button', { name: /^Start \d+-minute session$/ });
  return user;
}
const start = () => screen.getByRole('button', { name: /^Start \d+-minute session$/ });

describe('a class’s Start, extend and End (portal_session_started, _extended, _ended)', () => {
  it('counts a Start once Bali has started it, never while it is on its way, nor one that failed', async () => {
    const user = await classPage(false);
    const START = `POST /v1/classes/${bali.CLASS}/sessions`;
    bali.now.refused.add(START);
    await user.click(start());
    await screen.findByRole('alert');
    expect(counted()).toEqual([]);

    // Start sends it again: on its way, nothing counted; answered, once.
    bali.now.refused.clear();
    bali.now.hold = START;
    const button = start();
    await user.click(button);
    expect(button.textContent).toBe('Starting…');
    await settle();
    expect(counted()).toEqual([]);
    await release();
    await screen.findByRole('button', { name: 'End session' });
    expect(counted()).toEqual(['portal_session_started']);
    expect(countedAfter(START)).toBe(true);
    expect(bali.unexpected).toEqual([]);
  });

  it('counts each extend once its time is added, never one that failed', async () => {
    const user = await classPage(true);
    const EXTEND = `POST /v1/sessions/${bali.SESSION}/extend`;
    bali.now.refused.add(EXTEND);
    await user.click(screen.getByRole('button', { name: '+5 min' }));
    await screen.findByRole('alert');
    expect(counted()).toEqual([]);

    // Its Try again sends the same one again, counted once it is added; then +10, its own.
    bali.now.refused.clear();
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    await vi.waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
    expect(counted()).toEqual(['portal_session_extended']);
    expect(countedAfter(EXTEND)).toBe(true);
    await user.click(screen.getByRole('button', { name: '+10 min' }));
    await vi.waitFor(() =>
      expect(counted()).toEqual(['portal_session_extended', 'portal_session_extended']),
    );
    expect(bali.unexpected).toEqual([]);
  });

  it('counts an End once Bali has ended it, never one that failed', async () => {
    const user = await classPage(true);
    const END = `POST /v1/sessions/${bali.SESSION}/end`;
    await user.click(screen.getByRole('button', { name: 'End session' }));
    const confirm = screen.getByRole('dialog', { name: 'End session now?' });
    bali.now.refused.add(END);
    await user.click(within(confirm).getByRole('button', { name: 'End session' }));
    await within(confirm).findByRole('alert');
    expect(counted()).toEqual([]);

    bali.now.refused.clear();
    await user.click(within(confirm).getByRole('button', { name: 'Try again' }));
    await screen.findByRole('button', { name: /^Start \d+-minute session$/ });
    expect(counted()).toEqual(['portal_session_ended']);
    expect(countedAfter(END)).toBe(true);
    expect(bali.unexpected).toEqual([]);
  });
});

describe('Present and the recap (portal_present_opened, portal_recap_opened)', () => {
  const present = () => screen.getByRole('button', { name: 'Present' });

  it('counts Present once each time it opens, never as it redraws', async () => {
    const user = await classPage(true);
    await user.click(present());
    await vi.waitFor(() => expect(counted()).toEqual(['portal_present_opened']));
    // In Present, the time added redraws it: that extend counted, Present not again.
    await user.click(screen.getByRole('button', { name: '+5 min' }));
    await vi.waitFor(() =>
      expect(counted()).toEqual(['portal_present_opened', 'portal_session_extended']),
    );
    // Off, nothing; on again, once more.
    await user.click(present());
    await settle();
    expect(counted()).toHaveLength(2);
    await user.click(present());
    await vi.waitFor(() =>
      expect(counted()).toEqual([
        'portal_present_opened',
        'portal_session_extended',
        'portal_present_opened',
      ]),
    );
    expect(bali.unexpected).toEqual([]);
  });

  it('counts Present opened from Home’s Present once, as its page opens', async () => {
    window.history.replaceState(null, '', `/classes/${bali.CLASS}?present`);
    await classPage(true);
    expect(present().getAttribute('aria-pressed')).toBe('true');
    await settle();
    expect(counted()).toEqual(['portal_present_opened']);
  });

  it('counts Present only once it shows its class, never while the class didn’t load', async () => {
    window.history.replaceState(null, '', `/classes/${bali.CLASS}?present`);
    bali.now.running = true;
    bali.now.refused.add(`GET /v1/classes/${bali.CLASS}`);
    const user = userEvent.setup();
    open(`/classes/${bali.CLASS}`, <ClassDetailPage />);
    await screen.findByText(/^Couldn't load this class\./);
    await settle();
    expect(counted()).toEqual([]);

    bali.now.refused.clear();
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    await screen.findByText('Ana Rodríguez');
    await vi.waitFor(() => expect(counted()).toEqual(['portal_present_opened']));
  });

  it('counts the recap once as the class page shows it, never while its read fails', async () => {
    bali.now.ranBefore = true;
    bali.now.refused.add(`GET /v1/classes/${bali.CLASS}/reports/sessions/${bali.LAST}`);
    const user = await classPage(false);
    await screen.findByText("Couldn't load the last session.");
    expect(counted()).toEqual([]);

    bali.now.refused.clear();
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    await screen.findByRole('link', { name: 'Open its report' });
    await vi.waitFor(() => expect(counted()).toEqual(['portal_recap_opened']));
    // The page redrawn under it (another length picked): not again.
    await user.click(screen.getByRole('radio', { name: '25 min' }));
    await settle();
    expect(counted()).toEqual(['portal_recap_opened']);
    expect(bali.unexpected).toEqual([]);
  });

  it('counts a recap shown as its page opens just once', async () => {
    bali.now.ranBefore = true;
    await classPage(false);
    await screen.findByRole('link', { name: 'Open its report' });
    await settle();
    expect(counted()).toEqual(['portal_recap_opened']);
  });

  it('counts the recap only once its roster is in too, never while the card says it didn’t load', async () => {
    bali.now.ranBefore = true;
    bali.now.refused.add(`GET /v1/classes/${bali.CLASS}/roster`);
    const user = await classPage(false);
    const recap = await screen.findByRole('region', { name: 'Last session' });
    await within(recap).findByText("Couldn't load the last session.");
    await settle();
    expect(counted()).toEqual([]);

    bali.now.refused.clear();
    await user.click(within(recap).getByRole('button', { name: 'Try again' }));
    await within(recap).findByRole('link', { name: 'Open its report' });
    await vi.waitFor(() => expect(counted()).toEqual(['portal_recap_opened']));
  });
});

/** A part of a page that opens with `shown`, as the report, the recap and Present count theirs. */
function Opening({ shown }: { shown: boolean }) {
  useCountOpened('portal_report_opened', shown);
  return null;
}

describe('an opening, counted once (useCountOpened)', () => {
  it('counts once per opening: drawn open under Strict Mode, and as a new sender comes, once; closed and opened again, once more', () => {
    const drawn = (count: ((event: string) => void) | null, shown: boolean) => (
      <StrictMode>
        <CountContext value={count}>
          <Opening shown={shown} />
        </CountContext>
      </StrictMode>
    );
    // Open before the account reads as a teacher's: nothing, until it does.
    const { rerender } = render(drawn(null, true));
    const first = vi.fn();
    rerender(drawn(first, true));
    expect(first).toHaveBeenCalledExactlyOnceWith('portal_report_opened');
    // The shell's sender anew, its page still open: no second count.
    const second = vi.fn();
    rerender(drawn(second, true));
    rerender(drawn(second, true));
    expect(second).not.toHaveBeenCalled();
    // Closed, then opened again: once more.
    rerender(drawn(second, false));
    rerender(drawn(second, true));
    expect(second).toHaveBeenCalledExactlyOnceWith('portal_report_opened');
    expect(first).toHaveBeenCalledOnce();
  });

  it('counts a part drawn open at once only once, for React’s development double effects', () => {
    const count = vi.fn();
    render(
      <StrictMode>
        <CountContext value={count}>
          <Opening shown />
        </CountContext>
      </StrictMode>,
    );
    expect(count).toHaveBeenCalledExactlyOnceWith('portal_report_opened');
  });
});

describe('a question asked and slides shown (portal_question_asked, portal_slides_shown)', () => {
  it('counts a question once Bali has asked it, never one that failed', async () => {
    const user = await classPage(true);
    const ASK = `POST /v1/sessions/${bali.SESSION}/questions`;
    await user.click(screen.getByRole('button', { name: 'Ask a question' }));
    const panel = screen.getByRole('complementary', { name: 'Ask a question' });
    bali.now.refused.add(ASK);
    await user.click(await within(panel).findByRole('button', { name: 'Ask' }));
    await within(panel).findByRole('alert');
    expect(counted()).toEqual([]);

    bali.now.refused.clear();
    await user.click(within(panel).getByRole('button', { name: 'Try again' }));
    await vi.waitFor(() => expect(counted()).toEqual(['portal_question_asked']));
    expect(countedAfter(ASK)).toBe(true);
    expect(bali.unexpected).toEqual([]);
  });

  it('counts a deck shown once the class shows it, the panel closed meanwhile too, never one that didn’t show', async () => {
    const user = userEvent.setup();
    const answers: ((shown: boolean) => void)[] = [];
    const show = vi.fn(() => new Promise<boolean>((done) => answers.push(done)));
    const panel = (
      <DecksPanel
        id="P"
        lesson={{ changing: null, said: null, show }}
        onShown={vi.fn()}
        onClose={vi.fn()}
      />
    );
    const { rerender } = open(`/classes/${bali.CLASS}`, panel);
    const shown = (ok: boolean) =>
      act(async () => {
        answers.shift()?.(ok);
        await new Promise((resolve) => setTimeout(resolve, 0));
      });

    await user.click(await screen.findByRole('button', { name: 'Show' }));
    await shown(false);
    expect(counted()).toEqual([]);
    await user.click(screen.getByRole('button', { name: 'Show' }));
    await shown(true);
    expect(counted()).toEqual(['portal_slides_shown']);
    // Shown after the panel closed: it showed all the same.
    await user.click(screen.getByRole('button', { name: 'Show' }));
    rerender(inShell(<p>The class</p>));
    await shown(true);
    expect(counted()).toEqual(['portal_slides_shown', 'portal_slides_shown']);
    expect(show).toHaveBeenCalledTimes(3);
    expect(bali.unexpected).toEqual([]);
  });
});

describe('Classes: a class made and a block registered (portal_class_created, _block_registered)', () => {
  async function classes() {
    const user = userEvent.setup();
    open('/classes', <ClassesPage />);
    await screen.findByRole('heading', { level: 1, name: 'Classes' });
    await screen.findByText('No block registered yet.');
    return user;
  }

  it('counts a class once Bali has made it, never a create that failed', async () => {
    const user = await classes();
    await user.click(screen.getByRole('button', { name: 'New class' }));
    const dialog = screen.getByRole('dialog', { name: 'New class' });
    await user.type(
      within(dialog).getByRole('textbox', { name: 'Class name' }),
      'Period 4 Biology',
    );
    bali.now.refused.add('POST /v1/classes');
    await user.click(within(dialog).getByRole('button', { name: 'Create class' }));
    await within(dialog).findByRole('alert');
    expect(counted()).toEqual([]);

    bali.now.refused.clear();
    await user.click(within(dialog).getByRole('button', { name: 'Try again' }));
    await screen.findByRole('heading', { name: 'Period 4 Biology is ready' });
    expect(counted()).toEqual(['portal_class_created']);
    expect(countedAfter('POST /v1/classes')).toBe(true);
    expect(bali.unexpected).toEqual([]);
  });

  it('counts a block once Bali has registered it, never one that failed', async () => {
    const user = await classes();
    await user.type(screen.getByRole('textbox', { name: 'Block ID' }), 'BALI7Q2M4X');
    bali.now.refused.add('POST /v1/blocks');
    await user.click(screen.getByRole('button', { name: 'Register block' }));
    await screen.findByRole('alert');
    expect(counted()).toEqual([]);

    bali.now.refused.clear();
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    await screen.findByText('BALI7Q2M4X is registered to you.');
    expect(counted()).toEqual(['portal_block_registered']);
    expect(countedAfter('POST /v1/blocks')).toBe(true);
    expect(bali.unexpected).toEqual([]);
  });
});

describe('a session’s report (portal_report_opened)', () => {
  const REPORT = `GET /v1/classes/${bali.CLASS}/reports/sessions/${bali.LAST}`;
  const report = () =>
    open(
      `/reports/${bali.CLASS}/${bali.LAST}`,
      <SessionReportPage classId={bali.CLASS} sessionId={bali.LAST} />,
    );

  it('counts a report once as its page shows it, never while its read fails', async () => {
    bali.now.refused.add(REPORT);
    const user = userEvent.setup();
    report();
    await screen.findByText("Couldn't load this session.");
    expect(counted()).toEqual([]);

    bali.now.refused.clear();
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    await screen.findByRole('heading', { name: 'This session' });
    await vi.waitFor(() => expect(counted()).toEqual(['portal_report_opened']));
    expect(countedAfter(REPORT)).toBe(true);
  });

  it('counts a report read as its page opens just once', async () => {
    report();
    await screen.findByRole('heading', { name: 'This session' });
    await settle();
    expect(counted()).toEqual(['portal_report_opened']);
    expect(bali.unexpected).toEqual([]);
  });

  it('counts nothing for a student, whatever page they reach and whatever Bali answers', async () => {
    bali.now.role = 'student';
    report();
    await screen.findByRole('heading', { name: 'This session' });
    await settle();
    expect(counted()).toEqual([]);
  });
});

describe('a count that fails changes nothing on screen', () => {
  /** What the teacher sees: every word, every line said, and where focus is. */
  const seen = () => ({
    words: document.body.textContent,
    said: screen.queryAllByRole('alert').map((line) => line.textContent),
    focus: document.activeElement?.textContent,
  });

  for (const fails of ['down', 'error'] as const) {
    const how = fails === 'down' ? 'gets no answer' : 'fails at Bali';

    it(`leaves a report as a counted one, when its count ${how}`, async () => {
      const shown = async () => {
        open(
          `/reports/${bali.CLASS}/${bali.LAST}`,
          <SessionReportPage classId={bali.CLASS} sessionId={bali.LAST} />,
        );
        await screen.findByRole('heading', { name: 'This session' });
        await settle();
        const now = seen();
        cleanup();
        return now;
      };
      const ok = await shown();
      bali.now.actions = fails;
      expect(await shown()).toEqual(ok);
      // Both were sent; the second failed.
      expect(counted()).toEqual(['portal_report_opened', 'portal_report_opened']);
    });

    it(`leaves a Start as a counted one, the live page with no line, when its count ${how}`, async () => {
      bali.now.actions = fails;
      const user = await classPage(false);
      await user.click(start());
      await screen.findByRole('button', { name: 'End session' });
      await settle();
      expect(counted()).toEqual(['portal_session_started']);
      expect(screen.queryAllByRole('alert')).toEqual([]);
      expect(document.body.textContent).not.toMatch(/Couldn|couldn|Try again/);
      expect(bali.router.replace).not.toHaveBeenCalled();
    });

    it(`keeps a teacher signed in on their page, when the sign-in’s count ${how}`, async () => {
      bali.now.actions = fails;
      backFromSignIn();
      const { rerender } = open('/auth/callback', <CallbackPage />);
      await vi.waitFor(() => expect(bali.router.replace).toHaveBeenCalledWith('/'));
      bali.now.path = '/';
      rerender(inShell(<p>The home page</p>));
      await vi.waitFor(() => expect(counted()).toEqual(['portal_signed_in']));
      await settle();
      expect(screen.getByText('The home page')).toBeTruthy();
      expect(screen.queryAllByRole('alert')).toEqual([]);
      expect(bali.router.replace).not.toHaveBeenCalledWith('/login');
    });
  }
});
