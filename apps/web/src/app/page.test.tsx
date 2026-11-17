// @vitest-environment jsdom
import type { MeResponse } from '@bali/shared';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Me } from '@/components/shell';
import { type ApiClient, createApiClient } from '@/lib/api-client';
import type { TaughtClass } from '@/lib/classes';
import type { Home } from '@/lib/student-web';

import ClassesPage from './classes/page';
import InviteRoute from './invite/page';
import HomePage from './page';

/*
 * Where the home sends each account (PV15; a student to their own home since W3; a teacher to Home,
 * one page for their classes, since LO3), the invite page at `/invite` (W3), and Classes' old
 * address, which goes Home (LO3), as each opens (the owner's decision of 2026-10-22: the portal's
 * tests drive the page). The shell's read of the account is the test's, its reads counted; Bali's
 * answers come from a stand-in `fetch` under the portal's own client. Home's own parts are driven in
 * `components/home.test.tsx`.
 */

const nav = vi.hoisted(() => ({
  router: { replace: vi.fn(), push: vi.fn() },
  redirect: vi.fn((to: string): never => {
    throw new Error(`redirected to ${to}`);
  }),
}));
const shell = vi.hoisted((): { me: unknown } => ({ me: null }));
const bali = vi.hoisted(() => {
  const sent: string[] = [];
  /** Bali's answers: the block list, a redeem; every other read waits, as one on its way. */
  const fetch = (url: string | URL | Request, init?: RequestInit) => {
    const key = `${init?.method ?? 'GET'} ${(url as string).replace('http://api', '')}`;
    sent.push(key);
    if (key === 'GET /v1/blocks') return Promise.resolve(Response.json({ blocks: [] }));
    if (key === 'POST /v1/teacher-invites/redeem') return Promise.resolve(Response.json({}));
    return new Promise<Response>(() => undefined);
  };
  // One sign-out for every render, as the hook's memo keeps it: a live grid reads once as it opens.
  const signOut = () => undefined;
  return { sent, fetch, signOut, client: null as ApiClient | null };
});

vi.mock('next/navigation', () => ({
  useRouter: () => nav.router,
  redirect: nav.redirect,
}));
vi.mock('@/components/shell', () => ({ useMe: () => shell.me }));
vi.mock('@/lib/use-api', () => ({ useApi: () => bali.client, useSignOut: () => bali.signOut }));
vi.mock('@/lib/sse-client', () => ({ createSseClient: () => ({ close: () => undefined }) }));
vi.mock('@/lib/monitoring', () => ({ captureApiFailure: vi.fn() }));

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
  vi.useRealTimers();
  sessionStorage.clear();
  nav.router.replace.mockClear();
  bali.sent.length = 0;
});

const account = (role: 'teacher' | 'student', classes: TaughtClass[] = []): MeResponse => ({
  user: { id: 'u1', role, displayName: 'Ana Rodríguez' },
  classes,
  session: null,
  armed: false,
});

/** The shell's read of the account as `home`, with its reads counted. */
function readAs(home: Home | null) {
  const me: Me = {
    home,
    me: home === null || home.kind === 'invite' ? null : home.me,
    error: null,
    load: vi.fn(),
    refresh: vi.fn(() => Promise.resolve()),
  };
  shell.me = me;
  return me;
}

/** A page as it opens for an account the shell read as `home`, in the shell's one `<main>`. */
function open(home: Home | null, page: ReactNode = <HomePage />) {
  const me = readAs(home);
  const view = render(<main>{page}</main>);
  return { ...view, me };
}

const STUDENTS_LINE =
  'Here as a student? Set up Bali in the app on your iPhone first, then refresh this page.';

describe('the home sends each account where it belongs (PV15; decision 13)', () => {
  it('sends a tab with no sign-in to sign in, and reads nothing', () => {
    sessionStorage.clear();
    const { me } = open(null);
    expect(nav.router.replace).toHaveBeenCalledWith('/login');
    expect(me.load).not.toHaveBeenCalled();
  });

  it('reads the account as it opens, and draws nothing of its own before it is read', () => {
    const { container, me } = open(null);
    expect(me.load).toHaveBeenCalledOnce();
    expect(container.querySelector('main')?.innerHTML).toBe('');
  });

  it('a teacher: Home, one page for their classes, headed by Classes, no invite card (LO3)', () => {
    const { container } = open({ kind: 'teacher', me: account('teacher') });
    expect(screen.getByRole('heading', { level: 1, name: 'Classes' })).toBeDefined();
    // One page heading, and no `<main>` of its own: the shell's is the page's one.
    expect(container.querySelectorAll('h1')).toHaveLength(1);
    expect(container.querySelectorAll('main')).toHaveLength(1);
    expect(screen.queryByText('Enter your invite code')).toBeNull();
  });

  it('an account the 13+ check never passed: the invite card, the line for students under it', () => {
    open({ kind: 'invite' });
    expect(screen.getByRole('heading', { level: 1, name: 'Enter your invite code' })).toBeDefined();
    expect(screen.getByText(STUDENTS_LINE)).toBeDefined();
    expect(screen.queryByRole('heading', { name: 'Classes' })).toBeNull();
  });

  it('a student who said 13+ in the app: their own home, never the invite card (W3)', () => {
    open({ kind: 'student', me: account('student') });
    expect(screen.getByRole('heading', { level: 1, name: 'Your classes' })).toBeDefined();
    expect(screen.getByRole('link', { name: 'Enter your invite code' }).getAttribute('href')).toBe(
      '/invite',
    );
    expect(screen.queryByText(STUDENTS_LINE)).toBeNull();
  });

  it('after a redeem, reads the account afresh and, once it teaches, gives Home’s heading focus', async () => {
    const user = userEvent.setup();
    const { me, rerender } = open({ kind: 'invite' });
    await user.type(
      screen.getByRole('textbox', { name: 'Invite code' }),
      'ABCDEFGHJKMNPQRSTUVWXYZ23{Enter}',
    );
    await vi.waitFor(() => expect(me.load).toHaveBeenCalledWith(true));
    readAs({ kind: 'teacher', me: account('teacher') });
    rerender(
      <main>
        <HomePage />
      </main>,
    );
    expect(document.activeElement).toBe(screen.getByRole('heading', { level: 1, name: 'Classes' }));
  });
});

describe('a teacher’s Home, as the page runs it (LO3)', () => {
  const T = new Date(2026, 9, 12, 9, 31, 56).getTime();
  const live = (endsAt: number): TaughtClass => ({
    id: 'c3',
    name: 'Biology, period 3',
    teacher: { displayName: 'Ana Rodríguez' },
    enrollmentId: null,
    liveSession: null,
    summary: {
      studentCount: 28,
      runningSession: { id: 'S', endsAt: new Date(endsAt).toISOString() },
      lastSession: null,
    },
  });
  /** The class's row in Your classes: Open while it runs, Start… once it doesn't. */
  const action = () =>
    screen.getAllByRole('row')[1]?.querySelector('td:last-child a')?.textContent ?? null;

  it('reads the account again just after a live class’s bell, once a bell', async () => {
    vi.useFakeTimers({ now: T });
    const { me } = open({ kind: 'teacher', me: account('teacher', [live(T + 10_000)]) });
    expect(me.load).toHaveBeenCalledOnce();
    await act(() => vi.advanceTimersByTimeAsync(12_900));
    expect(me.load).toHaveBeenCalledOnce();
    await act(() => vi.advanceTimersByTimeAsync(200));
    expect(me.load).toHaveBeenCalledTimes(2);
    await act(() => vi.advanceTimersByTimeAsync(60_000));
    expect(me.load).toHaveBeenCalledTimes(2);
  });

  it('lets a class’s row go live to Start… at its bell by this computer’s clock, and turns the date at midnight', async () => {
    const late = new Date(2026, 9, 12, 23, 59, 58).getTime();
    vi.useFakeTimers({ now: late });
    open({ kind: 'teacher', me: account('teacher', [live(late + 1000)]) });
    const date = () => screen.getByRole('heading', { level: 1 }).nextElementSibling?.textContent;
    expect(date()).toMatch(/^Monday, October 12$/);
    expect(action()).toBe('Open');
    await act(() => vi.advanceTimersByTimeAsync(1100));
    expect(action()).toBe('Start…');
    expect(date()).toMatch(/^Monday, October 12$/);
    await act(() => vi.advanceTimersByTimeAsync(1000));
    expect(date()).toMatch(/^Tuesday, October 13$/);
  });

  it('dates each answer as it lands: a read after a timer slept moves the clock on with it', () => {
    vi.useFakeTimers({ now: T });
    const { rerender } = open({ kind: 'teacher', me: account('teacher', [live(T + 60_000)]) });
    expect(action()).toBe('Open');
    // Asleep two minutes, its tab in view all along: no timer ran, no visibilitychange came.
    vi.setSystemTime(T + 120_000);
    readAs({ kind: 'teacher', me: account('teacher', [live(T + 60_000)]) });
    rerender(
      <main>
        <HomePage />
      </main>,
    );
    expect(action()).toBe('Start…');
  });

  it('reads the clock afresh as its tab comes back into view, a timer having slept with the computer', () => {
    vi.useFakeTimers({ now: T });
    open({ kind: 'teacher', me: account('teacher', [live(T + 60_000)]) });
    expect(action()).toBe('Open');
    // Asleep two minutes: no timer ran, the clock moved on.
    vi.setSystemTime(T + 120_000);
    act(() => {
      fireEvent(document, new Event('visibilitychange'));
    });
    expect(action()).toBe('Start…');
  });
});

describe('the invite page at /invite, where a student’s home sends a teacher who set up the app first (W3)', () => {
  it('a student who said 13+ in the app: the invite card, never told to set up the app again', () => {
    open({ kind: 'student', me: account('student') }, <InviteRoute />);
    expect(screen.getByRole('heading', { level: 1, name: 'Enter your invite code' })).toBeDefined();
    expect(screen.queryByText(STUDENTS_LINE)).toBeNull();
  });

  it('an account the 13+ check never passed: the page Home shows it, its line for students under it', () => {
    // The same markup, but for the ids React mints per tree.
    const ids = (html: string) => html.replace(/_r_\w+_/g, 'id');
    const route = open({ kind: 'invite' }, <InviteRoute />);
    expect(screen.getByText(STUDENTS_LINE)).toBeDefined();
    const there = ids(route.container.innerHTML);
    cleanup();
    const home = open({ kind: 'invite' });
    expect(ids(home.container.innerHTML)).toBe(there);
  });

  it('draws nothing before the account is read, nor for a teacher, whom it sends home', () => {
    const before = open(null, <InviteRoute />);
    expect(before.container.querySelector('main')?.innerHTML).toBe('');
    cleanup();
    const teacher = open({ kind: 'teacher', me: account('teacher') }, <InviteRoute />);
    expect(teacher.container.querySelector('main')?.innerHTML).toBe('');
    expect(nav.router.replace).toHaveBeenCalledWith('/');
  });

  it('reads the account afresh after a redeem there, as Home does', async () => {
    const user = userEvent.setup();
    const { me } = open({ kind: 'student', me: account('student') }, <InviteRoute />);
    await user.type(
      screen.getByRole('textbox', { name: 'Invite code' }),
      'ABCDEFGHJKMNPQRSTUVWXYZ23{Enter}',
    );
    await vi.waitFor(() => expect(me.load).toHaveBeenCalledWith(true));
    expect(bali.sent).toContain('POST /v1/teacher-invites/redeem');
  });
});

describe('Classes’ old address (LO3)', () => {
  it('goes Home, from the server, before any of its page is drawn or read', () => {
    expect(() => ClassesPage()).toThrow('redirected to /');
    expect(nav.redirect).toHaveBeenCalledWith('/');
  });
});
