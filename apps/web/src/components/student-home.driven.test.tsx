// @vitest-environment jsdom
import type { MeResponse } from '@bali/shared';
import { act, cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createApiClient } from '@/lib/api-client';

import { StudentHome } from './student-home';

/*
 * A student's home with the lessons switch either way (LO1; ARCHITECTURE, Web portal, decision 8),
 * as a student meets it, StudentHome's sample data in it: Biology, period 3 in class now with
 * Ms. Rivera, and Chemistry, period 5 under Other classes. With lessons on, the page as W3 and W4
 * built it: the line on slides and questions under its title, and Open the lesson on the live card.
 * With lessons off there is no lesson to open: the title alone, and the live card keeps the class,
 * its time and the student's own phone, with no way into a lesson. The home's other tests, not
 * converted yet, are in `student-home.test.ts`.
 */
const bali = vi.hoisted(() => ({
  /** Every path the page asked Bali for; each read held, so the phone's chip says Checking…. */
  asked: [] as string[],
  client: null as ReturnType<typeof import('@/lib/api-client').createApiClient> | null,
}));
vi.mock('@/lib/use-api', () => ({ useApi: () => bali.client, useSignOut: () => () => undefined }));

const STARTED = '2026-10-12T14:05:00.000Z';
const BELL = '2026-10-12T14:55:00.000Z';
/** 23:04 before the bell, as StudentHome draws it. */
const NOW = Date.parse(BELL) - (23 * 60 + 4) * 1000;

type Class = MeResponse['classes'][number];
const BIOLOGY: Class = {
  id: 'bio',
  name: 'Biology, period 3',
  teacher: { displayName: 'Ms. Rivera' },
  enrollmentId: 'e-bio',
  liveSession: { id: 's-bio', startedAt: STARTED, endsAt: BELL },
};
const CHEMISTRY: Class = {
  id: 'chem',
  name: 'Chemistry, period 5',
  teacher: { displayName: 'Mr. Okafor' },
  enrollmentId: 'e-chem',
  liveSession: null,
};
const me = (...classes: Class[]): MeResponse => ({
  user: { id: 'u1', role: 'student', displayName: 'Ana Rodríguez' },
  classes,
  session: null,
  armed: false,
});

const LINE = "Your teacher's slides and questions show up here during class.";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllEnvs();
  bali.asked.length = 0;
});

/** The home as it first draws at NOW, Bali's reads held. */
function open(account: MeResponse) {
  vi.useFakeTimers({ now: NOW });
  bali.client = createApiClient({
    baseUrl: 'http://api',
    getToken: () => 'token',
    fetchImpl: (url) => {
      bali.asked.push((url as string).replace('http://api', ''));
      return new Promise<Response>(() => undefined);
    },
  });
  render(
    <StudentHome
      me={account}
      failed={false}
      onRead={() => undefined}
      onRefresh={() => Promise.resolve()}
    />,
  );
}

/** The live card: the section named by its class. */
const liveCard = () => screen.getByRole('region', { name: 'Biology, period 3' });
/** What the live card's phone chip says, each of its parts. */
const phone = () =>
  Array.from(within(liveCard()).getByRole('status').children, (part) => part.textContent);

describe('a student’s home with lessons on (StudentHome, as W3 and W4 built it)', () => {
  it('says the line on slides and questions under its title, and Open the lesson to the lesson’s page', () => {
    open(me(BIOLOGY, CHEMISTRY));
    const title = screen.getByRole('heading', { level: 1, name: 'Your classes' });
    expect(title.nextElementSibling?.textContent).toBe(LINE);
    const lesson = within(liveCard()).getByRole('link', { name: 'Open the lesson' });
    expect(lesson.getAttribute('href')).toBe('/lessons/bio/s-bio');
    expect(phone()).toEqual(['Your phone', 'Checking…']);
  });
});

describe('a student’s home with lessons off (LO1)', () => {
  it('says its title alone: no line on slides and questions', () => {
    vi.stubEnv('NEXT_PUBLIC_LESSONS', 'off');
    open(me(BIOLOGY, CHEMISTRY));
    const title = screen.getByRole('heading', { level: 1, name: 'Your classes' });
    expect(title.nextElementSibling).toBeNull();
    expect(screen.queryByText(LINE)).toBeNull();
  });

  it('keeps the class in session on its live card, its time and the student’s phone, with no way into a lesson', async () => {
    vi.stubEnv('NEXT_PUBLIC_LESSONS', 'off');
    open(me(BIOLOGY, CHEMISTRY));
    await act(() => vi.advanceTimersByTimeAsync(0));
    const card = liveCard();
    expect(card.textContent).toContain('Ms. Rivera · in class now');
    expect(card.textContent).toContain('23:04');
    // The phone's chip from the lesson's own read, Checking… until it answers, as before.
    expect(phone()).toEqual(['Your phone', 'Checking…']);
    expect(bali.asked).toEqual(['/v1/sessions/s-bio/presentation']);
    // Nothing to press on it: no Open the lesson, no link to the lesson's page anywhere.
    expect(within(card).queryAllByRole('link')).toEqual([]);
    expect(within(card).queryAllByRole('button')).toEqual([]);
    expect(document.querySelector('a[href^="/lessons/"]')).toBeNull();
    // The other classes and the way to join, as before.
    expect(screen.getByRole('heading', { name: 'Other classes' })).toBeTruthy();
    expect(screen.getByText('Chemistry, period 5')).toBeTruthy();
    expect(screen.getByText('To join a class, use the Bali app on your iPhone.')).toBeTruthy();
  });

  it('with no class yet, says so as before, with a teacher’s way to the invite page', () => {
    vi.stubEnv('NEXT_PUBLIC_LESSONS', 'off');
    open(me());
    expect(screen.getByRole('heading', { name: "You're not in a class yet" })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Enter your invite code' }).getAttribute('href')).toBe(
      '/invite',
    );
    expect(screen.queryByText(LINE)).toBeNull();
  });
});
