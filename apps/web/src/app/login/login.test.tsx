// @vitest-environment jsdom
import { cleanup, render, screen, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { endSession, startLogin } from '@/lib/auth';

import LoginPage from './page';

/*
 * Sign in, for teachers and students (the sign-in redesign's "The portal's sign-in page", the
 * owner, 2026-11-12), used as a person uses it (the owner, 2026-10-22): its words, Sign in starting
 * the sign-in, the line when AWS's page didn't open, and what a Sign out left behind
 * (PortalStates). `startLogin` is held here, since the real one leaves the page for Cognito's; the
 * rest of `@/lib/auth` is the portal's own, so a Sign out is remembered as the shell leaves it.
 */
vi.mock('@/lib/auth', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/auth')>()),
  startLogin: vi.fn(),
}));

afterEach(() => {
  cleanup();
  sessionStorage.clear();
  vi.clearAllMocks();
});

const COULDNT_OPEN = "Bali couldn't open the sign-in page. Try again.";

/** Whether `a` comes before `b` in the page, as a screen reader reads them. */
const before = (a: Node, b: Node) =>
  (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;

/** The card, as a screen reader offers it: a region named by its title. */
const card = () => screen.getByRole('region', { name: 'Sign in to Bali' });

describe('the sign-in page', () => {
  it('says the board’s words in its order: Bali and its line, the card, the line for students, the public pages', () => {
    render(<LoginPage />);
    expect(screen.getByRole('main').textContent).toBe(
      [
        'Bali',
        'Quiet until the bell.',
        'Sign in to Bali',
        'Teachers and students sign in here to see their classes.',
        'Sign in',
        'Students: set up Bali in the app on your iPhone first.',
        'Help and questions',
        'Privacy policy',
        'Terms',
      ].join(''),
    );
    expect(screen.getAllByRole('heading').map((h) => [h.tagName, h.textContent])).toEqual([
      ['H1', 'Sign in to Bali'],
    ]);
    // The card is a region a screen reader names by its title.
    expect(card().textContent).toBe(
      'Sign in to BaliTeachers and students sign in here to see their classes.Sign in',
    );
    // Sign in is its one button: no Sign up, by design (students sign up in the app).
    expect(screen.getAllByRole('button').map((b) => b.textContent)).toEqual(['Sign in']);
    const links = within(screen.getByRole('navigation', { name: 'Help and policies' }))
      .getAllByRole('link')
      .map((a) => [a.getAttribute('href'), a.textContent]);
    expect(links).toEqual([
      ['/support', 'Help and questions'],
      ['/privacy', 'Privacy policy'],
      ['/terms', 'Terms'],
    ]);
    // Nothing said until something happens.
    expect(screen.queryByRole('status')).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('draws the session ring as art: hidden from a screen reader, and never a countdown', () => {
    render(<LoginPage />);
    const art = screen.getByRole('main').querySelector('svg');
    expect(art?.getAttribute('aria-hidden')).toBe('true');
    // No numbers on the ring, so it never looks like a real session (the owner, 2026-11-12).
    expect(art?.textContent).toBe('');
    expect(screen.queryByRole('img')).toBeNull();
  });

  it('starts the sign-in at Sign in, clicked or pressed from the keyboard, its first stop', async () => {
    vi.mocked(startLogin).mockResolvedValue(undefined);
    const user = userEvent.setup();
    render(<LoginPage />);
    const signIn = screen.getByRole('button', { name: 'Sign in' });

    await user.click(signIn);
    expect(startLogin).toHaveBeenCalledTimes(1);

    signIn.blur();
    await user.tab();
    expect(document.activeElement).toBe(signIn);
    await user.keyboard('{Enter}');
    expect(startLogin).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('says so under Sign in when AWS’s page didn’t open, and Sign in tries again', async () => {
    vi.mocked(startLogin)
      .mockRejectedValueOnce(new Error('no Web Crypto here'))
      .mockResolvedValueOnce(undefined);
    const user = userEvent.setup();
    render(<LoginPage />);
    const signIn = screen.getByRole('button', { name: 'Sign in' });

    await user.click(signIn);
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toBe(COULDNT_OPEN);
    expect(before(signIn, alert)).toBe(true);
    // In the card with Sign in, so it reads as Sign in's.
    expect(card().contains(alert)).toBe(true);

    // Pressed again: the line goes as the sign-in starts again.
    await user.click(signIn);
    expect(startLogin).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it.each([
    {
      how: 'a Sign out that reached the sign-in page',
      leave: () => endSession('https://bali-dev.auth.example.com/logout', () => {}),
      said: "You're signed out.",
    },
    {
      how: 'a Sign out in this tab only',
      leave: () => endSession(null),
      said: "You're signed out of Bali in this tab, but the sign-in page may still remember you. Close the browser before someone else uses this computer.",
    },
  ])('after $how, says so over Sign in', ({ leave, said }) => {
    leave();
    render(<LoginPage />);
    const line = screen.getByRole('status');
    const signIn = screen.getByRole('button', { name: 'Sign in' });
    expect(line.textContent).toBe(said);
    expect(before(line, signIn)).toBe(true);
    expect(card().contains(line)).toBe(true);
  });
});
