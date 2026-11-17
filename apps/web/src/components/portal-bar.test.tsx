// @vitest-environment jsdom
import type { SessionSnapshot } from '@bali/shared';
import { act, cleanup, render, screen, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { TaughtClass } from '../lib/classes';
import type { Students } from '../lib/grid-state';
import type { GridNow } from './live-grid';
import { LiveStripView, TopBar } from './portal-bar';

/*
 * A teacher's top bar (LO2; the lock-only canvas's Main, Reports and PhonePages, and BarStates for
 * what they don't draw), as a teacher meets it (the owner's decision of 2026-10-22: the portal's
 * tests drive the page): its places and the page it marks, never Questions or Slides whichever way
 * the lessons switch is set; the account and its Sign out; the phone's menu; and the live class it
 * carries on every other page, its session read as Home's live card reads it (`LiveGrid`), Bali's
 * answers held by the test.
 */
const bali = vi.hoisted(() => {
  /** The snapshot each session's read answers with; one missing is held for the test. */
  const snapshots = new Map<string, unknown>();
  /** The reads held, by path, for the test to answer. */
  const held = new Map<string, (body: unknown) => void>();
  return {
    snapshots,
    held,
    // One client and one sign-out for the page's life, as the portal's own hooks keep them.
    api: {
      get: (path: string) =>
        new Promise((resolve) => {
          const id = path.replace('/v1/sessions/', '');
          if (snapshots.has(id)) resolve(snapshots.get(id));
          else held.set(path, resolve);
        }),
    },
    signOut: () => undefined,
  };
});

vi.mock('@/lib/use-api', () => ({ useApi: () => bali.api, useSignOut: () => bali.signOut }));
// The live feed, open and quiet: no network.
vi.mock('@/lib/sse-client', () => ({
  createSseClient: (opts: { onStatus?: (status: string) => void }) => {
    opts.onStatus?.('open');
    return { close: () => undefined };
  },
}));

const NOW = Date.now();
const iso = (ms: number) => new Date(ms).toISOString();

/** A class of the teacher's, its session running until `endsIn` ms from now, or none. */
function klass(n: number, name: string, endsIn: number | null): TaughtClass {
  return {
    id: `c${n}`,
    name,
    teacher: { displayName: 'Ms. Rivera' },
    enrollmentId: null,
    liveSession: null,
    summary: {
      studentCount: 24,
      runningSession: endsIn === null ? null : { id: `s${n}`, endsAt: iso(NOW + endsIn) },
      lastSession: null,
    },
  };
}
const BIOLOGY = klass(1, 'Biology, period 3', null);
const AP = klass(4, 'Period 6 AP Biology', (34 * 60 + 10) * 1000);
const BIOLOGY_LIVE = klass(1, 'Biology, period 3', (23 * 60 + 4) * 1000);

/** A session's snapshot: `focused` of `count` students in focus, the rest not here. */
function snapshot(n: number, count: number, focused: number, ended = false): SessionSnapshot {
  // Its bell the account's, as the class's own (`klass`): none added since.
  const runs = [BIOLOGY_LIVE, AP].find((c) => c.id === `c${n}`)?.summary?.runningSession;
  return {
    session: {
      id: `s${n}`,
      classId: `c${n}`,
      startedAt: iso(NOW - 16 * 60_000),
      endsAt: runs?.endsAt ?? iso(NOW),
    },
    ended,
    latestSeq: 1,
    settledSeq: 1,
    students: Array.from({ length: count }, (_, i) => ({
      enrollmentId: `e${i}`,
      studentId: `u${i}`,
      displayName: `Student ${i}`,
      state: i < focused ? 'focused' : null,
      joinedAt: i < focused ? iso(NOW - 15 * 60_000) : null,
      lastSeenAt: i < focused ? iso(NOW) : null,
      endedAt: null,
      unlock: null,
      clockOff: false,
    })),
  } as SessionSnapshot;
}

beforeEach(() => {
  bali.snapshots.clear();
  bali.held.clear();
});
afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
});

/** Every answer in, and drawn. */
const settle = () => act(() => new Promise((done) => setTimeout(done, 0)));

/** The bar on `path`, as the shell draws it; `again` draws it anew with what changed. */
function bar(over: Partial<Parameters<typeof TopBar>[0]> = {}) {
  const props: Parameters<typeof TopBar>[0] = {
    path: '/reports',
    name: 'Ms. Rivera',
    classes: [BIOLOGY, AP],
    leaving: false,
    onSignOut: vi.fn(),
    refresh: vi.fn(() => Promise.resolve()),
    ...over,
  };
  const view = render(<TopBar {...props} />);
  const again = (more: Partial<Parameters<typeof TopBar>[0]>) => {
    Object.assign(props, more);
    view.rerender(<TopBar {...props} />);
  };
  return { props, again };
}

/** The places in the bar's own row: what each says, where it goes, and whether it is the page. */
const places = () =>
  within(screen.getByRole('navigation', { name: 'Main' }))
    .getAllByRole('link')
    .map((link) => [
      link.textContent,
      link.getAttribute('href'),
      link.getAttribute('aria-current'),
    ]);
/** The live class the bar carries, by its link's words, or null. */
const riding = () => screen.queryByRole('link', { name: /is live\./ });

describe('the top bar’s places (Main, Reports)', () => {
  it('links Bali home, Classes, Reports and Help, never Questions or Slides whichever way the lessons switch is set', () => {
    for (const said of ['on', 'off']) {
      vi.stubEnv('NEXT_PUBLIC_LESSONS', said);
      bar({ classes: [] });
      expect(screen.getByRole('link', { name: 'Bali, your classes' }).getAttribute('href')).toBe(
        '/',
      );
      expect(places()).toEqual([
        ['Classes', '/', null],
        ['Reports', '/reports', 'page'],
      ]);
      expect(screen.getByRole('link', { name: 'Help' }).getAttribute('href')).toBe('/support');
      expect(screen.queryByRole('link', { name: /Questions|Slides/ }), said).toBeNull();
      cleanup();
    }
  });

  it('marks the page open by its aria-current: Classes on Home, Classes’ old page and a class’s; Reports on a session’s report', () => {
    const { again } = bar({ classes: [], path: '/' });
    const marked = (path: string) => {
      again({ path });
      return places()
        .filter(([, , current]) => current === 'page')
        .map(([label]) => label);
    };
    expect(marked('/')).toEqual(['Classes']);
    expect(marked('/classes')).toEqual(['Classes']);
    expect(marked('/classes/c1')).toEqual(['Classes']);
    expect(marked('/classes/c1/reports')).toEqual(['Classes']);
    expect(marked('/reports')).toEqual(['Reports']);
    expect(marked('/reports/c1/s1')).toEqual(['Reports']);
    // Nothing on a page it doesn't list, nor one merely named alike.
    for (const path of ['/questions', '/slides', '/classesx', '/reportsx']) {
      expect(marked(path), path).toEqual([]);
    }
  });
});

describe('the account in the bar', () => {
  it('names it by its initials and its name, whole on hover, and Sign out an icon that signs out', async () => {
    const user = userEvent.setup();
    const { props } = bar({ classes: [] });
    const banner = screen.getByRole('banner');
    expect(within(banner).getByText('MR').getAttribute('aria-hidden')).toBe('true');
    expect(within(banner).getByTitle('Ms. Rivera').textContent).toBe('Ms. Rivera');
    const signOut = screen.getByRole('button', { name: 'Sign out' });
    expect(signOut.getAttribute('aria-disabled')).toBe('false');
    await user.click(signOut);
    expect(props.onSignOut).toHaveBeenCalledTimes(1);
  });

  it('holds Sign out while it signs out (BarStates)', () => {
    bar({ classes: [], leaving: true });
    expect(screen.getByRole('button', { name: 'Sign out' }).getAttribute('aria-disabled')).toBe(
      'true',
    );
  });

  it('with no name, says Sign out in words, with no initials, and Signing out… while it signs out (BarStates)', async () => {
    const user = userEvent.setup();
    const { props, again } = bar({ classes: [], name: null });
    expect(screen.queryByText('MR')).toBeNull();
    // In words on a computer, an icon on a phone: each the shell's one Sign out.
    const [words, icon] = screen.getAllByRole('button', { name: 'Sign out' });
    expect(words.textContent).toBe('Sign out');
    expect(icon.textContent).toBe('');
    await user.click(words);
    await user.click(icon);
    expect(props.onSignOut).toHaveBeenCalledTimes(2);
    again({ leaving: true });
    const held = screen.getByRole('button', { name: 'Signing out…' });
    expect(held.getAttribute('aria-disabled')).toBe('true');
  });
});

describe('the phone’s menu (PhonePages, The menu, open)', () => {
  it('opens under the bar with the places, Help, the name and Sign out, and closes on Close the menu, on Escape and as a link is followed', async () => {
    const user = userEvent.setup();
    const { props, again } = bar({ classes: [] });
    const menu = screen.getByRole('button', { name: 'Menu' });
    expect(menu.getAttribute('aria-expanded')).toBe('false');
    const panel = document.getElementById(menu.getAttribute('aria-controls') ?? '');
    expect(panel?.hidden).toBe(true);

    await user.click(menu);
    expect(menu.getAttribute('aria-expanded')).toBe('true');
    expect(menu.getAttribute('aria-label')).toBe('Close the menu');
    expect(panel?.hidden).toBe(false);
    const open = within(panel as HTMLElement);
    expect(
      open.getAllByRole('link').map((l) => [l.textContent, l.getAttribute('aria-current')]),
    ).toEqual([
      ['Classes', null],
      ['Reports', 'page'],
      ['Help', null],
    ]);
    expect(open.getByText('Ms. Rivera')).toBeTruthy();
    await user.click(open.getByRole('button', { name: 'Sign out' }));
    expect(props.onSignOut).toHaveBeenCalledTimes(1);

    // Close the menu closes it.
    await user.click(menu);
    expect(panel?.hidden).toBe(true);
    // Escape too, focus back on the button.
    await user.click(menu);
    await user.tab();
    expect(panel?.contains(document.activeElement)).toBe(true);
    await user.keyboard('{Escape}');
    expect(panel?.hidden).toBe(true);
    expect(document.activeElement).toBe(menu);
    // And a link followed: the next page opens with it closed.
    await user.click(menu);
    again({ path: '/' });
    expect(panel?.hidden).toBe(true);
    expect(menu.getAttribute('aria-expanded')).toBe('false');
  });

  it('says Signing out… in the menu while it signs out, and Sign out alone with no name (BarStates)', async () => {
    const user = userEvent.setup();
    const { again } = bar({ classes: [], leaving: true });
    await user.click(screen.getByRole('button', { name: 'Menu' }));
    const held = screen.getByRole('button', { name: 'Signing out…' });
    expect(held.getAttribute('aria-disabled')).toBe('true');
    again({ leaving: false, name: null });
    const panel = document.getElementById(
      screen.getByRole('button', { name: 'Close the menu' }).getAttribute('aria-controls') ?? '',
    );
    const row = within(panel as HTMLElement).getByRole('button', {
      name: 'Sign out',
    }).parentElement;
    expect(row?.textContent).toBe('Sign out');
  });
});

describe('the live class in the bar (Reports, BarStates)', () => {
  const NAMED =
    /^Period 6 AP Biology is live\. (?:33|34):\d\d left, 22 of 24 focused\. Open the class\.$/;

  it('rides on another page once its session is read: its name, the time left and how many are focused, a link to it', async () => {
    bar();
    // Nothing until its session is read, so a class ended a moment ago never shows as live.
    await settle();
    expect(riding()).toBeNull();
    const answer = bali.held.get('/v1/sessions/s4');
    act(() => answer?.(snapshot(4, 24, 22)));
    await settle();
    const link = riding();
    expect(link?.getAttribute('aria-label')).toMatch(NAMED);
    expect(link?.getAttribute('href')).toBe('/classes/c4');
    // The name whole on hover, cut to fit the bar.
    const name = within(link as HTMLElement).getByText('Period 6 AP Biology');
    expect(name.getAttribute('title')).toBe('Period 6 AP Biology');
    expect(link?.textContent).toMatch(/^Period 6 AP Biology(?:33|34):\d\d left22 of 24 focused$/);
  });

  it('rides on no page of Classes, nor on its own class’s, and on another class’s page', async () => {
    bali.snapshots.set('s4', snapshot(4, 24, 22));
    const { again } = bar({ path: '/' });
    for (const path of ['/', '/classes', '/classes/c4', '/classes/c4/reports']) {
      again({ path });
      await settle();
      expect(riding(), path).toBeNull();
    }
    for (const path of ['/classes/c1', '/reports/c1/s1', '/questions']) {
      again({ path });
      await settle();
      expect(riding()?.getAttribute('aria-label'), path).toMatch(NAMED);
    }
  });

  it('carries the first live in Your classes’ order, and on that class’s page the other', async () => {
    bali.snapshots.set('s1', snapshot(1, 28, 24));
    bali.snapshots.set('s4', snapshot(4, 24, 22));
    const { again } = bar({ classes: [BIOLOGY_LIVE, AP] });
    await settle();
    expect(riding()?.getAttribute('aria-label')).toMatch(
      /^Biology, period 3 is live\. 2[23]:\d\d left, 24 of 28 focused\. Open the class\.$/,
    );
    again({ path: '/classes/c1' });
    await settle();
    expect(riding()?.getAttribute('aria-label')).toMatch(NAMED);
  });

  it('leaves the bar once the server says its session is over, the next live class in its place', async () => {
    bali.snapshots.set('s1', snapshot(1, 28, 24, true));
    bali.snapshots.set('s4', snapshot(4, 24, 22));
    bar({ classes: [BIOLOGY_LIVE, AP] });
    await settle();
    await settle();
    expect(riding()?.getAttribute('aria-label')).toMatch(NAMED);
  });

  it('has the account read again after a class’s page, where a session starts or ends, once the next page’s reads have begun; never as other pages change', async () => {
    const { props, again } = bar({ classes: [], path: '/classes/c1' });
    await settle();
    expect(props.refresh).not.toHaveBeenCalled();
    again({ path: '/reports' });
    // Not yet: Home's and Classes' own reads, as they open, go first.
    expect(props.refresh).not.toHaveBeenCalled();
    await settle();
    expect(props.refresh).toHaveBeenCalledTimes(1);
    again({ path: '/reports/c1/s1' });
    again({ path: '/' });
    await settle();
    expect(props.refresh).toHaveBeenCalledTimes(1);
    again({ path: '/classes/c2' });
    again({ path: '/classes/c3' });
    await settle();
    expect(props.refresh).toHaveBeenCalledTimes(2);
  });
});

describe('the live class’s strip as its grid stands (BarStates)', () => {
  const BELL = iso(NOW + (34 * 60 + 10) * 1000);
  const STUDENTS: Students = {
    u1: {
      studentId: 'u1',
      displayName: 'Ethan Park',
      state: 'focused',
      joinedAt: new Date(NOW - 15 * 60_000),
      lastSeenAt: new Date(NOW),
      endedAt: null,
      unlock: null,
      clockOff: false,
    },
    u2: {
      studentId: 'u2',
      displayName: 'Zuri Mensah',
      state: null,
      joinedAt: null,
      lastSeenAt: null,
      endedAt: null,
      unlock: null,
      clockOff: false,
    },
  };
  const grid = (over: Partial<GridNow>): GridNow => ({
    students: STUDENTS,
    now: new Date(NOW),
    error: null,
    retry: vi.fn(),
    retrying: false,
    stale: null,
    ...over,
  });
  const strip = (g: GridNow, path = '/reports') =>
    render(
      <LiveStripView
        name="Period 6 AP Biology"
        href="/classes/c4"
        grid={g}
        startedAt={iso(NOW - 16 * 60_000)}
        bell={BELL}
        now={NOW}
        path={path}
      />,
    );

  it('says how many are focused while Bali can vouch for it, and only then', () => {
    strip(grid({}));
    expect(riding()?.getAttribute('aria-label')).toBe(
      'Period 6 AP Biology is live. 34:10 left, 1 of 2 focused. Open the class.',
    );
    cleanup();
    // Its feed reconnecting or gone quiet, or its read failed: the name and the time left alone.
    for (const g of [
      grid({ stale: { reason: 'reconnecting', secondsAgo: 40 } }),
      grid({ stale: { reason: 'stale', secondsAgo: 120 } }),
      grid({ students: null, error: 'Couldn’t reach Bali.' }),
    ]) {
      strip(g);
      expect(riding()?.getAttribute('aria-label')).toBe(
        'Period 6 AP Biology is live. 34:10 left. Open the class.',
      );
      expect(riding()?.textContent).toBe('Period 6 AP Biology34:10 left');
      cleanup();
    }
    // Before its first read: nothing at all.
    const { container } = strip(grid({ students: null }));
    expect(container.innerHTML).toBe('');
  });

  it('tries a read that failed again as the next page opens, and not before', () => {
    const failed = grid({ students: null, error: 'Couldn’t reach Bali.' });
    const { rerender } = strip(failed);
    expect(failed.retry).not.toHaveBeenCalled();
    rerender(
      <LiveStripView
        name="Period 6 AP Biology"
        href="/classes/c4"
        grid={failed}
        startedAt={null}
        bell={BELL}
        now={NOW}
        path="/reports/c1/s1"
      />,
    );
    expect(failed.retry).toHaveBeenCalledTimes(1);
  });
});
