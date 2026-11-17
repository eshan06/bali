// @vitest-environment jsdom
import type { MeResponse, SessionReportResponse } from '@bali/shared';
import { act, cleanup, render, screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { isValidElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createApiClient } from '@/lib/api-client';
import { sessionWhen } from '@/lib/recap';

import { SessionReportPage } from './session-report';
import { Shell } from './shell';

/*
 * A session's report page as a teacher meets it (PV14; the recap since LO7, ClassEndedStates' "a
 * session's report, on its own page", drawn first; the owner's decision of 2026-10-22: the
 * portal's tests drive the page), Bali's answers a stand-in `fetch`'s under the portal's own API
 * client: read as it opens, its class named from the shell's one read of the account, and again by
 * Try again, held while it reads with its failure kept, focus then on the class's name. The recap
 * itself is driven in recap-card.test.tsx. It reads no questions and shows no Questions card,
 * whichever way the lessons switch is set (LO1, LO7; ARCHITECTURE, Web portal, decision 8).
 * Converted from `session-report.test.ts`'s renders, with its route's test.
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

const notFound = vi.hoisted(() =>
  vi.fn(() => {
    throw new Error('not found');
  }),
);
vi.mock('next/navigation', () => ({
  notFound,
  usePathname: () => bali.path,
  useRouter: () => bali.router,
}));
vi.mock('@/lib/auth', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/auth')>()),
  getAccessToken: () => bali.token,
}));
vi.mock('@/lib/use-api', () => ({ useApi: () => bali.client, useSignOut: () => () => undefined }));
vi.mock('@/lib/monitoring', () => ({ captureApiFailure: vi.fn() }));
const { default: Route } = await import('../app/reports/[classId]/[sessionId]/page');

const CLASS = '0199e3a1-0000-7000-8000-00000000000c';
const SESSION = '0199e3a1-0000-7000-8000-00000000000a';
const BASE = `/v1/classes/${CLASS}`;
const REPORT = `${BASE}/reports/sessions/${SESSION}`;
const QUESTIONS = `${REPORT}/questions`;
const EVENTS = `/v1/sessions/${SESSION}/events?after=0`;
const ROSTER = `${BASE}/roster`;
const OTHER = '0199e3a1-0000-7000-8000-00000000000b';

/** A session no one joined, 9:05 to 9:55. */
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
/** Its day and its times, as the page says them in this computer's own words. */
const { day, times } = sessionWhen({
  startedAt: report.startedAt ?? '',
  endsAt: report.endsAt ?? '',
  endedAt: report.endedAt ?? null,
});
const DOWN: [number, unknown] = [503, { error: { code: 'unavailable', message: 'down' } }];

/** The page's own reads, answered at once; the class's roster one student who didn't join. */
const PAGE: Record<string, [number, unknown]> = {
  [REPORT]: [200, report],
  [EVENTS]: [200, { events: [], nextAfter: 0 }],
  [ROSTER]: [
    200,
    {
      students: [
        {
          enrollmentId: 'n-ana',
          studentId: 'u-ana',
          displayName: 'Ana Rodríguez',
          joinedAt: '2026-10-01T14:00:00.000Z',
        },
      ],
    },
  ],
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
/** The page's headings, in their order. */
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

describe('a session’s report, read as it opens (PV14; LO7)', () => {
  it('heads the recap with its class, as the shell’s one read of the account names it, over the day and the times, and reads its report, moments and roster alone', async () => {
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
    const name = screen.getByRole('heading', { level: 1, name: 'Biology, period 3' });
    expect(name.nextElementSibling?.textContent).toBe(`${day}${times}`);
    // This class's reports at the head's end: Reports with the class picked, the way back.
    const back = screen.getByRole('link', { name: "This class's reports" });
    expect(back.getAttribute('href')).toBe(`/reports?class=${CLASS}`);
    // The recap: nobody joined this one, and who didn't is the class's roster.
    expect(
      screen.getByRole('heading', { level: 2, name: 'Nobody joined this session.' }),
    ).toBeTruthy();
    expect(screen.getByText("Didn't join: Ana Rodríguez")).toBeTruthy();
    // Besides the shell's two reads and the count of its opening (A3b): no read of its own but
    // these, none of the class's for its name, and no questions.
    expect(new Set(bali.calls.map((c) => c.path))).toEqual(
      new Set(['/v1/me/age-check', '/v1/me', '/v1/me/actions', REPORT, EVENTS, ROSTER]),
    );
    expect([REPORT, QUESTIONS].map(asked)).toEqual([1, 0]);
  });

  it('holds the name’s place while the account lists no such class, and its line’s while it reads', async () => {
    bali.reply = () => null;
    open();
    await settle();
    const name = screen.getByRole('heading', { level: 1 });
    expect(name.textContent).toBe('…');
    expect(name.className).toMatch(/\btext-text-tertiary\b/);
    expect(name.nextElementSibling?.textContent).toBe(String.fromCharCode(160));
    expect(screen.getByRole('status').textContent).toBe('Loading this session…');
    expect(screen.getByRole('link', { name: "This class's reports" }).getAttribute('href')).toBe(
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
    expect(screen.getByRole('heading', { name: 'Nobody joined this session.' })).toBeTruthy();
  });

  it('holds Try again while it reads it all again, its line kept, never Loading…; read, focus on the class’s name (ClassEndedStates)', async () => {
    bali.reply = (path) => (path === REPORT ? DOWN : (PAGE[path] ?? null));
    const user = userEvent.setup();
    open();
    await settle();
    const line = screen.getByRole('alert');
    expect(line.textContent).toMatch(/^Couldn't load this session\. /);
    bali.reply = (path) => (path === REPORT ? null : (PAGE[path] ?? null));
    const again = screen.getByRole('button', { name: 'Try again' });
    await user.click(again);
    await settle();
    // On its way: the failure said, Try again held where it is with focus on it.
    expect(screen.getByRole('alert')).toBe(line);
    expect(screen.queryByText('Loading this session…')).toBeNull();
    expect(again.getAttribute('aria-busy')).toBe('true');
    expect(again.getAttribute('aria-disabled')).toBe('true');
    expect(document.activeElement).toBe(again);
    await answer(REPORT, 200, report);
    expect([REPORT, EVENTS, ROSTER].map(asked)).toEqual([2, 2, 2]);
    // Read: focus lands on the class's name, the page's heading, a frame after the page is drawn.
    await act(() => new Promise((done) => setTimeout(done, 32)));
    expect(document.activeElement).toBe(screen.getByRole('heading', { level: 1 }));
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('reads nothing for a tab with no sign-in, sending it to sign in', async () => {
    bali.token = null;
    open();
    await settle();
    expect(bali.calls).toEqual([]);
    expect(bali.router.replace).toHaveBeenCalledWith('/login');
  });
});

describe('a session’s report, lessons on or off (LO1, LO7)', () => {
  for (const lessons of ['on', 'off']) {
    it(`reads no questions and shows no Questions card with lessons ${lessons}, its Try again too`, async () => {
      vi.stubEnv('NEXT_PUBLIC_LESSONS', lessons);
      bali.reply = (path) => (path === REPORT ? DOWN : (PAGE[path] ?? null));
      const user = userEvent.setup();
      open();
      await settle();
      bali.reply = (path) => PAGE[path] ?? null;
      await user.click(screen.getByRole('button', { name: 'Try again' }));
      await settle();
      expect([REPORT, QUESTIONS].map(asked)).toEqual([2, 0]);
      expect(titles()).toEqual(['…', 'Nobody joined this session.', 'Everyone else']);
      expect(screen.queryByRole('region', { name: 'Questions' })).toBeNull();
    });
  }
});

describe('its URL', () => {
  it('is a page for a class and a session each an id the API mints, else none', async () => {
    const page = await Route({ params: Promise.resolve({ classId: CLASS, sessionId: SESSION }) });
    expect(isValidElement(page) && page.type).toBe(SessionReportPage);
    expect(isValidElement(page) && page.props).toEqual({ classId: CLASS, sessionId: SESSION });
    for (const [classId, sessionId] of [
      ['..', SESSION],
      [CLASS, '..'],
      ['c1', SESSION],
      [CLASS, `${SESSION}/..`],
    ]) {
      notFound.mockClear();
      await expect(Route({ params: Promise.resolve({ classId, sessionId }) })).rejects.toThrow(
        'not found',
      );
      expect(notFound).toHaveBeenCalledOnce();
    }
  });
});
