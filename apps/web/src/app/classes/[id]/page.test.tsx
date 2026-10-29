// @vitest-environment jsdom
import type { ClassDetail, RosterResponse, SessionSnapshot } from '@bali/shared';
import { cleanup, render, screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { type ApiClient, createApiClient } from '@/lib/api-client';
import { captureApiFailure } from '@/lib/monitoring';

import ClassDetailPage from './page';

/*
 * A class's page while its session runs, as a teacher meets it adding time (the owner's decision
 * of 2026-10-22: the portal's tests drive the page). Bali's answers come from a stand-in `fetch`
 * under the portal's own API client, so the refusal the page reads is the API's own body. A
 * session runs 16 hours at most in all (the owner, 2026-10-28): time that would run it past them
 * is refused (`409 session_too_long`) and nothing is recorded, so the page says so under its
 * controls, on the class page and in Present, in the words ClassStates draws for it (an
 * intermediate state, drawn there first), its bell where it was. No stream runs: the grid is its
 * snapshot.
 */

const bali = vi.hoisted(() => {
  const CLASS = '019a0000-0000-7000-8000-0000000000c1';
  const SESSION = '019a0000-0000-7000-8000-000000000005';
  const at = Date.now();
  // 15 h 35 min in and 25 minutes to its bell: 16 hours in all, so no more time fits.
  const startedAt = new Date(at - (15 * 60 + 35) * 60_000).toISOString();
  const endsAt = new Date(at + 25 * 60_000).toISOString();
  const klass: ClassDetail = {
    id: CLASS,
    name: 'Biology, period 3',
    joinCode: 'VMAF7E',
    createdAt: '2026-09-01T14:00:00.000Z',
    liveSessionId: SESSION,
  };
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
    session: { id: SESSION, classId: CLASS, startedAt, endsAt },
    ended: false,
    latestSeq: 4,
    students: [
      {
        enrollmentId: 'e-ana',
        studentId: 'u-ana',
        displayName: 'Ana Rodríguez',
        state: 'focused',
        joinedAt: startedAt,
        lastSeenAt: new Date(at - 10_000).toISOString(),
        endedAt: null,
        unlock: null,
        protectionOffAfterEnd: false,
      },
    ],
    question: null,
    presentation: null,
  };
  /** The API's own answer to an extend past the bound: its status and its body. */
  const tooLong = {
    error: {
      code: 'conflict',
      reason: 'session_too_long',
      message: 'a session runs at most 16 hours in all',
    },
  };
  /** Every request the page sent, in order, and any Bali has no answer for. */
  const sent: { method: string; path: string; body: unknown }[] = [];
  const unexpected: string[] = [];
  const answer = (method: string, path: string): [number, unknown] => {
    if (method === 'GET' && path === `/v1/classes/${CLASS}`) return [200, klass];
    if (method === 'GET' && path === `/v1/classes/${CLASS}/roster`) return [200, roster];
    if (method === 'GET' && path === `/v1/sessions/${SESSION}`) return [200, snapshot];
    if (method === 'POST' && path === `/v1/sessions/${SESSION}/extend`) return [409, tooLong];
    unexpected.push(`${method} ${path}`);
    return [404, { error: { code: 'not_found', message: 'not found' } }];
  };
  /** `fetch`, answered at once as Bali would answer it. */
  const fetch = (url: string | URL | Request, init?: RequestInit) =>
    Promise.resolve().then(() => {
      const method = init?.method ?? 'GET';
      const path = (url as string).replace('http://api', '');
      const body = typeof init?.body === 'string' ? (JSON.parse(init.body) as unknown) : null;
      sent.push({ method, path, body });
      const [status, json] = answer(method, path);
      return new Response(JSON.stringify(json), {
        status,
        headers: { 'content-type': 'application/json' },
      });
    });
  return {
    CLASS,
    SESSION,
    endsAt,
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
  useRouter: () => bali.router,
}));
vi.mock('@/lib/auth', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/auth')>()),
  getAccessToken: () => 'token',
}));
vi.mock('@/lib/use-api', () => ({ useApi: () => bali.client, useSignOut: () => bali.signOut }));
// No stream: the grid is its snapshot.
vi.mock('@/lib/sse-client', () => ({ createSseClient: () => ({ close: () => undefined }) }));
vi.mock('@/lib/monitoring', () => ({ captureApiFailure: vi.fn() }));

const UUID_V7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

/** What the page says under its controls for time past the bound, as ClassStates draws it. */
const PAST_16_HOURS =
  'A session runs 16 hours at most, so no time was added. It ends at the time shown.';

beforeEach(() => {
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
  sessionStorage.clear();
  bali.sent.length = 0;
  bali.unexpected.length = 0;
  vi.mocked(captureApiFailure).mockClear();
});

/** The extends the page sent, as the API took them. */
const extendsSent = () => bali.sent.filter(({ path }) => path.endsWith('/extend'));

/** An extend's body. */
interface Press {
  durationMinutes: number;
  eventId: string;
}

describe('a class live, time past 16 hours in all (the owner, 2026-10-28)', () => {
  for (const present of [false, true]) {
    it(`says it under the controls, nothing added, the bell where it was${present ? ', in Present' : ''}`, async () => {
      // Present as this tab left it on (DESIGN.md §5): the projector keeps +5, +10 and End.
      if (present) sessionStorage.setItem(`bali.present.${bali.CLASS}`, 'on');
      const user = userEvent.setup();
      render(<ClassDetailPage />);
      const plus5 = await screen.findByRole('button', { name: '+5 min' });
      // The grid has read its snapshot: the bell is the session's.
      await screen.findByText('Ana Rodríguez');
      const bell = () => document.querySelector(`time[datetime="${bali.endsAt}"]`);
      expect(bell()).not.toBeNull();

      await user.click(plus5);

      const said = await screen.findByText(PAST_16_HOURS);
      expect(said.getAttribute('role')).toBe('alert');
      expect(screen.getAllByRole('alert').map((line) => line.textContent)).toEqual([PAST_16_HOURS]);
      // Refused, so final: no Try again, and every control free again for the next press.
      expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull();
      for (const name of ['+5 min', '+10 min', 'End session']) {
        expect(screen.getByRole('button', { name }).getAttribute('aria-disabled'), name).toBe(
          'false',
        );
      }
      // The bell did not move. The press went once, as the API takes it.
      expect(bell()).not.toBeNull();
      expect(extendsSent().map(({ method, path }) => `${method} ${path}`)).toEqual([
        `POST /v1/sessions/${bali.SESSION}/extend`,
      ]);
      const pressed = () => extendsSent().map(({ body }) => body as Press);
      expect(pressed()[0]?.durationMinutes).toBe(5);
      expect(pressed()[0]?.eventId).toMatch(UUID_V7);

      // The next press is a new one, under an id of its own, and is said the same way.
      await user.click(screen.getByRole('button', { name: '+10 min' }));
      await vi.waitFor(() => expect(extendsSent()).toHaveLength(2));
      const [first, second] = pressed();
      expect(second?.durationMinutes).toBe(10);
      expect(second?.eventId).toMatch(UUID_V7);
      expect(second?.eventId).not.toBe(first?.eventId);
      expect((await screen.findByText(PAST_16_HOURS)).getAttribute('role')).toBe('alert');
      expect(bell()).not.toBeNull();

      // A refusal is the screen's to explain, never a failure to report, and Bali was asked
      // nothing it has no answer for.
      expect(captureApiFailure).not.toHaveBeenCalled();
      expect(bali.unexpected).toEqual([]);
    });
  }
});
