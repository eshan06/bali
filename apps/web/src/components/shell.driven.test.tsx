// @vitest-environment jsdom
import type { MeResponse } from '@bali/shared';
import { act, cleanup, render, screen, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createApiClient } from '@/lib/api-client';

import { Shell, SideMenu } from './shell';

/*
 * The shell's frame as a teacher and a student meet it (the owner's decision of 2026-10-22: the
 * portal's tests drive the page), the account read by the shell through a stand-in `fetch`: a
 * teacher's pages under the top bar (LO2), named as the account names them, its Sign out the
 * shell's own, which signs out once; a student's beside the side menu, Your classes and Help
 * whichever way the lessons switch is set (LO1). Converted from `shell.test.ts`'s read of the
 * shell's source for its name and its menu (LO2).
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

  it('puts a student’s page beside the side menu, Your classes and Help, never the top bar', async () => {
    await open(account('student', 'Ana Rodríguez'), '/');
    expect(screen.queryByRole('banner')).toBeNull();
    expect(links()).toEqual([
      ['Bali', '/'],
      ['Your classes', '/'],
      ['Help', '/support'],
    ]);
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

describe('a student’s side menu and the lessons switch (LO1)', () => {
  it('gives a student Your classes and Help whichever way it is set', () => {
    for (const said of ['on', 'off']) {
      vi.stubEnv('NEXT_PUBLIC_LESSONS', said);
      render(
        <SideMenu path="/" name="Ana Rodríguez" leaving={false} onSignOut={() => undefined} />,
      );
      expect(links(), said).toEqual([
        ['Bali', '/'],
        ['Your classes', '/'],
        ['Help', '/support'],
      ]);
      cleanup();
    }
  });
});
