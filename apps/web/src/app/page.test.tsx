// @vitest-environment jsdom
import type { MeResponse } from '@bali/shared';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Me } from '@/components/shell';
import { type ApiClient, createApiClient } from '@/lib/api-client';
import type { TaughtClass } from '@/lib/classes';
import { CANT_REACH } from '@/lib/errors';
import type { Home } from '@/lib/student-web';

import ClassesPage from './classes/page';
import InviteRoute from './invite/page';
import HomePage from './page';

/*
 * Where the home sends each account (PV15; a student to their own home since W3 while the student
 * web is on, and to the page saying the web is for teachers with it off, LO15; a teacher to Home,
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
    if (key === 'POST /v1/classes') {
      const made = { id: 'c4', name: 'Period 4 Biology', joinCode: 'Q5FU3U', liveSessionId: null };
      return Promise.resolve(Response.json({ ...made, createdAt: '2026-10-12T14:00:00.000Z' }));
    }
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
  vi.unstubAllEnvs();
  sessionStorage.clear();
  nav.router.replace.mockClear();
  bali.sent.length = 0;
});

const account = (role: 'teacher' | 'student', classes: MeResponse['classes'] = []): MeResponse => ({
  user: { id: 'u1', role, displayName: 'Ana Rodríguez' },
  classes,
  session: null,
  armed: false,
});

/** A class of the student's, in session now (W3's live card, were the student web on). */
const biology: MeResponse['classes'][number] = {
  id: 'c3',
  name: 'Biology, period 3',
  teacher: { displayName: 'Ms. Rivera' },
  enrollmentId: 'e3',
  liveSession: {
    id: 'S',
    startedAt: new Date(Date.now() - 600_000).toISOString(),
    endsAt: new Date(Date.now() + 1_800_000).toISOString(),
  },
};

/** The student web's switch (LO15), set as a deploy sets it: unset is off. */
const studentWeb = (said: 'on' | 'off') => vi.stubEnv('NEXT_PUBLIC_STUDENT_WEB', said);

/** The shell's read of the account as `home`, a later read's failure `error`, its reads counted. */
function readAs(home: Home | null, error: string | null = null) {
  const me: Me = {
    home,
    me: home === null || home.kind === 'invite' ? null : home.me,
    error,
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
/** The line with the student web off (LO15; InviteStudentWebOff): the app, and no home promised. */
const STUDENTS_LINE_OFF =
  'Here as a student? Use Bali in the app on your phone. This site is for teachers.';
/** The page a student gets with the student web off (LO15; StudentWebOff). */
const OFF_TITLE = "You're signed in as a student";
const OFF_LINE = 'Use Bali in the app on your phone. This site is for teachers.';

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

  it('a teacher: Home, one page for their classes, headed by Classes, no invite card, whichever way the student web is set (LO3; LO15)', () => {
    for (const said of ['on', 'off'] as const) {
      studentWeb(said);
      const { container } = open({ kind: 'teacher', me: account('teacher') });
      expect(screen.getByRole('heading', { level: 1, name: 'Classes' }), said).toBeDefined();
      // One page heading, and no `<main>` of its own: the shell's is the page's one.
      expect(container.querySelectorAll('h1'), said).toHaveLength(1);
      expect(container.querySelectorAll('main'), said).toHaveLength(1);
      expect(screen.queryByText('Enter your invite code'), said).toBeNull();
      expect(screen.queryByText(OFF_TITLE), said).toBeNull();
      cleanup();
    }
  });

  it('an account the 13+ check never passed, the student web on: the invite card, the line for students under it', () => {
    studentWeb('on');
    open({ kind: 'invite' });
    expect(screen.getByRole('heading', { level: 1, name: 'Enter your invite code' })).toBeDefined();
    expect(screen.getByText(STUDENTS_LINE)).toBeDefined();
    expect(screen.queryByText(STUDENTS_LINE_OFF)).toBeNull();
    expect(screen.queryByRole('heading', { name: 'Classes' })).toBeNull();
  });

  it('an account the 13+ check never passed, the student web off: the invite card, its line sending students to the app with no home promised after a refresh (LO15)', () => {
    // Unset, as a deploy that sets nothing has it.
    open({ kind: 'invite' });
    expect(screen.getByRole('heading', { level: 1, name: 'Enter your invite code' })).toBeDefined();
    expect(screen.getByText(STUDENTS_LINE_OFF)).toBeDefined();
    expect(screen.queryByText(STUDENTS_LINE)).toBeNull();
    expect(screen.queryByText(OFF_TITLE)).toBeNull();
  });

  it('a student who said 13+ in the app, the student web on: their own home, never the invite card (W3)', () => {
    studentWeb('on');
    open({ kind: 'student', me: account('student') });
    expect(screen.getByRole('heading', { level: 1, name: 'Your classes' })).toBeDefined();
    expect(screen.getByRole('link', { name: 'Enter your invite code' }).getAttribute('href')).toBe(
      '/invite',
    );
    expect(screen.queryByText(STUDENTS_LINE)).toBeNull();
    expect(screen.queryByText(OFF_TITLE)).toBeNull();
  });

  it('a student who said 13+ in the app, the student web off: one page saying the web is for teachers, nothing of theirs on it, nothing read for it, never read again (LO15)', async () => {
    vi.useFakeTimers();
    for (const said of [undefined, 'off', 'OFF ', 'no']) {
      vi.stubEnv('NEXT_PUBLIC_STUDENT_WEB', said);
      const { container, me } = open({ kind: 'student', me: account('student', [biology]) });
      const title = screen.getByRole('heading', { level: 1, name: OFF_TITLE });
      expect(container.querySelectorAll('h1'), said).toHaveLength(1);
      expect(title.nextElementSibling?.textContent, said).toBe(OFF_LINE);
      // Nothing of theirs: no class, no teacher, no phone, no home of theirs, no invite card.
      for (const theirs of ['Biology, period 3', 'Ms. Rivera', 'Your phone', 'Your classes']) {
        expect(screen.queryByText(theirs), `${said} ${theirs}`).toBeNull();
      }
      expect(screen.queryByRole('textbox'), said).toBeNull();
      // In a class, so no way to the invite page: a student in a class can't redeem a code.
      expect(screen.queryByRole('link'), said).toBeNull();
      // The account the shell reads as the page opens, as Home's every page does; nothing else, then
      // or later: no class's read, no 30 s read, none as the tab comes back.
      expect(me.load, said).toHaveBeenCalledOnce();
      await act(() => vi.advanceTimersByTimeAsync(5 * 60_000));
      act(() => {
        fireEvent(document, new Event('visibilitychange'));
      });
      expect(me.load, said).toHaveBeenCalledOnce();
      expect(me.refresh, said).not.toHaveBeenCalled();
      expect(bali.sent, said).toEqual([]);
      cleanup();
    }
  });

  it('a student in no class yet, the student web off: the same page, and a teacher who set up the app first keeps the way to the invite page (LO15; decision 13)', () => {
    open({ kind: 'student', me: account('student') });
    expect(screen.getByRole('heading', { level: 1, name: OFF_TITLE })).toBeDefined();
    const way = screen.getByRole('link', { name: 'Enter your invite code' });
    expect(way.getAttribute('href')).toBe('/invite');
    expect(way.parentElement?.textContent).toBe(
      'Setting up a teacher account? Enter your invite code',
    );
    expect(screen.queryByRole('heading', { name: 'Your classes' })).toBeNull();
    expect(screen.queryByText(STUDENTS_LINE_OFF)).toBeNull();
  });

  it('a student’s home reads the account through the shell: a later read’s failure said with its Try again, the shell’s refresh, and its tab back in view the shell’s load (LO12)', async () => {
    studentWeb('on');
    const user = userEvent.setup();
    const me = readAs({ kind: 'student', me: account('student') }, CANT_REACH);
    render(
      <main>
        <HomePage />
      </main>,
    );
    expect(me.load).toHaveBeenCalledOnce();
    expect(screen.getByRole('alert').textContent).toBe("Bali couldn't load your classes.");
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(me.refresh).toHaveBeenCalledOnce();
    act(() => {
      fireEvent(document, new Event('visibilitychange'));
    });
    expect(me.load).toHaveBeenCalledTimes(2);
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

  it('says the shell’s failed read of the account on Home, its Try again the shell’s own', async () => {
    const user = userEvent.setup();
    const me = readAs({ kind: 'teacher', me: account('teacher') }, CANT_REACH);
    render(
      <main>
        <HomePage />
      </main>,
    );
    expect(screen.getByRole('alert').textContent).toBe(CANT_REACH);
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(me.refresh).toHaveBeenCalledOnce();
  });

  it('reads the account again once New class answers, so a class just made is listed', async () => {
    // jsdom's `<dialog>` has no `showModal`: opened as the browser opens it, no more.
    HTMLDialogElement.prototype.showModal = function showModal(this: HTMLDialogElement) {
      this.setAttribute('open', '');
    };
    const user = userEvent.setup();
    const { me } = open({ kind: 'teacher', me: account('teacher') });
    expect(me.load).toHaveBeenCalledOnce();
    await user.click(screen.getByRole('button', { name: 'New class' }));
    await user.type(screen.getByRole('textbox', { name: 'Class name' }), 'Period 4 Biology{Enter}');
    await vi.waitFor(() => expect(me.load).toHaveBeenCalledTimes(2));
    expect(me.load).toHaveBeenLastCalledWith();
    expect(bali.sent).toContain('POST /v1/classes');
  });
});

describe('the invite page at /invite, where a student’s home sends a teacher who set up the app first (W3)', () => {
  it('a student who said 13+ in the app: the invite card, never told to set up the app again, whichever way the student web is set (LO15)', () => {
    for (const said of ['on', 'off'] as const) {
      studentWeb(said);
      open({ kind: 'student', me: account('student') }, <InviteRoute />);
      expect(
        screen.getByRole('heading', { level: 1, name: 'Enter your invite code' }),
        said,
      ).toBeDefined();
      expect(screen.queryByText(STUDENTS_LINE), said).toBeNull();
      expect(screen.queryByText(STUDENTS_LINE_OFF), said).toBeNull();
      expect(screen.queryByText(OFF_TITLE), said).toBeNull();
      cleanup();
    }
  });

  it('an account the 13+ check never passed: the page Home shows it, its line for students under it, whichever way the student web is set (LO15)', () => {
    // The same markup, but for the ids React mints per tree.
    const ids = (html: string) => html.replace(/_r_\w+_/g, 'id');
    for (const [said, line] of [
      ['on', STUDENTS_LINE],
      ['off', STUDENTS_LINE_OFF],
    ] as const) {
      studentWeb(said);
      const route = open({ kind: 'invite' }, <InviteRoute />);
      expect(screen.getByText(line), said).toBeDefined();
      // It reads nothing of its own: the account is the shell's one read.
      expect(bali.sent, said).toEqual([]);
      const there = ids(route.container.innerHTML);
      cleanup();
      const home = open({ kind: 'invite' });
      expect(ids(home.container.innerHTML), said).toBe(there);
      cleanup();
    }
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
