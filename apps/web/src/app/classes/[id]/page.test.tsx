// @vitest-environment jsdom
import type { ClassDetail, FeedEvent, RosterResponse, SessionSnapshot } from '@bali/shared';
import { act, cleanup, render, screen } from '@testing-library/react';
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
    // The student panel's read of the session's moments (PV11a): none yet.
    const moments = new RegExp(`^/v1/sessions/${SESSION}/events\\?after=(\\d+)$`).exec(path);
    if (method === 'GET' && moments) return [200, { events: [], nextAfter: Number(moments[1]) }];
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
    /** Each stream the grid opened, its events the test's to bring. */
    streams: [] as { onEvent: (e: FeedEvent) => void }[],
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
// No stream runs: the grid is its snapshot, and each event a test brings through the grid's own
// handler, as the stream would.
vi.mock('@/lib/sse-client', () => ({
  createSseClient: (options: { onEvent: (e: FeedEvent) => void }) => {
    bali.streams.push(options);
    return { close: () => undefined };
  },
}));
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
  bali.streams.length = 0;
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

/*
 * An unlock the grid's stream brings opens its pop-up (PV10; ClassUnlock), placed as GA2's boards
 * draw it: over the grid's top right, never over the teacher's controls. jsdom lays nothing out, so
 * the place is the box it is laid over: the tiles' own, after the header, the counts with Present
 * and the Questions and slides card, holding none of their controls (the audit's C01, where a click
 * on End session landed on a pop-up). Screenshots at each width show the rest, beside their boards.
 */
describe('a class live, an unlock lands (GA2)', () => {
  const CONTROLS = ['+5 min', '+10 min', 'End session', 'Present', 'Ask a question', 'Show slides'];
  /** Ana's unlock, as the stream brings it: a `seq` past the read's newest (4) lands live. */
  const unlocked = (seq: number): FeedEvent => ({
    seq,
    eventId: `019a0000-0000-7000-8000-00000000${String(seq).padStart(4, '0')}`,
    type: 'unlock',
    userId: 'u-ana',
    occurredAt: new Date().toISOString(),
    payload: { reason: 'nurse' },
  });
  /** The page, its grid read and its stream open. */
  async function live() {
    render(<ClassDetailPage />);
    await screen.findByRole('button', { name: /^Ana Rodríguez/ });
    await vi.waitFor(() => expect(bali.streams).toHaveLength(1));
  }
  const bring = async (e: FeedEvent) => {
    await act(async () => {
      bali.streams[0]?.onEvent(e);
      await Promise.resolve();
    });
  };

  it('lays its pop-up over the grid’s tiles alone, after every control of the header and the card', async () => {
    await live();
    await bring(unlocked(5));

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toMatch(/^Ana Rodríguez used Emergency Unlock/);
    // The pop-ups' layer, and the positioned box it is laid over: the tiles' own.
    const layer = alert.closest('.absolute');
    const box = layer?.parentElement;
    expect(layer?.classList.contains('inset-y-0')).toBe(true);
    expect(box?.classList.contains('relative')).toBe(true);
    expect(box?.contains(screen.getByRole('button', { name: /^Ana Rodríguez/ }))).toBe(true);
    // Every control of the header, the counts' row and the card is outside that box, before it.
    for (const name of CONTROLS) {
      const control = screen.getByRole('button', { name });
      expect(box?.contains(control), name).toBe(false);
      expect(control.compareDocumentPosition(box as Node), name).toBe(
        Node.DOCUMENT_POSITION_FOLLOWING,
      );
    }
    const card = screen.getByRole('heading', { name: 'Questions and slides' });
    expect(box?.contains(card)).toBe(false);
    expect(bali.unexpected).toEqual([]);
  });

  it('opens none for an unlock its read already held, as the stream’s first connect replays it', async () => {
    await live();
    await bring(unlocked(4));
    expect(screen.queryByText(/used Emergency Unlock/)).toBeNull();
  });

  it('closes on Open student, the student’s panel opening from their tile', async () => {
    const user = userEvent.setup();
    await live();
    await bring(unlocked(5));
    await user.click(await screen.findByRole('button', { name: 'Open student' }));
    expect(screen.queryByText(/used Emergency Unlock/)).toBeNull();
    const tile = screen.getByRole('button', { name: /^Ana Rodríguez/ });
    expect(tile.getAttribute('aria-expanded')).toBe('true');
  });

  it('never shows one in Present, the projector the class can see', async () => {
    sessionStorage.setItem(`bali.present.${bali.CLASS}`, 'on');
    render(<ClassDetailPage />);
    await screen.findByText('Ana Rodríguez');
    await vi.waitFor(() => expect(bali.streams).toHaveLength(1));
    await bring(unlocked(5));
    expect(screen.queryByText(/used Emergency Unlock/)).toBeNull();
  });
});
