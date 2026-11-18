// @vitest-environment jsdom
import type { MeResponse } from '@bali/shared';
import { act, cleanup, render, screen, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createApiClient } from '@/lib/api-client';

import { Shell, StudentBar } from './shell';

/*
 * The shell's frame as a teacher and a student meet it (the owner's decision of 2026-10-22: the
 * portal's tests drive the page), the account read by the shell through a stand-in `fetch`: a
 * teacher's pages under the top bar (LO2), named as the account names them, its Sign out the
 * shell's own, which signs out once; a student's under a top bar of their own since LO12 (StudentWeb's
 * frame, StudentWebStates, drawn first), Your classes and Help whichever way the lessons switch is
 * set. Converted from `shell.test.ts`'s read of the shell's source for its name and its menu (LO2),
 * and its rendered markup of the student's side menu (LO12).
 */
const bali = vi.hoisted(() => ({
  path: '/reports',
  me: null as MeResponse | null,
  router: { replace: vi.fn(), push: vi.fn() },
  endSession: vi.fn((): 'local' | 'ended' => 'local'),
  client: null as ReturnType<typeof import('@/lib/api-client').createApiClient> | null,
}));

vi.mock('next/navigation', () => ({
  usePathname: () => bali.path,
  useRouter: () => bali.router,
}));
vi.mock('@/lib/auth', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/auth')>()),
  getAccessToken: () => 'token',
  endSession: () => bali.endSession(),
}));
vi.mock('@/lib/use-api', () => ({ useApi: () => bali.client, useSignOut: () => () => undefined }));

/** The account `/v1/me` answers with: a teacher or a student, named or not. */
function account(role: 'teacher' | 'student', displayName: string | null): MeResponse {
  return { user: { id: 'u1', role, displayName }, classes: [], session: null, armed: false };
}

beforeEach(() => {
  bali.client = createApiClient({
    baseUrl: 'http://api',
    getToken: () => 'token',
    fetchImpl: (url) => {
      const path = (url as string).replace('http://api', '');
      if (path === '/v1/me/age-check') return Promise.resolve(Response.json({ passed: true }));
      if (path === '/v1/me') return Promise.resolve(Response.json(bali.me));
      return Promise.resolve(Response.json({}, { status: 404 }));
    },
  });
});
afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
  bali.router.replace.mockClear();
  bali.endSession.mockClear();
});

/** Every answer in, and drawn. */
const settle = () => act(() => new Promise((done) => setTimeout(done, 0)));

/** A signed-in page at `path` in the shell, as the root layout holds it, its account read. */
async function open(me: MeResponse, path = '/reports') {
  bali.me = me;
  bali.path = path;
  render(
    <Shell>
      <p>The page</p>
    </Shell>,
  );
  await settle();
  await settle();
}

/** Each link of the navigation named Main: what it says and where it goes. */
const links = () =>
  within(screen.getByRole('navigation', { name: 'Main' }))
    .getAllByRole('link')
    .map((link) => [link.textContent, link.getAttribute('href')]);

describe('the shell’s frame, by the account the shell reads', () => {
  it('puts a teacher’s page under the top bar, named as the account names them, and draws no side menu', async () => {
    await open(account('teacher', '  Ms. Rivera '));
    const banner = screen.getByRole('banner');
    expect(within(banner).getByRole('link', { name: 'Bali, your classes' })).toBeTruthy();
    expect(links()).toEqual([
      ['Classes', '/'],
      ['Reports', '/reports'],
    ]);
    // Its name trimmed, as the menu named it.
    expect(within(banner).getByTitle('Ms. Rivera').textContent).toBe('Ms. Rivera');
    expect(within(banner).getByText('MR')).toBeTruthy();
    expect(screen.queryByRole('link', { name: 'Your classes' })).toBeNull();
    // The page in the shell's one `<main>`, under the bar.
    expect(screen.getByRole('main').textContent).toBe('The page');
  });

  it('puts a student’s page under their own top bar: Your classes, Help and the account, none of a teacher’s places (LO12)', async () => {
    await open(account('student', ' Ana Rodríguez '), '/');
    const banner = screen.getByRole('banner');
    expect(within(banner).getByRole('link', { name: 'Bali, your classes' })).toBeTruthy();
    expect(links()).toEqual([['Your classes', '/']]);
    expect(within(banner).getByRole('link', { name: 'Help' }).getAttribute('href')).toBe(
      '/support',
    );
    // Its name trimmed, as the teacher's bar names theirs.
    expect(within(banner).getByTitle('Ana Rodríguez').textContent).toBe('Ana Rodríguez');
    expect(within(banner).getByText('AR')).toBeTruthy();
    expect(screen.queryByRole('link', { name: /^(Classes|Reports|Questions|Slides)$/ })).toBeNull();
    // No class rides in it and no menu opens.
    expect(screen.queryByRole('link', { name: /is live\./ })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Menu' })).toBeNull();
    // The page in the shell's one `<main>`, under the bar.
    expect(screen.getByRole('main').textContent).toBe('The page');
  });

  it('signs a student out through their bar once: the tab goes to sign-in, and a second press sends nothing', async () => {
    const user = userEvent.setup();
    await open(account('student', 'Ana Rodríguez'), '/');
    const signOut = screen.getByRole('button', { name: 'Sign out' });
    await user.click(signOut);
    expect(bali.endSession).toHaveBeenCalledTimes(1);
    expect(bali.router.replace).toHaveBeenCalledWith('/login');
    expect(signOut.getAttribute('aria-disabled')).toBe('true');
    await user.click(signOut);
    expect(bali.endSession).toHaveBeenCalledTimes(1);
  });

  it('keeps the invite page under the bar for a student, as Invite draws it (W3)', async () => {
    await open(account('student', 'Ana Rodríguez'), '/invite');
    expect(screen.queryByRole('link', { name: 'Bali, your classes' })).toBeNull();
    expect(screen.queryByRole('navigation', { name: 'Main' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Sign out' }).textContent).toBe('Sign out');
  });

  it('signs a teacher out through the bar once: the tab goes to sign-in, and a second press sends nothing', async () => {
    const user = userEvent.setup();
    await open(account('teacher', 'Ms. Rivera'));
    const signOut = screen.getByRole('button', { name: 'Sign out' });
    await user.click(signOut);
    expect(bali.endSession).toHaveBeenCalledTimes(1);
    expect(bali.router.replace).toHaveBeenCalledWith('/login');
    expect(signOut.getAttribute('aria-disabled')).toBe('true');
    await user.click(signOut);
    expect(bali.endSession).toHaveBeenCalledTimes(1);
  });

  it('with no name on the account, says Sign out in words, then Signing out… once pressed', async () => {
    const user = userEvent.setup();
    await open(account('teacher', null));
    const banner = screen.getByRole('banner');
    expect(within(banner).queryByText('MR')).toBeNull();
    const [words] = within(banner).getAllByRole('button', { name: 'Sign out' });
    await user.click(words);
    expect(bali.endSession).toHaveBeenCalledTimes(1);
    expect(words.textContent).toBe('Signing out…');
  });
});

/** The student's bar on `path`, as the shell draws it; `again` draws it anew with what changed. */
function studentBar(over: Partial<Parameters<typeof StudentBar>[0]> = {}) {
  const props: Parameters<typeof StudentBar>[0] = {
    path: '/',
    name: 'Ana Rodríguez',
    leaving: false,
    onSignOut: vi.fn(),
    ...over,
  };
  const view = render(<StudentBar {...props} />);
  const again = (more: Partial<Parameters<typeof StudentBar>[0]>) => {
    Object.assign(props, more);
    view.rerender(<StudentBar {...props} />);
  };
  return { props, again };
}

describe('a student’s top bar (StudentWeb’s frame; StudentWebStates, LO12)', () => {
  it('gives a student Your classes and Help whichever way the lessons switch is set (LO1)', () => {
    for (const said of ['on', 'off']) {
      vi.stubEnv('NEXT_PUBLIC_LESSONS', said);
      studentBar();
      expect(links(), said).toEqual([['Your classes', '/']]);
      expect(screen.getByRole('link', { name: 'Help' }).getAttribute('href')).toBe('/support');
      cleanup();
    }
  });

  it('marks Your classes on the home and on a lesson’s page under it, never on a page merely named alike', () => {
    const { again } = studentBar();
    const marked = (path: string) => {
      again({ path });
      return screen.getByRole('link', { name: 'Your classes' }).getAttribute('aria-current');
    };
    expect(marked('/')).toBe('page');
    expect(marked('/lessons/c1/s1')).toBe('page');
    for (const path of ['/lessonsx', '/lessons', '/invite', '/no-such-page']) {
      expect(marked(path), path).toBeNull();
    }
  });

  it('names the account by its initials and its name, whole on hover, and Sign out an icon that signs out', async () => {
    const user = userEvent.setup();
    const { props } = studentBar();
    expect(screen.getByText('AR').getAttribute('aria-hidden')).toBe('true');
    expect(screen.getByTitle('Ana Rodríguez').textContent).toBe('Ana Rodríguez');
    const signOut = screen.getByRole('button', { name: 'Sign out' });
    expect(signOut.textContent).toBe('');
    expect(signOut.getAttribute('aria-disabled')).toBe('false');
    await user.click(signOut);
    expect(props.onSignOut).toHaveBeenCalledTimes(1);
  });

  it('holds Sign out while it signs out (StudentWebStates)', () => {
    studentBar({ leaving: true });
    expect(screen.getByRole('button', { name: 'Sign out' }).getAttribute('aria-disabled')).toBe(
      'true',
    );
  });

  it('with no name, says Sign out in words, with no initials, an icon on a phone, and Signing out… while it signs out', async () => {
    const user = userEvent.setup();
    const { props, again } = studentBar({ name: null });
    expect(screen.queryByText('AR')).toBeNull();
    // In words on a computer, an icon on a phone: each the shell's one Sign out.
    const [words, icon] = screen.getAllByRole('button', { name: 'Sign out' });
    expect(words.textContent).toBe('Sign out');
    expect(icon.textContent).toBe('');
    // One of the two at every width, so Sign out is never out of sight: the words from 760 px up,
    // the icon under it, two queries that meet without a gap.
    expect(words.className.split(' ')).toContain('max-[760px]:hidden');
    expect(icon.className.split(' ')).toContain('min-[760px]:hidden');
    expect(icon.className.split(' ')).not.toContain('max-[760px]:hidden');
    expect(words.className.split(' ')).not.toContain('min-[760px]:hidden');
    await user.click(words);
    await user.click(icon);
    expect(props.onSignOut).toHaveBeenCalledTimes(2);
    again({ leaving: true });
    const held = screen.getByRole('button', { name: 'Signing out…' });
    expect(held.getAttribute('aria-disabled')).toBe('true');
  });
});
