// @vitest-environment jsdom
import type { MeResponse, SessionReportQuestion, SessionReportResponse } from '@bali/shared';
import { act, cleanup, render, screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createApiClient } from '@/lib/api-client';
import { sessionWhen } from '@/lib/recap';

import { SessionReportPage } from './session-report';
import { Shell } from './shell';

/*
 * A session's report page as a teacher meets it (PV14, L7c; the owner's decision of 2026-10-22: the
 * portal's tests drive the page), Bali's answers a stand-in `fetch`'s under the portal's own API
 * client: read as it opens, its class named from the shell's one read of the account, and again by
 * Try again, held while it reads with its failure kept, focus then on its day (ReportRetryStates);
 * its Questions card read at once with the page, again by the page's Try again and by the card's
 * own, only the newest read's answer drawn, the card after the report's own parts. Converted from
 * the source text of `session-report.test.ts` (LO1), whose renders of each state stay there. With
 * the lessons switch off (LO1; ARCHITECTURE, Web portal, decision 8) the page has no Questions card
 * and reads none, its Try again too.
 */
const bali = vi.hoisted(() => {
  /** One request the page sent, its answer the test's to give unless Bali gives it at once. */
  interface Call {
    path: string;
    answer: (status: number, json: unknown) => void;
  }
  const state = {
    calls: [] as Call[],
    /** Bali's answer now, or null to hold it for the test. */
    reply: (() => null) as (path: string) => [number, unknown] | null,
    token: 'token' as string | null,
    path: '/',
    router: { replace: vi.fn(), push: vi.fn() },
    client: null as ReturnType<typeof import('@/lib/api-client').createApiClient> | null,
    fetch: (url: string | URL | Request) =>
      new Promise<Response>((resolve) => {
        const call: Call = {
          path: (url as string).replace('http://api', ''),
          answer: (status, json) =>
            resolve(
              new Response(JSON.stringify(json), {
                status,
                headers: { 'content-type': 'application/json' },
              }),
            ),
        };
        state.calls.push(call);
        const now = state.reply(call.path);
        if (now) call.answer(...now);
      }),
  };
  return state;
});

vi.mock('next/navigation', () => ({
  usePathname: () => bali.path,
  useRouter: () => bali.router,
}));
vi.mock('@/lib/auth', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/auth')>()),
  getAccessToken: () => bali.token,
}));
vi.mock('@/lib/use-api', () => ({ useApi: () => bali.client, useSignOut: () => () => undefined }));
vi.mock('@/lib/monitoring', () => ({ captureApiFailure: vi.fn() }));

const CLASS = '0199e3a1-0000-7000-8000-00000000000c';
const SESSION = '0199e3a1-0000-7000-8000-00000000000a';
const BASE = `/v1/classes/${CLASS}`;
const REPORT = `${BASE}/reports/sessions/${SESSION}`;
const QUESTIONS = `${REPORT}/questions`;
const EVENTS = `/v1/sessions/${SESSION}/events?after=0`;
const ROSTER = `${BASE}/roster`;
const OTHER = '0199e3a1-0000-7000-8000-00000000000b';

/** A session no one joined, 9:05 to 9:55: its card, no Unlocks table. */
const report: SessionReportResponse = {
  ended: true,
  startedAt: '2026-10-12T14:05:00.000Z',
  endsAt: '2026-10-12T14:55:00.000Z',
  endedAt: '2026-10-12T14:55:00.000Z',
  joined: [],
  focusMinutes: 0,
  averageFocusMinutes: null,
  silentMinutes: 0,
  unlocks: [],
  protectionOffs: [],
};
/** A question it asked, ReportOpened's first. */
const ASKED: SessionReportQuestion = {
  id: '0199e3a1-0000-7000-8000-000000000001',
  prompt: 'Which value of x solves x² − 5x + 6 = 0?',
  options: ['x = 1', 'x = 2', 'x = 4', 'x = 6'],
  correctOption: 1,
  revealed: true,
  open: false,
  openedAt: '2026-10-12T14:18:00.000Z',
  answered: 21,
  eligible: 28,
  counts: [3, 14, 1, 3],
};
/** Its day, as the page heads it in this computer's own words. */
const { day } = sessionWhen({
  startedAt: report.startedAt ?? '',
  endsAt: report.endsAt ?? '',
  endedAt: report.endedAt ?? null,
});
const DOWN: [number, unknown] = [503, { error: { code: 'unavailable', message: 'down' } }];

/** The page's own reads, answered at once; its questions held, for the test to answer. */
const PAGE: Record<string, [number, unknown]> = {
  [REPORT]: [200, report],
  [EVENTS]: [200, { events: [], nextAfter: 0 }],
  [ROSTER]: [200, { students: [] }],
};

beforeEach(() => {
  bali.client = createApiClient({
    baseUrl: 'http://api',
    getToken: () => 'token',
    fetchImpl: bali.fetch,
  });
  bali.reply = (path) => PAGE[path] ?? null;
});

afterEach(() => {
  // Focus off first, so no Try again unmounted here hands focus on in the next test's page.
  if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
  cleanup();
  vi.unstubAllEnvs();
  bali.calls.length = 0;
  bali.token = 'token';
  bali.path = '/';
  bali.router.replace.mockClear();
});

/** Every answer in, and drawn. */
const settle = () => act(() => new Promise((done) => setTimeout(done, 0)));
/** How many times the page asked for `path`. */
const asked = (path: string) => bali.calls.filter((c) => c.path === path).length;
/** The newest request to `path`, answered now. */
async function answer(path: string, status: number, json: unknown) {
  const call = bali.calls.filter((c) => c.path === path).at(-1);
  if (!call) throw new Error(`nothing sent to ${path}`);
  call.answer(status, json);
  await settle();
}
/** The card, by its title. */
const card = () => screen.queryByRole('region', { name: 'Questions' });
/** The page's parts' titles, in their order. */
const titles = () => screen.getAllByRole('heading').map((h) => h.textContent);

/** The page in a `<main>`, as the shell holds it; what it hands back opens another session's. */
function open() {
  const shown = render(
    <main>
      <SessionReportPage classId={CLASS} sessionId={SESSION} />
    </main>,
  );
  return (sessionId: string) =>
    shown.rerender(
      <main>
        <SessionReportPage classId={CLASS} sessionId={sessionId} />
      </main>,
    );
}

describe('a session’s report, read as it opens (PV14)', () => {
  it('names its class as the shell’s one read of the account names it, and reads its report, moments, roster and questions alone', async () => {
    // The teacher's account, read by the shell as the root layout holds the page: the 13+ check,
    // then `/v1/me`, which lists the class.
    const account: MeResponse = {
      user: { id: 'u-rivera', role: 'teacher', displayName: 'Ms. Rivera' },
      classes: [
        {
          id: CLASS,
          name: 'Biology, period 3',
          teacher: { displayName: 'Ms. Rivera' },
          enrollmentId: null,
          liveSession: null,
        },
      ],
      session: null,
      armed: false,
    };
    const SHELL: Record<string, [number, unknown]> = {
      '/v1/me/age-check': [200, { passed: true }],
      '/v1/me': [200, account],
    };
    bali.reply = (path) => PAGE[path] ?? SHELL[path] ?? null;
    bali.path = `/reports/${CLASS}/${SESSION}`;
    render(
      <Shell>
        <SessionReportPage classId={CLASS} sessionId={SESSION} />
      </Shell>,
    );
    await settle();
    await settle();
    const back = screen.getByRole('link', { name: 'Reports · Biology, period 3' });
    expect(back.getAttribute('href')).toBe(`/reports?class=${CLASS}`);
    // Besides the shell's two reads and the count of its opening (A3b): no read of its own but
    // these, none of the class's for its name.
    expect(new Set(bali.calls.map((c) => c.path))).toEqual(
      new Set(['/v1/me/age-check', '/v1/me', '/v1/me/actions', REPORT, EVENTS, ROSTER, QUESTIONS]),
    );
    expect([REPORT, QUESTIONS].map(asked)).toEqual([1, 1]);
  });

  it('says Reports alone on the way back while the account lists no such class', async () => {
    open();
    await settle();
    expect(screen.getByRole('link', { name: 'Reports' }).getAttribute('href')).toBe(
      `/reports?class=${CLASS}`,
    );
  });

  it('reads another session as the page opens on it, never drawing the last one’s answer over it', async () => {
    const OTHER_REPORT = `${BASE}/reports/sessions/${OTHER}`;
    const others: Record<string, [number, unknown]> = {
      ...PAGE,
      [`/v1/sessions/${OTHER}/events?after=0`]: [200, { events: [], nextAfter: 0 }],
    };
    bali.reply = (path) => (path === REPORT ? null : (others[path] ?? null));
    const another = open();
    await settle();
    bali.reply = (path) => (path === OTHER_REPORT ? null : (others[path] ?? null));
    another(OTHER);
    await settle();
    expect(asked(OTHER_REPORT)).toBe(1);
    // The first session's report lands after the page moved on: nothing of it is drawn.
    await answer(REPORT, 200, report);
    expect(screen.getByText('Loading this session…')).toBeTruthy();
    await answer(OTHER_REPORT, 200, report);
    expect(screen.getByRole('heading', { name: 'This session' })).toBeTruthy();
  });

  it('holds Try again while it reads it all again, its line kept, never Loading…; read, focus on its day (ReportRetryStates)', async () => {
    bali.reply = (path) => (path === REPORT ? DOWN : (PAGE[path] ?? null));
    const user = userEvent.setup();
    open();
    await settle();
    const line = screen.getByText("Couldn't load this session.");
    bali.reply = (path) => (path === REPORT ? null : (PAGE[path] ?? null));
    const again = screen.getByRole('button', { name: 'Try again' });
    await user.click(again);
    await settle();
    // On its way: the failure said, Try again held where it is with focus on it.
    expect(screen.getByText("Couldn't load this session.")).toBe(line);
    expect(screen.queryByText('Loading this session…')).toBeNull();
    expect(again.getAttribute('aria-busy')).toBe('true');
    expect(again.getAttribute('aria-disabled')).toBe('true');
    expect(document.activeElement).toBe(again);
    await answer(REPORT, 200, report);
    // Read: focus lands on its day, the page's heading, a frame after the page is drawn.
    await act(() => new Promise((done) => setTimeout(done, 32)));
    expect(document.activeElement).toBe(screen.getByRole('heading', { level: 1, name: day }));
  });
});

describe('a session’s report and its Questions card (L7c)', () => {
  it('reads its questions at once with the page, and draws them after the report’s own parts once both are in', async () => {
    open();
    await settle();
    expect([REPORT, EVENTS, ROSTER, QUESTIONS].map(asked)).toEqual([1, 1, 1, 1]);
    // The page in, its questions not yet: the card says Loading… after the session's card.
    expect(card()?.getAttribute('aria-busy')).toBe('true');
    await answer(QUESTIONS, 200, { questions: [ASKED] });
    expect(card()?.getAttribute('aria-busy')).toBe('false');
    expect(card()?.textContent).toContain('1 asked in this session');
    expect(screen.getByRole('heading', { name: ASKED.prompt })).toBeTruthy();
    expect(titles().slice(1, 3)).toEqual(['This session', 'Questions']);
  });

  it('shows no card while the page itself is read, and reads nothing for a tab with no sign-in', async () => {
    bali.reply = () => null;
    open();
    await settle();
    await answer(QUESTIONS, 200, { questions: [ASKED] });
    expect(screen.getByText('Loading this session…')).toBeTruthy();
    expect(card()).toBeNull();
    cleanup();
    bali.calls.length = 0;
    bali.token = null;
    open();
    await settle();
    expect(bali.calls).toEqual([]);
    expect(bali.router.replace).toHaveBeenCalledWith('/login');
  });

  it('reads the page and its questions again by the page’s Try again, the page drawn as soon as it is read', async () => {
    bali.reply = (path) => (path === REPORT ? DOWN : (PAGE[path] ?? null));
    const user = userEvent.setup();
    open();
    await settle();
    expect(screen.getByText("Couldn't load this session.")).toBeTruthy();
    bali.reply = (path) => PAGE[path] ?? null;
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    await settle();
    expect([REPORT, QUESTIONS].map(asked)).toEqual([2, 2]);
    // Drawn with its questions still on their way.
    expect(screen.getByRole('heading', { name: 'This session' })).toBeTruthy();
    expect(card()?.getAttribute('aria-busy')).toBe('true');
    await answer(QUESTIONS, 200, { questions: [ASKED] });
    expect(card()?.textContent).toContain('1 asked in this session');
  });

  it('reads its questions alone again by the card’s own Try again, the rest of the page kept', async () => {
    const user = userEvent.setup();
    open();
    await settle();
    await answer(QUESTIONS, ...DOWN);
    expect(card()?.textContent).toContain("Bali couldn't load this session's questions.");
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    await settle();
    expect([REPORT, EVENTS, ROSTER, QUESTIONS].map(asked)).toEqual([1, 1, 1, 2]);
    await answer(QUESTIONS, 200, { questions: [ASKED] });
    expect(card()?.textContent).toContain('1 asked in this session');
    expect(screen.getByRole('heading', { name: 'This session' })).toBeTruthy();
  });

  it('draws only the newest read’s answer: a slow one never says its failure over one read since', async () => {
    bali.reply = (path) => (path === REPORT ? DOWN : (PAGE[path] ?? null));
    const user = userEvent.setup();
    open();
    await settle();
    // The first questions read still out, the page's Try again sends a second.
    bali.reply = (path) => PAGE[path] ?? null;
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    await settle();
    const [first, second] = bali.calls.filter((c) => c.path === QUESTIONS);
    second?.answer(200, { questions: [ASKED] });
    await settle();
    first?.answer(...DOWN);
    await settle();
    expect(card()?.textContent).toContain('1 asked in this session');
    expect(screen.queryByRole('alert')).toBeNull();
  });
});

describe('a session’s report with lessons off (LO1)', () => {
  it('reads no questions and shows no Questions card, the report itself as ever', async () => {
    vi.stubEnv('NEXT_PUBLIC_LESSONS', 'off');
    open();
    await settle();
    expect([REPORT, EVENTS, ROSTER, QUESTIONS].map(asked)).toEqual([1, 1, 1, 0]);
    expect(titles()).toEqual([day, 'This session']);
    expect(card()).toBeNull();
  });

  it('reads the page alone again by its Try again', async () => {
    vi.stubEnv('NEXT_PUBLIC_LESSONS', 'off');
    bali.reply = (path) => (path === REPORT ? DOWN : (PAGE[path] ?? null));
    const user = userEvent.setup();
    open();
    await settle();
    bali.reply = (path) => PAGE[path] ?? null;
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    await settle();
    expect([REPORT, QUESTIONS].map(asked)).toEqual([2, 0]);
    expect(screen.getByRole('heading', { name: 'This session' })).toBeTruthy();
    expect(card()).toBeNull();
  });
});
