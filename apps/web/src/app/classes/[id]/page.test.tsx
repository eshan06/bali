// @vitest-environment jsdom
import type {
  ClassDetail,
  Deck,
  FeedEvent,
  QuestionResults,
  RosterResponse,
  SessionPresentation,
  SessionSnapshot,
  TeacherQuestion,
} from '@bali/shared';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { DIALOG } from '@/components/join-code';
import { usePresenting } from '@/components/shell';
import { type ApiClient, createApiClient, SAVE_TIMEOUT_MS } from '@/lib/api-client';
import { CANT_REACH, SESSION_ALREADY_RUNNING } from '@/lib/errors';
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
  /**
   * Whether the class's session runs yet: none until a Start, when a test says so; whether a
   * Start's answer waits for the test to give it (`starts`); and an extend's (`extending`); and
   * whether a Start finds a session running already (`existing`).
   */
  const now = {
    running: true,
    holdStart: false,
    holdExtend: false,
    block: true,
    existing: false,
    /** The session over, as the class's reports list it after the bell (LO7). */
    ended: false,
    /** The roster's read with no answer at all, as when Bali can't be reached (LO9). */
    rosterDown: false,
  };
  /**
   * What the session has open, as its read says it (L7, M6): a question and a slide, none unless a
   * test says so; and the teacher's decks, as `GET /v1/decks` lists them.
   */
  const lesson = {
    question: null as TeacherQuestion | null,
    presentation: null as SessionPresentation | null,
    decks: [] as Deck[],
  };
  const starts: (() => void)[] = [];
  const answer = (method: string, path: string): [number, unknown] => {
    if (method === 'GET' && path === `/v1/classes/${CLASS}`) {
      return [200, now.running ? klass : { ...klass, liveSessionId: null }];
    }
    if (method === 'POST' && path === `/v1/classes/${CLASS}/sessions`) {
      now.running = true;
      const outcome = now.existing ? 'existing' : 'created';
      return [201, { outcome, session: snapshot.session, armedConverted: 0 }];
    }
    if (method === 'GET' && path === `/v1/classes/${CLASS}/roster`) return [200, roster];
    if (method === 'GET' && path === `/v1/sessions/${SESSION}`) {
      return [200, { ...snapshot, question: lesson.question, presentation: lesson.presentation }];
    }
    // The live lesson's own reads (L7, M6): the open question's totals, none answered yet; the
    // teacher's decks; and their questions, which the side panel lists.
    const q = lesson.question;
    if (method === 'GET' && q && path === `/v1/questions/${q.id}/results`) {
      const results: QuestionResults = {
        answered: 0,
        eligible: 1,
        open: q.open,
        correctOption: q.correctOption,
        revealed: q.revealed,
        counts: null,
      };
      return [200, results];
    }
    if (method === 'GET' && path === '/v1/decks') return [200, { decks: lesson.decks }];
    // The teacher's blocks: one, so the page before a session offers Start (LO4), unless a test
    // says none.
    if (method === 'GET' && path === '/v1/blocks') {
      const block = { id: 'b1', tagId: 'T7XK2M9QPF', createdAt: klass.createdAt };
      return [200, { blocks: now.block ? [block] : [] }];
    }
    if (method === 'GET' && path === '/v1/saved-questions') return [200, { savedQuestions: [] }];
    if (method === 'POST' && path === `/v1/sessions/${SESSION}/extend`) return [409, tooLong];
    // The student panel's read of the session's moments (PV11a): none yet.
    const moments = new RegExp(`^/v1/sessions/${SESSION}/events\\?after=(\\d+)$`).exec(path);
    if (method === 'GET' && moments) return [200, { events: [], nextAfter: Number(moments[1]) }];
    // After the bell, the read of the class's last session over: none to show here, unless a test
    // says the session ended (`ended`), its recap Ana focused the whole time (LO7).
    if (method === 'GET' && path === `/v1/classes/${CLASS}/reports/sessions?limit=1`) {
      const over = {
        ...snapshot.session,
        endedAt: new Date().toISOString(),
        ended: true,
        joinedCount: 1,
        focusMinutes: 20,
        averageFocusMinutes: 20,
        silentMinutes: 0,
        unlockCount: 0,
        protectionOffCount: 0,
      };
      return [200, { sessions: now.ended ? [over] : [], nextBefore: null }];
    }
    if (
      method === 'GET' &&
      now.ended &&
      path === `/v1/classes/${CLASS}/reports/sessions/${SESSION}`
    ) {
      return [
        200,
        {
          ended: true,
          joined: [{ id: 'u-ana', displayName: 'Ana Rodríguez' }],
          focusMinutes: 20,
          averageFocusMinutes: 20,
          silentMinutes: 0,
          unlocks: [],
          protectionOffs: [],
        },
      ];
    }
    unexpected.push(`${method} ${path}`);
    return [404, { error: { code: 'not_found', message: 'not found' } }];
  };
  /**
   * Each End on its way, and each extend while the test holds them, its answer the test's to give,
   * or no answer at all (its time limit).
   */
  const ends: { answer: (res: Response) => void; fail: () => void }[] = [];
  const extending: typeof ends = [];
  /** `fetch`, answered at once as Bali would answer it; an End, or a held extend, when the test says. */
  const fetch = (url: string | URL | Request, init?: RequestInit) => {
    const method = init?.method ?? 'GET';
    const path = (url as string).replace('http://api', '');
    const body = typeof init?.body === 'string' ? (JSON.parse(init.body) as unknown) : null;
    const waiting =
      method !== 'POST'
        ? null
        : path === `/v1/sessions/${SESSION}/end`
          ? ends
          : now.holdExtend && path === `/v1/sessions/${SESSION}/extend`
            ? extending
            : null;
    if (waiting) {
      sent.push({ method, path, body });
      return new Promise<Response>((answer, reject) => {
        const fail = () => reject(new TypeError('Failed to fetch'));
        init?.signal?.addEventListener('abort', fail);
        waiting.push({ answer, fail });
      });
    }
    if (now.rosterDown && path === `/v1/classes/${CLASS}/roster`) {
      sent.push({ method, path, body });
      return Promise.reject(new TypeError('Failed to fetch'));
    }
    const held =
      now.holdStart && method === 'POST' && path === `/v1/classes/${CLASS}/sessions`
        ? new Promise<void>((go) => starts.push(go))
        : Promise.resolve();
    return held.then(() => {
      sent.push({ method, path, body });
      const [status, json] = answer(method, path);
      return new Response(JSON.stringify(json), {
        status,
        headers: { 'content-type': 'application/json' },
      });
    });
  };
  return {
    CLASS,
    SESSION,
    endsAt,
    now,
    lesson,
    starts,
    sent,
    unexpected,
    ends,
    extending,
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
// Present tells the shell it is on the projector, so the shell draws no bar or frame: heard here.
vi.mock('@/components/shell', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/components/shell')>()),
  usePresenting: vi.fn(),
}));
// A slide's deck never finishes loading here, so its frame says so and draws nothing: loading and
// drawing one are `deck-pdf`'s own tests' and `slide-card`'s.
vi.mock('@/lib/deck-pdf', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/deck-pdf')>()),
  loadDeck: () => new Promise(() => undefined),
}));

/** The browser's ResizeObserver, which jsdom lacks: it lays nothing out, so it reports no size. */
class NoLayout {
  observe() {}
  unobserve() {}
  disconnect() {}
}
beforeAll(() => vi.stubGlobal('ResizeObserver', NoLayout));
afterAll(() => vi.unstubAllGlobals());

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
  bali.now.running = true;
  bali.now.holdStart = false;
  bali.now.holdExtend = false;
  bali.now.block = true;
  bali.now.existing = false;
  bali.now.ended = false;
  bali.now.rosterDown = false;
  bali.lesson.question = null;
  bali.lesson.presentation = null;
  bali.lesson.decks = [];
  vi.unstubAllEnvs();
  bali.starts.length = 0;
  bali.sent.length = 0;
  bali.unexpected.length = 0;
  bali.streams.length = 0;
  bali.ends.length = 0;
  bali.extending.length = 0;
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
 * The class page's header while its session runs (LO5; ClassLive, PhoneLive), converted from the
 * source text of `app/class-page.test.ts` and `app/present.test.ts`: the ring, the class's name over
 * when it ends and its join code, the time left over "left", then +5 and +10 as one pair, End
 * session and Present, which a phone never shows; each small on a phone. In Present (LO9; Present,
 * PresentStates), the mark and the name, +5, +10 and End kept, Exit Present after them, each small;
 * the time left beside the count, the room, and how to join at the foot. A line said under it in
 * the lock-only look: after the alert's icon, over the page's rule (LiveTopStates, PresentStates).
 */
describe('the live header (LO5; ClassLive, PhoneLive), and Present (LO9; Present)', () => {
  /** The header's own buttons, in order. */
  const buttons = () =>
    within(screen.getByRole('banner'))
      .getAllByRole('button')
      .map((b) => b.textContent);

  it('heads the class page with the ring, the name, when it ends and the join code, the time left, then the controls', async () => {
    render(<ClassDetailPage />);
    await screen.findByText('Ana Rodríguez');
    const header = screen.getByRole('banner');
    expect(within(header).getByRole('heading', { level: 1 }).textContent).toBe('Biology, period 3');
    const bell = header.querySelector(`time[datetime="${bali.endsAt}"]`);
    expect(bell?.parentElement?.textContent).toBe(`Ends ${bell?.textContent}`);
    const code = within(header).getByText('VMAF7E');
    expect(code.parentElement?.textContent).toBe('Join code VMAF7E');
    expect(code.getAttribute('translate')).toBe('no');
    // 25 minutes to the bell, on this computer's clock.
    expect(within(header).getByText(/^2[45]:\d\d$/).nextElementSibling?.textContent).toBe('left');
    expect(header.querySelector('svg')?.getAttribute('width')).toBe('48');
    expect(buttons()).toEqual(['+5 min', '+10 min', 'End session', 'Present']);
    // +5 and +10 one pair: their shared edge square and drawn once.
    const [plus5, plus10, end, present] = within(header).getAllByRole('button');
    expect(plus5?.parentElement).toBe(plus10?.parentElement);
    expect(plus5?.classList).toContain('rounded-r-none');
    expect(Array.from(plus10?.classList ?? [])).toEqual(
      expect.arrayContaining(['-ml-px', 'rounded-l-none']),
    );
    // Small on a phone, where Present never shows (PhoneLive).
    for (const small of [plus5, plus10, end]) {
      expect(Array.from(small?.classList ?? [])).toEqual(
        expect.arrayContaining(['max-[760px]:h-8.5', 'max-[760px]:text-button-sm']),
      );
    }
    expect(present?.classList).toContain('max-[760px]:hidden');
    expect(present?.getAttribute('aria-pressed')).toBe('false');
    // No count in the header: the count is the page's own, under it.
    expect(header.textContent).not.toMatch(/joined|focused/);
    expect(bali.unexpected).toEqual([]);
  });

  it('draws Present: the mark and the name, +5, +10, End and Exit Present, the time beside the count, the room, how to join', async () => {
    sessionStorage.setItem(`bali.present.${bali.CLASS}`, 'on');
    render(<ClassDetailPage />);
    await screen.findByText('Ana Rodríguez');
    const header = screen.getByRole('banner');
    expect(within(header).getByRole('heading', { level: 1 }).className).toMatch(
      /\btext-present-name\b/,
    );
    // The mark before the name, as the board draws it, 30 px.
    expect(header.querySelector('svg')?.getAttribute('width')).toBe('30');
    expect(buttons()).toEqual(['+5 min', '+10 min', 'End session', 'Exit Present']);
    const exit = screen.getByRole('button', { name: 'Exit Present' });
    expect(exit.getAttribute('aria-pressed')).toBe('true');
    expect(exit.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true');
    // Every control small, as Present draws them, Exit Present on a phone too.
    for (const button of within(header).getAllByRole('button')) {
      expect(Array.from(button.classList), button.textContent ?? '').toEqual(
        expect.arrayContaining(['h-8.5', 'text-button-sm']),
      );
      expect(button.classList).not.toContain('max-[760px]:hidden');
    }
    // No join code, ends line or "left" in the header: the band says the time, the foot the code.
    expect(header.textContent).not.toMatch(/Join code|Ends|joined/);
    // The band: the time left to the bell, "left, until" it, beside the count of who is focused.
    const bell = document.querySelector(`time[datetime="${bali.endsAt}"]`);
    expect(bell?.parentElement?.textContent).toBe(`left, until ${bell?.textContent}`);
    expect(screen.getByText(/^2[45]:\d\d$/).className).toMatch(/\btext-present-clock\b/);
    expect(screen.getByRole('heading', { level: 2, name: '1 of 1 focused' })).toBeTruthy();
    expect(screen.getByRole('list', { name: 'Everyone in the class' })).toBeTruthy();
    // How to join, at the foot, the code read from the back of the room.
    const code = screen.getByText('VMAF7E');
    expect(code.parentElement?.textContent).toBe(
      'New to this class? Join in the Bali app with VMAF7E',
    );
    expect(code.getAttribute('translate')).toBe('no');
    expect(code.className).toMatch(/\bfont-mono\b.*\btext-code-join\b/);
    // No roster, no New code, no Check on, no session list: the class sees this. (No menu: the
    // shell is told, below.)
    expect(screen.queryByRole('button', { name: /New code|Add students/ })).toBeNull();
    expect(screen.queryByText(/^Check on/)).toBeNull();
    expect(screen.queryByRole('complementary')).toBeNull();
    expect(bali.unexpected).toEqual([]);
  });

  it('frames Present itself: at least the screen’s height, 32/48/48 in, 24/16/32 on a phone, the shell told', async () => {
    sessionStorage.setItem(`bali.present.${bali.CLASS}`, 'on');
    const view = render(<ClassDetailPage />);
    await screen.findByText('Ana Rodríguez');
    expect(Array.from(view.container.firstElementChild?.classList ?? [])).toEqual(
      expect.arrayContaining([
        'flex',
        'min-h-dvh',
        'flex-col',
        'gap-6',
        'px-12',
        'pt-8',
        'pb-12',
        'max-[760px]:px-4',
        'max-[760px]:pt-6',
        'max-[760px]:pb-8',
      ]),
    );
    // The shell draws no bar or frame while a page says it is on the projector.
    expect(vi.mocked(usePresenting)).toHaveBeenLastCalledWith(true);
  });

  it('says time it can’t add under the header, after the alert’s icon, over the page’s rule', async () => {
    const user = userEvent.setup();
    render(<ClassDetailPage />);
    await screen.findByText('Ana Rodríguez');
    await user.click(screen.getByRole('button', { name: '+5 min' }));
    const said = await screen.findByRole('alert');
    expect(said.textContent).toBe(PAST_16_HOURS);
    expect(said.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true');
    // No hairlines of its own: the rule over the count is the next thing under it.
    expect(said.parentElement?.className).not.toMatch(/border/);
    expect(said.parentElement?.nextElementSibling?.classList).toContain('border-t');
    expect(screen.getByRole('banner').compareDocumentPosition(said)).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
  });
});

/*
 * The rest of what the live page says under its header, and Present's (LO5's santa round 1): a
 * Start that found a session already running, said quietly on the class page (LiveTopStates); an
 * extend with no answer in Present, in v2's line with Try again; and Present left on a phone, where
 * the class page draws no Present to land on (PhoneLive).
 */
describe('the live page’s other lines, and Present left on a phone (LO5)', () => {
  it('says quietly that a session was already running, the length picked unused', async () => {
    bali.now.running = false;
    bali.now.existing = true;
    const user = userEvent.setup();
    render(<ClassDetailPage />);
    await user.click(await screen.findByRole('button', { name: /^Start \d+-minute session$/ }));
    const note = await screen.findByText(SESSION_ALREADY_RUNNING);
    expect(note.getAttribute('role')).toBe('status');
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.getByRole('banner').compareDocumentPosition(note)).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
    expect(bali.unexpected).toEqual([]);
  });

  it('says an extend with no answer in Present, Try again sending the same one again', async () => {
    sessionStorage.setItem(`bali.present.${bali.CLASS}`, 'on');
    bali.now.holdExtend = true;
    const user = userEvent.setup();
    render(<ClassDetailPage />);
    await screen.findByText('Ana Rodríguez');
    await user.click(screen.getByRole('button', { name: '+5 min' }));
    await act(async () => {
      bali.extending.shift()?.fail();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(screen.getByRole('alert').textContent).toBe(CANT_REACH);
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(extendsSent()).toHaveLength(2);
    expect(extendsSent()[1]?.body).toEqual(extendsSent()[0]?.body);
  });

  it('puts focus on the class’s name as Present is left on a phone, where the page draws no Present', async () => {
    sessionStorage.setItem(`bali.present.${bali.CLASS}`, 'on');
    vi.stubGlobal('matchMedia', (query: string) => ({ matches: query === '(width < 760px)' }));
    try {
      const user = userEvent.setup();
      render(
        <main>
          <ClassDetailPage />
        </main>,
      );
      await screen.findByText('Ana Rodríguez');
      await user.click(screen.getByRole('button', { name: 'Exit Present' }));
      expect(screen.queryByRole('button', { name: 'Exit Present' })).toBeNull();
      expect(document.activeElement).toBe(
        screen.getByRole('heading', { level: 1, name: 'Biology, period 3' }),
      );
    } finally {
      vi.unstubAllGlobals();
      vi.stubGlobal('ResizeObserver', NoLayout);
    }
  });
});

/*
 * An extend that got no answer (ClassRetryStates): it may have landed, so its line says so with
 * Try again, which sends the same one again under its id, held, as every control is while any send
 * is on its way, so focus stays on it; answered, the time added in the line's place, focus on the
 * class's name; failed again, said again. +5 and +10 send afresh, their line going as they do,
 * focus kept on their own button, the same minutes resending the one with no answer (rule 4).
 * Converted from the source text of `app/class-page.test.ts` (A3b).
 */
describe('an extend with no answer, and its Try again (ClassRetryStates)', () => {
  const later = new Date(Date.parse(bali.endsAt) + 5 * 60_000).toISOString();
  const name = () => screen.getByRole('heading', { level: 1, name: 'Biology, period 3' });
  const control = (name: string) => screen.getByRole('button', { name });

  /** The page live, its grid read, its extends held. */
  async function live() {
    bali.now.holdExtend = true;
    const user = userEvent.setup();
    render(
      <main>
        <ClassDetailPage />
      </main>,
    );
    await screen.findByText('Ana Rodríguez');
    return user;
  }
  /** The extend on its way now: no answer at all, or the time added; drawn before the next check. */
  const settle = (how: 'none' | 'added') =>
    act(async () => {
      const extend = bali.extending.shift();
      if (how === 'none') extend?.fail();
      else {
        extend?.answer(
          Response.json({
            outcome: 'extended',
            session: { id: bali.SESSION, classId: bali.CLASS, endsAt: later },
          }),
        );
      }
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  const pressed = () => extendsSent().map(({ body }) => body as Press);

  it('keeps its line said while Try again sends the same one again, every control held; added, the line goes, focus on the class’s name', async () => {
    const user = await live();
    await user.click(control('+5 min'));
    await settle('none');
    const line = screen.getByText(CANT_REACH);
    expect(line.getAttribute('role')).toBe('alert');

    // Sent again, on its way: the line said, Try again held as Loading… with focus on it, and
    // every control held with it.
    const again = control('Try again');
    await user.click(again);
    expect(screen.getByText(CANT_REACH)).toBe(line);
    expect(again.textContent).toBe('Loading…');
    expect(again.getAttribute('aria-busy')).toBe('true');
    expect(document.activeElement).toBe(again);
    for (const held of ['+5 min', '+10 min', 'End session']) {
      expect(control(held).getAttribute('aria-disabled'), held).toBe('true');
    }
    // The same one, under its id.
    expect(pressed()).toHaveLength(2);
    expect(pressed()[1]).toEqual(pressed()[0]);

    // No answer again: said again, anew, Try again in its place.
    await settle('none');
    const anew = screen.getByText(CANT_REACH);
    expect(anew).not.toBe(line);
    expect(anew.getAttribute('role')).toBe('alert');
    expect(control('Try again').getAttribute('aria-busy')).toBe('false');

    // Sent again and added: the line and Try again go, the bell moves, focus on the class's name.
    await user.click(control('Try again'));
    expect(pressed()[2]).toEqual(pressed()[0]);
    await settle('added');
    expect(screen.queryByText(CANT_REACH)).toBeNull();
    expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull();
    expect(document.querySelector(`time[datetime="${later}"]`)).not.toBeNull();
    await vi.waitFor(() => expect(document.activeElement).toBe(name()));
    for (const free of ['+5 min', '+10 min', 'End session']) {
      expect(control(free).getAttribute('aria-disabled'), free).toBe('false');
    }
    expect(bali.unexpected).toEqual([]);
  });

  it('lets +5 and +10 send afresh, their line going as they do, focus kept on them; the same minutes resend the one with no answer', async () => {
    const user = await live();
    await user.click(control('+5 min'));
    await settle('none');
    expect(screen.getByText(CANT_REACH).getAttribute('role')).toBe('alert');

    // +10: a fresh one, under a new id, the line going as it is sent; focus stays on +10.
    const plus10 = control('+10 min');
    await user.click(plus10);
    expect(screen.queryByText(CANT_REACH)).toBeNull();
    expect(document.activeElement).toBe(plus10);
    await settle('none');
    expect(screen.getByText(CANT_REACH).getAttribute('role')).toBe('alert');

    // +10 again: the one with no answer, under its own id.
    await user.click(plus10);
    expect(screen.queryByText(CANT_REACH)).toBeNull();
    await settle('added');
    const [first, second, third] = pressed();
    expect(first?.durationMinutes).toBe(5);
    expect(second?.durationMinutes).toBe(10);
    expect(second?.eventId).toMatch(UUID_V7);
    expect(second?.eventId).not.toBe(first?.eventId);
    expect(third).toEqual(second);
    expect(screen.queryByRole('alert')).toBeNull();
    expect(document.activeElement).toBe(plus10);
    expect(bali.unexpected).toEqual([]);
  });
});

/*
 * An unlock the grid's stream brings opens its pop-up (PV10; ClassUnlock), pinned at the window's
 * top right while one is open (the owner's "Pin them", 2026-11-17; LiveListStates), never over the
 * teacher's controls. jsdom lays nothing out, so the place is the grid's cells its layer spans: the
 * session list's column from 1024 px, the room's row and the list's under it, after the header with
 * Present, the count and Check on (LO5), holding none of their controls (GA2; the audit's C01, where
 * a click on End session landed on a pop-up). Screenshots at each width show the rest, beside their
 * board.
 */
describe('a class live, an unlock lands (GA2)', () => {
  const CONTROLS = ['+5 min', '+10 min', 'End session', 'Present'];
  /** Ana's tile in the room, a button that opens her panel. */
  const anasTile = () =>
    within(screen.getByRole('list', { name: 'Everyone in the class' })).getByRole('button', {
      name: /^Ana Rodríguez/,
    });
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

  it('pins its pop-up in the session list’s cells, after every control of the header and Check on', async () => {
    await live();
    await bring(unlocked(5));

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toMatch(/^Ana Rodríguez used Emergency Unlock/);
    // Beside her tile's pulse (bali-softpulse), which the same live unlock starts.
    expect(anasTile().querySelector('.animate-softpulse')).not.toBeNull();
    // The pop-ups' layer, an item of the live part's grid: from 1024 px the session list's column,
    // in its row; under 1024 px the room's row and the list's under it, the count with Check on
    // the row above them, so no pop-up rises over those, and none over the header, which is out of
    // the grid. Its stack sticks 18 px under the top bar however far the page scrolls.
    const stack = alert.closest('.sticky');
    const layer = stack?.parentElement;
    const grid = layer?.parentElement;
    const list = screen.getByRole('complementary', { name: 'This session' });
    expect(Array.from(stack?.classList ?? [])).toEqual(
      expect.arrayContaining(['top-[79px]', 'max-[760px]:top-[75px]', 'z-20']),
    );
    expect(Array.from(layer?.classList ?? [])).toEqual(
      expect.arrayContaining([
        'lg:col-start-2',
        'lg:row-start-1',
        'max-lg:col-start-1',
        'max-lg:row-[2/span_2]',
        'self-stretch',
      ]),
    );
    expect(grid?.classList.contains('grid')).toBe(true);
    // The cells it spans are the list's and the room's own: the same column and row from 1024 px,
    // and under it the room's row (2) to the list's (3), the count's the first.
    const room = screen.getByRole('region', { name: 'Everyone' });
    const count = screen.getByRole('region', { name: '0 of 1 focused' });
    expect(Array.from(list.parentElement?.classList ?? [])).toEqual(
      expect.arrayContaining(['lg:col-start-2', 'lg:row-start-1', 'max-lg:row-start-3']),
    );
    expect(room.classList.contains('max-lg:row-start-2')).toBe(true);
    expect(count.classList.contains('max-lg:row-start-1')).toBe(true);
    // The session list keeps the unlock as a line of its own.
    expect(within(list).getByText('Ana Rodríguez used Emergency Unlock')).toBeTruthy();
    // Every control of the header, and Check on's, is outside the layer, before it: her name in
    // Check on and its Open, now she is unlocked.
    const controls = [
      ...CONTROLS.map((name) => screen.getByRole('button', { name })),
      ...within(count).getAllByRole('button'),
    ];
    expect(controls).toHaveLength(CONTROLS.length + 2);
    for (const control of controls) {
      const name = control.textContent ?? '';
      expect(layer?.contains(control), name).toBe(false);
      expect(control.compareDocumentPosition(layer as Node), name).toBe(
        Node.DOCUMENT_POSITION_FOLLOWING,
      );
    }
    expect(bali.unexpected).toEqual([]);
  });

  it('opens none for an unlock its read already held, as the stream’s first connect replays it', async () => {
    await live();
    await bring(unlocked(4));
    // No pop-up, an alert: the session list keeps it as a line all the same.
    expect(screen.queryByRole('alert')).toBeNull();
    // Her tile says Unlocked, as the replay applies it, and doesn't pulse.
    expect(anasTile().textContent).toMatch(/Unlocked/);
    expect(anasTile().querySelector('.animate-softpulse')).toBeNull();
  });

  it('pulses her tile once for each live unlock: still once it has pulsed, again at the next', async () => {
    await live();
    await bring(unlocked(5));
    const glow = () => anasTile().querySelector('.animate-softpulse');
    const first = glow();
    expect(first).not.toBeNull();
    // A second unlock while the first still pulses: a glow of its own, from the start.
    await bring(unlocked(6));
    const second = glow();
    expect(second).not.toBeNull();
    expect(second).not.toBe(first);
    // Its end: jsdom has no AnimationEvent, so React listens for the prefixed name there.
    act(() => {
      second?.dispatchEvent(new Event('webkitAnimationEnd', { bubbles: true }));
    });
    expect(glow()).toBeNull();
  });

  it('closes on Open student, the student’s panel opening from their tile', async () => {
    const user = userEvent.setup();
    await live();
    await bring(unlocked(5));
    await user.click(await screen.findByRole('button', { name: 'Open student' }));
    expect(screen.queryByRole('alert')).toBeNull();
    expect(anasTile().getAttribute('aria-expanded')).toBe('true');
    // Her panel, focus on her name, her unlock there with its reason, from the session's log.
    const panel = screen.getByRole('complementary', { name: 'Ana Rodríguez' });
    expect(document.activeElement).toBe(within(panel).getByRole('heading', { level: 2 }));
    expect(within(panel).getByText('Used Emergency Unlock').textContent).toBe(
      'Used Emergency UnlockNurse',
    );
  });

  // The last one closed, nothing takes its Close's place: focus goes to the tile of the student it
  // named, never the page's body (the audit's C2-02; GA4, the conductor's call).
  for (const by of ['click', 'keyboard'] as const) {
    it(`closes on its Close, named for whose it is, focus then on the student’s tile, by ${by}`, async () => {
      const user = userEvent.setup();
      await live();
      await bring(unlocked(5));
      const close = await screen.findByRole('button', { name: "Close Ana Rodríguez's pop-up" });
      if (by === 'click') await user.click(close);
      else {
        close.focus();
        await user.keyboard('{Enter}');
      }
      expect(screen.queryByRole('alert')).toBeNull();
      expect(document.activeElement).toBe(anasTile());
    });
  }

  it('never shows one in Present, the projector the class can see', async () => {
    sessionStorage.setItem(`bali.present.${bali.CLASS}`, 'on');
    render(<ClassDetailPage />);
    await screen.findByText('Ana Rodríguez');
    await vi.waitFor(() => expect(bali.streams).toHaveLength(1));
    await bring(unlocked(5));
    expect(screen.queryByText(/used Emergency Unlock/)).toBeNull();
  });
});

/*
 * While a session runs, the tab's title counts who to check on before the class's name, so the
 * count shows from another tab (LiveStates' An unlock lands; LiveListStates); and a name in Home's
 * Check on (`?student=`, LO3) opens that student's panel, the address forgetting it (LO6).
 */
describe('a class live: the tab’s title, and a name from Home’s Check on (LO6)', () => {
  const TITLE = 'Bali teacher portal';
  /** The page, its grid read and its stream open. */
  async function live() {
    render(<ClassDetailPage />);
    await screen.findByRole('button', { name: /^Ana Rodríguez/ });
    await vi.waitFor(() => expect(bali.streams).toHaveLength(1));
  }
  /** An event of Ana's, or the session's own, as the stream brings it: past the read's newest (4). */
  const event = (seq: number, type: FeedEvent['type'], payload: unknown = null): FeedEvent => ({
    seq,
    eventId: `019a0000-0000-7000-8000-0000000002${String(seq).padStart(2, '0')}`,
    type,
    userId: type.startsWith('session_') ? null : 'u-ana',
    occurredAt: new Date().toISOString(),
    payload,
  });
  const bring = async (e: FeedEvent) => {
    await act(async () => {
      bali.streams[0]?.onEvent(e);
      await Promise.resolve();
    });
  };
  /** Every effect the last render queued run, and what they drew drawn. */
  const settle = () => act(() => new Promise((resolve) => setTimeout(resolve, 20)));
  beforeEach(() => {
    document.title = TITLE;
  });
  afterEach(() => {
    window.history.replaceState(null, '', '/');
  });

  it('counts who to check on before the class’s name, the name alone with nobody to check on', async () => {
    await live();
    expect(document.title).toBe('Biology, period 3');
    await bring(event(5, 'unlock', { reason: 'nurse' }));
    expect(document.title).toBe('(1) Biology, period 3');
    await bring(event(6, 'refocus'));
    expect(document.title).toBe('Biology, period 3');
    // The session over, the page after the bell: the title it had before.
    await bring(event(7, 'session_ended'));
    await vi.waitFor(() => expect(document.title).toBe(TITLE));
  });

  it('keeps the tab’s own title while no session runs', async () => {
    bali.now.running = false;
    render(<ClassDetailPage />);
    await screen.findByRole('button', { name: /^Start/ });
    expect(document.title).toBe(TITLE);
  });

  it('opens the panel of the student Home’s Check on named, focus on their name, the address forgetting them', async () => {
    window.history.replaceState(null, '', `/classes/${bali.CLASS}?student=u-ana`);
    await live();
    const panel = await screen.findByRole('complementary', { name: 'Ana Rodríguez' });
    expect(document.activeElement).toBe(within(panel).getByRole('heading', { level: 2 }));
    expect(`${window.location.pathname}${window.location.search}`).toBe(`/classes/${bali.CLASS}`);
    // Asked once: closed, it stays closed.
    await userEvent
      .setup()
      .click(within(panel).getByRole('button', { name: "Close Ana Rodríguez's panel" }));
    expect(screen.queryByRole('complementary', { name: 'Ana Rodríguez' })).toBeNull();
  });

  it('opens it for that session alone: the next one started on the page opens no panel (santa’s round 1)', async () => {
    const user = userEvent.setup();
    window.history.replaceState(null, '', `/classes/${bali.CLASS}?student=u-ana`);
    await live();
    const panel = await screen.findByRole('complementary', { name: 'Ana Rodríguez' });
    await user.click(within(panel).getByRole('button', { name: "Close Ana Rodríguez's panel" }));
    // The bell, then the next Start on the same page: its grid opens nobody's panel.
    await bring(event(5, 'session_ended'));
    await user.click(await screen.findByRole('button', { name: /^Start/ }));
    await vi.waitFor(() => expect(bali.streams).toHaveLength(2));
    await screen.findByRole('button', { name: /^Ana Rodríguez/ });
    await settle();
    expect(screen.queryByRole('complementary', { name: 'Ana Rodríguez' })).toBeNull();
  });

  it('opens none for a session started after a page that opened on none', async () => {
    const user = userEvent.setup();
    bali.now.running = false;
    window.history.replaceState(null, '', `/classes/${bali.CLASS}?student=u-ana`);
    render(<ClassDetailPage />);
    await user.click(await screen.findByRole('button', { name: /^Start/ }));
    await vi.waitFor(() => expect(bali.streams).toHaveLength(1));
    await screen.findByRole('button', { name: /^Ana Rodríguez/ });
    await settle();
    expect(screen.queryByRole('complementary', { name: 'Ana Rodríguez' })).toBeNull();
    expect(window.location.search).toBe('');
  });

  it('opens none for a name no student on the grid has, and forgets it all the same', async () => {
    for (const asked of ['u-nobody', '__proto__', 'toString']) {
      window.history.replaceState(null, '', `/classes/${bali.CLASS}?student=${asked}`);
      await live();
      // The session list alone: no student's panel.
      expect(
        screen.getAllByRole('complementary').map((aside) => aside.getAttribute('aria-labelledby')),
      ).toEqual([expect.stringMatching(/-log$/)]);
      expect(window.location.search, asked).toBe('');
      cleanup();
      bali.streams.length = 0;
    }
  });

  it('opens none in Present, the projector the class can see', async () => {
    sessionStorage.setItem(`bali.present.${bali.CLASS}`, 'on');
    window.history.replaceState(null, '', `/classes/${bali.CLASS}?student=u-ana`);
    render(<ClassDetailPage />);
    await screen.findByText('Ana Rodríguez');
    await vi.waitFor(() => expect(bali.streams).toHaveLength(1));
    expect(screen.queryByRole('complementary')).toBeNull();
    expect(window.location.search).toBe('');
  });
});

/*
 * A Start takes the page before a session away, Start with it, and the live page takes its place:
 * focus goes to the class's name, never the page's body (the audit's C2-02, confirmed with real
 * clicks; GA4, the conductor's call, End's place since GA6). A page opened on a class in session
 * leaves focus where the browser puts it.
 */
describe('a class’s Start, focus then on the class’s name (GA4)', () => {
  const name = () => screen.getByRole('heading', { level: 1, name: 'Biology, period 3' });
  /** The page before a session, its class read: Start in its card. */
  async function before() {
    bali.now.running = false;
    render(
      <main>
        <ClassDetailPage />
      </main>,
    );
    return screen.findByRole('button', { name: /^Start \d+-minute session$/ });
  }

  for (const by of ['click', 'keyboard'] as const) {
    it(`starts the session, the live page in its place, focus on the class’s name, by ${by}`, async () => {
      const user = userEvent.setup();
      const start = await before();
      if (by === 'click') await user.click(start);
      else {
        start.focus();
        await user.keyboard('{Enter}');
      }
      await screen.findByRole('button', { name: 'End session' });
      expect(screen.queryByRole('button', { name: /^Start/ })).toBeNull();
      await vi.waitFor(() => expect(document.activeElement).toBe(name()));
      expect(name().getAttribute('tabindex')).toBe('-1');
      expect(bali.sent.filter(({ method }) => method === 'POST')).toEqual([
        {
          method: 'POST',
          path: `/v1/classes/${bali.CLASS}/sessions`,
          body: { durationMinutes: 50 },
        },
      ]);
      expect(bali.unexpected).toEqual([]);
    });
  }

  it('leaves focus where the teacher moved it while the Start was on its way', async () => {
    const user = userEvent.setup();
    bali.now.holdStart = true;
    const start = await before();
    // The side menu's stand-in, outside the page.
    const menu = document.createElement('a');
    menu.href = '/classes';
    document.body.append(menu);
    await user.click(start);
    expect(start.textContent).toBe('Starting…');
    menu.focus();
    await act(async () => {
      bali.starts[0]?.();
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    await screen.findByRole('button', { name: 'End session' });
    expect(document.activeElement).toBe(menu);
    menu.remove();
  });

  it('moves no focus on a page opened on a class in session', async () => {
    render(
      <main>
        <ClassDetailPage />
      </main>,
    );
    await screen.findByText('Ana Rodríguez');
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(document.activeElement).toBe(document.body);
  });
});

/*
 * Present's toggle moves as it is pressed, from the live header's end into Present's header as Exit
 * Present and back, and focus follows it (PV9, LO9); Present left after the bell leaves no toggle to
 * follow, so focus goes to Start, the next thing to do. After the bell Present says "Class is over"
 * alone (PresentStates). Kept for the tab, and opened from Home's Present (`?present`). Converted
 * from `app/present.test.ts`'s source text (LO4, LO9).
 */
describe('Present’s toggle, focus following it (PV9, LO9)', () => {
  /** The session over, as the stream says it. */
  const bell = () =>
    act(async () => {
      bali.streams[0]?.onEvent({
        seq: 5,
        eventId: '019a0000-0000-7000-8000-000000000e05',
        type: 'session_ended',
        userId: null,
        occurredAt: new Date().toISOString(),
        payload: {},
      });
      await Promise.resolve();
    });

  it('says Class is over alone after the bell, Exit Present its one control, how to join at the foot (PresentStates)', async () => {
    sessionStorage.setItem(`bali.present.${bali.CLASS}`, 'on');
    render(<ClassDetailPage />);
    await screen.findByText('Ana Rodríguez');
    await vi.waitFor(() => expect(bali.streams).toHaveLength(1));
    bali.now.running = false;
    bali.now.ended = true;
    await bell();
    const over = await screen.findByRole('heading', { level: 2, name: 'Class is over' });
    // At the time's size, centred and balanced where it wraps on a phone.
    expect(over.className.split(' ')).toEqual(
      expect.arrayContaining(['text-present-clock', 'text-center', 'text-balance']),
    );
    const header = screen.getByRole('banner');
    expect(within(header).getByRole('heading', { level: 1 }).textContent).toBe('Biology, period 3');
    expect(
      within(header)
        .getAllByRole('button')
        .map((b) => b.textContent),
    ).toEqual(['Exit Present']);
    // No tile, no count, no time left: the figures are the recap's, where the class can't read them.
    expect(screen.queryByText('Ana Rodríguez')).toBeNull();
    expect(screen.queryByText(/focused|left, until/)).toBeNull();
    expect(screen.getByText('VMAF7E').parentElement?.textContent).toBe(
      'New to this class? Join in the Bali app with VMAF7E',
    );
    expect(bali.unexpected).toEqual([]);
  });

  it('says a roster that didn’t load after the bell under Present’s header, its Try again reading it again (PresentStates)', async () => {
    sessionStorage.setItem(`bali.present.${bali.CLASS}`, 'on');
    const user = userEvent.setup();
    render(<ClassDetailPage />);
    await screen.findByText('Ana Rodríguez');
    await vi.waitFor(() => expect(bali.streams).toHaveLength(1));
    bali.now.running = false;
    bali.now.rosterDown = true;
    await bell();
    await screen.findByRole('heading', { level: 2, name: 'Class is over' });
    const line = await screen.findByRole('alert');
    expect(line.textContent).toBe(`Couldn't load this class. ${CANT_REACH}`);
    expect(line.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true');
    // Under the header, over Class is over.
    expect(screen.getByRole('banner').compareDocumentPosition(line)).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
    // Read again, and answered: the line goes, Class is over stays.
    bali.now.rosterDown = false;
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    await vi.waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
    expect(screen.getByRole('heading', { level: 2, name: 'Class is over' })).toBeTruthy();
    expect(bali.unexpected).toEqual([]);
  });

  it('opens in Present from Home’s Present, kept for the tab, the address forgetting it (PV17b)', async () => {
    window.history.replaceState(null, '', `/classes/${bali.CLASS}?present`);
    try {
      render(<ClassDetailPage />);
      await screen.findByText('Ana Rodríguez');
      expect(
        screen.getByRole('button', { name: 'Exit Present' }).getAttribute('aria-pressed'),
      ).toBe('true');
      expect(`${window.location.pathname}${window.location.search}`).toBe(`/classes/${bali.CLASS}`);
      expect(sessionStorage.getItem(`bali.present.${bali.CLASS}`)).toBe('on');
    } finally {
      window.history.replaceState(null, '', '/');
    }
  });

  it('follows it into Present’s header and back, then to Start as Present is left after the bell', async () => {
    const user = userEvent.setup();
    render(
      <main>
        <ClassDetailPage />
      </main>,
    );
    await screen.findByText('Ana Rodríguez');
    await vi.waitFor(() => expect(bali.streams).toHaveLength(1));
    const toggle = () => screen.getByRole('button', { name: /^(Exit )?Present$/ });

    const beside = toggle();
    await user.click(beside);
    expect(toggle()).not.toBe(beside);
    expect(toggle().getAttribute('aria-pressed')).toBe('true');
    expect(document.activeElement).toBe(toggle());
    await user.click(toggle());
    expect(toggle().getAttribute('aria-pressed')).toBe('false');
    expect(document.activeElement).toBe(toggle());

    // In Present again, the bell: Class is over, the toggle at its header's end.
    await user.click(toggle());
    bali.now.running = false;
    await act(async () => {
      bali.streams[0]?.onEvent({
        seq: 5,
        eventId: '019a0000-0000-7000-8000-000000000e05',
        type: 'session_ended',
        userId: null,
        occurredAt: new Date().toISOString(),
        payload: {},
      });
      await Promise.resolve();
    });
    await screen.findByRole('heading', { name: 'Class is over' });
    // Present's page after the bell shows no last session, so none is read while it shows.
    const lastRead = () => bali.sent.filter(({ path }) => path.endsWith('/sessions?limit=1'));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(lastRead()).toEqual([]);
    await user.click(toggle());
    const start = await screen.findByRole('button', { name: 'Start 50-minute session' });
    expect(document.activeElement).toBe(start);
    await vi.waitFor(() => expect(lastRead()).toHaveLength(1));
    expect(bali.unexpected).toEqual([]);
  });

  it('never shows the recap in Present, so no figure or reason reaches the room; left, the recap, focus on the class’s name (LO7)', async () => {
    sessionStorage.setItem(`bali.present.${bali.CLASS}`, 'on');
    const user = userEvent.setup();
    render(
      <main>
        <ClassDetailPage />
      </main>,
    );
    await screen.findByText('Ana Rodríguez');
    await vi.waitFor(() => expect(bali.streams).toHaveLength(1));
    bali.now.running = false;
    bali.now.ended = true;
    await act(async () => {
      bali.streams[0]?.onEvent({
        seq: 5,
        eventId: '019a0000-0000-7000-8000-000000000e05',
        type: 'session_ended',
        userId: null,
        occurredAt: new Date().toISOString(),
        payload: {},
      });
      await Promise.resolve();
    });
    await screen.findByRole('heading', { name: 'Class is over' });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(screen.queryByText(/stayed focused|Not focused|Didn't join/)).toBeNull();

    await user.click(screen.getByRole('button', { name: 'Exit Present' }));
    const recap = await screen.findByRole('heading', {
      level: 2,
      name: '1 of 1 stayed focused the whole time',
    });
    expect(recap).toBeTruthy();
    // ClassEnded's head, no Start: focus on the class's name.
    expect(screen.getByRole('button', { name: 'Start another session' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /^Start \d+-minute session$/ })).toBeNull();
    expect(document.activeElement).toBe(
      screen.getByRole('heading', { level: 1, name: 'Biology, period 3' }),
    );
    expect(bali.unexpected).toEqual([]);
  });

  it('takes no focus as the page comes back in Present: only a press moves it', async () => {
    sessionStorage.setItem(`bali.present.${bali.CLASS}`, 'on');
    // Focus never moves at all, not even to the name held while the class is read.
    const moved = vi.fn();
    document.addEventListener('focusin', moved);
    render(
      <main>
        <ClassDetailPage />
      </main>,
    );
    await screen.findByText('Ana Rodríguez');
    expect(screen.getByRole('button', { name: 'Exit Present' }).getAttribute('aria-pressed')).toBe(
      'true',
    );
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(document.activeElement).toBe(document.body);
    document.removeEventListener('focusin', moved);
    expect(moved).not.toHaveBeenCalled();
  });

  it('goes to the class’s name as Present is left after the bell with no block, so no Start', async () => {
    bali.now.block = false;
    sessionStorage.setItem(`bali.present.${bali.CLASS}`, 'on');
    const user = userEvent.setup();
    render(
      <main>
        <ClassDetailPage />
      </main>,
    );
    await screen.findByText('Ana Rodríguez');
    await vi.waitFor(() => expect(bali.streams).toHaveLength(1));
    bali.now.running = false;
    await act(async () => {
      bali.streams[0]?.onEvent({
        seq: 5,
        eventId: '019a0000-0000-7000-8000-000000000e05',
        type: 'session_ended',
        userId: null,
        occurredAt: new Date().toISOString(),
        payload: {},
      });
      await Promise.resolve();
    });
    await screen.findByRole('heading', { name: 'Class is over' });
    await user.click(screen.getByRole('button', { name: 'Exit Present' }));
    await screen.findByRole('heading', { name: 'Register your block first' });
    expect(document.activeElement).toBe(
      screen.getByRole('heading', { level: 1, name: 'Biology, period 3' }),
    );
  });
});

/*
 * End session asks first, in a dialog (GA6; the audit's C2-01: one click ended class for every
 * phone, with no undo), as GA1's option A draws it (GA1AClassLive, GA1APresent, GA1AStates; the
 * owner's approval of 2026-11-01, in the owner's words), on the class page and in Present alike.
 * Once ended, focus goes to the class's name (the audit's C2-02, End session's part). jsdom draws a
 * `<dialog>` but has no `showModal` or `close`, nor the browser's Escape on a modal: the stand-ins
 * below do what the browser does, no more. The page sits in a `<main>`, as the shell's (PagePlace).
 */
describe('End session asks first, in a dialog (GA6)', () => {
  const LINE = 'Every student’s apps come back, and you can’t undo this.'.replaceAll('’', "'");

  /** The browser's Escape on an open modal: `cancel`, then closed unless that was prevented. */
  function escape(e: KeyboardEvent) {
    const open = document.querySelector<HTMLDialogElement>('dialog[open]');
    if (e.key !== 'Escape' || !open) return;
    const cancel = new Event('cancel', { cancelable: true });
    open.dispatchEvent(cancel);
    if (!cancel.defaultPrevented) open.close();
  }
  const showModal = Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, 'showModal');
  const close = Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, 'close');
  beforeAll(() => {
    HTMLDialogElement.prototype.showModal = function (this: HTMLDialogElement) {
      this.setAttribute('open', '');
    };
    HTMLDialogElement.prototype.close = function (this: HTMLDialogElement) {
      if (!this.open) return;
      this.removeAttribute('open');
      this.dispatchEvent(new Event('close'));
    };
    document.addEventListener('keydown', escape);
  });
  afterAll(() => {
    document.removeEventListener('keydown', escape);
    for (const [name, was] of [
      ['showModal', showModal],
      ['close', close],
    ] as const) {
      if (was) Object.defineProperty(HTMLDialogElement.prototype, name, was);
      else delete (HTMLDialogElement.prototype as Partial<HTMLDialogElement>)[name];
    }
  });
  afterEach(() => vi.useRealTimers());

  /** The confirm, found by its title: the class page's only dialog while a session runs. */
  const confirm = () => screen.getByRole('dialog', { name: 'End session now?' });
  const inConfirm = (name: string) => within(confirm()).getByRole('button', { name });
  /** Chrome's second Escape with no click between: a `cancel` that can't be held, then closed. */
  const chromeCloses = () =>
    act(async () => {
      const dialog = confirm() as HTMLDialogElement;
      dialog.dispatchEvent(new Event('cancel'));
      dialog.close();
      await Promise.resolve();
    });
  const endsSent = () => bali.sent.filter(({ path }) => path.endsWith('/end'));
  /** The class's name, the page's heading, on the page after the bell and on Present's. */
  const name = () => screen.getByRole('heading', { level: 1, name: 'Biology, period 3' });

  /** The page live, its grid read, Present on or off; End session in its header, at rest. */
  async function live(present: boolean) {
    if (present) sessionStorage.setItem(`bali.present.${bali.CLASS}`, 'on');
    const user = userEvent.setup();
    render(
      <main>
        <ClassDetailPage />
      </main>,
    );
    await screen.findByText('Ana Rodríguez');
    await vi.waitFor(() => expect(bali.streams).toHaveLength(1));
    const end = screen.getByRole('button', { name: 'End session' });
    return { user, end };
  }

  /** The End on its way now, answered with its JSON and `status`, what it set off drawn. */
  async function answerEnd(status: number, body: unknown) {
    const end = bali.ends.at(-1);
    if (!end) throw new Error('no End on its way');
    await act(async () => {
      end.answer(Response.json(body, { status }));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }

  /** Over: the page after the bell (ClassEnded), or Present's Class is over (PresentEnded). */
  async function ended(present: boolean) {
    if (present) await screen.findByRole('heading', { name: 'Class is over' });
    else await screen.findByRole('button', { name: /^Start \d+-minute session$/ });
    expect(screen.queryByText('End session now?')).toBeNull();
    expect(screen.queryByRole('button', { name: 'End session' })).toBeNull();
    // Focus on the class's name, never left on the page's body.
    await vi.waitFor(() => expect(document.activeElement).toBe(name()));
    expect(name().getAttribute('tabindex')).toBe('-1');
  }

  for (const present of [false, true]) {
    const where = present ? ', in Present' : '';

    it(`opens on End session and sends nothing, Cancel focused; Cancel and Escape close it, focus back on End session${where}`, async () => {
      const { user, end } = await live(present);
      expect(end.getAttribute('aria-haspopup')).toBe('dialog');
      expect(screen.queryByRole('dialog')).toBeNull();

      await user.click(end);
      // v2's dialog, New code's, titled and described in the owner's words, saying nothing about
      // any student: the room sees it in Present.
      expect(confirm().tagName).toBe('DIALOG');
      expect(confirm().className).toBe(DIALOG);
      expect(screen.getByRole('dialog', { description: LINE })).toBe(confirm());
      expect(confirm().textContent).toBe(`End session now?${LINE}CancelEnd session`);
      expect(document.activeElement).toBe(inConfirm('Cancel'));
      // Cancel secondary, End session the primary green: nothing red.
      expect(inConfirm('Cancel').classList).toContain('border-border-strong');
      expect(inConfirm('End session').classList).toContain('bg-action-primary-bg');
      expect(confirm().innerHTML).not.toMatch(/destructive|red-/);
      expect(within(confirm()).queryByRole('alert')).toBeNull();
      expect(endsSent()).toEqual([]);

      await user.click(inConfirm('Cancel'));
      expect(screen.queryByRole('dialog')).toBeNull();
      expect(document.activeElement).toBe(end);

      await user.click(end);
      expect(document.activeElement).toBe(inConfirm('Cancel'));
      await user.keyboard('{Escape}');
      expect(screen.queryByRole('dialog')).toBeNull();
      expect(document.activeElement).toBe(end);

      // +5 and +10 stay as they are, and the class runs on: nothing was sent.
      expect(screen.getByRole('button', { name: '+5 min' })).toBeDefined();
      expect(screen.getByRole('button', { name: '+10 min' })).toBeDefined();
      expect(endsSent()).toEqual([]);
      expect(bali.unexpected).toEqual([]);
    });

    it(`sends the end once from its End session, Ending… holding Cancel and Escape; ended, focus on the class’s name${where}`, async () => {
      const { user, end } = await live(present);
      await user.click(end);
      const send = inConfirm('End session');
      await user.click(send);

      expect(endsSent()).toEqual([
        { method: 'POST', path: `/v1/sessions/${bali.SESSION}/end`, body: null },
      ]);
      // One button throughout, so focus stays on it: Ending… while the end is on its way.
      expect(inConfirm('Ending…')).toBe(send);
      expect(send.getAttribute('aria-busy')).toBe('true');
      expect(send.getAttribute('aria-disabled')).toBe('true');
      expect(inConfirm('Cancel').getAttribute('aria-disabled')).toBe('true');
      // A second press, Cancel and Escape: nothing sent, the confirm kept.
      await user.click(send);
      await user.click(inConfirm('Cancel'));
      await user.keyboard('{Escape}');
      expect(confirm()).toBeDefined();
      expect(endsSent()).toHaveLength(1);

      await answerEnd(200, { outcome: 'ended', endedParticipations: 1 });
      await ended(present);
      expect(endsSent()).toHaveLength(1);
      expect(bali.unexpected).toEqual([]);
    });

    it(`says no answer in the confirm after a save’s 10 s, Try again in End session’s place sending the end again${where}`, async () => {
      const { user, end } = await live(present);
      await user.click(end);
      const send = inConfirm('End session');
      send.focus();
      // The End's time limit on a fake clock: no answer at all.
      vi.useFakeTimers();
      fireEvent.click(send);
      await act(() => vi.advanceTimersByTimeAsync(SAVE_TIMEOUT_MS - 1));
      expect(inConfirm('Ending…')).toBe(send);
      expect(within(confirm()).queryByRole('alert')).toBeNull();
      await act(() => vi.advanceTimersByTimeAsync(1));
      vi.useRealTimers();

      // Today's line, in the confirm, under its own; Try again in End session's place, focused.
      const line = within(confirm()).getByRole('alert');
      expect(line.textContent).toBe(CANT_REACH);
      expect(confirm().textContent).toBe(`End session now?${LINE}${CANT_REACH}CancelTry again`);
      expect(inConfirm('Try again')).toBe(send);
      expect(document.activeElement).toBe(send);
      expect(inConfirm('Cancel').getAttribute('aria-disabled')).toBe('false');
      expect(captureApiFailure).toHaveBeenCalledWith(
        'POST',
        `/v1/sessions/${bali.SESSION}/end`,
        'network',
      );
      // Nothing said beside the controls: the confirm says it.
      expect(screen.getAllByRole('alert')).toEqual([line]);

      // Try again sends the end again, the line going while it is on its way.
      await user.click(send);
      expect(endsSent()).toHaveLength(2);
      expect(endsSent()[1]).toEqual(endsSent()[0]);
      expect(inConfirm('Ending…')).toBe(send);
      expect(within(confirm()).queryByRole('alert')).toBeNull();

      // The first had landed: answered as already ended, and the page goes on as it would.
      await answerEnd(200, { outcome: 'already_ended', endedParticipations: 0 });
      await ended(present);
      expect(bali.unexpected).toEqual([]);
    });

    it(`closes on Cancel after a failure, focus on End session, and opens afresh${where}`, async () => {
      const { user, end } = await live(present);
      await user.click(end);
      await user.click(inConfirm('End session'));
      await act(async () => {
        bali.ends[0]?.fail();
        await new Promise((resolve) => setTimeout(resolve, 0));
      });
      expect(within(confirm()).getByRole('alert').textContent).toBe(CANT_REACH);

      await user.click(inConfirm('Cancel'));
      expect(screen.queryByRole('dialog')).toBeNull();
      expect(document.activeElement).toBe(end);
      expect(screen.queryByRole('alert')).toBeNull();

      await user.click(end);
      expect(within(confirm()).queryByRole('alert')).toBeNull();
      expect(inConfirm('End session')).toBeDefined();
      expect(document.activeElement).toBe(inConfirm('Cancel'));
      expect(endsSent()).toHaveLength(1);
    });

    // Chrome closes a modal on a second Escape with no click between, its `cancel` one that can't
    // be held (GA6's review): focus then on End session, held, never the page's body, until Bali's
    // answer says what follows (GA4).
    it(`keeps focus on End session when Chrome’s second Escape closes it while Ending…, then goes on as the answer says${where}`, async () => {
      const { user, end } = await live(present);
      await user.click(end);
      await user.click(inConfirm('End session'));
      await user.keyboard('{Escape}');
      expect(inConfirm('Ending…')).toBeDefined();
      await chromeCloses();
      expect(screen.queryByRole('dialog')).toBeNull();
      expect(document.activeElement).toBe(end);
      expect(end.getAttribute('aria-disabled')).toBe('true');
      expect(endsSent()).toHaveLength(1);

      await answerEnd(200, { outcome: 'ended', endedParticipations: 1 });
      await ended(present);
    });

    it(`opens the confirm again to say an end that failed after Chrome’s second Escape closed it${where}`, async () => {
      const { user, end } = await live(present);
      await user.click(end);
      await user.click(inConfirm('End session'));
      await user.keyboard('{Escape}');
      await chromeCloses();
      expect(document.activeElement).toBe(end);
      await act(async () => {
        bali.ends[0]?.fail();
        await new Promise((resolve) => setTimeout(resolve, 0));
      });
      expect(within(confirm()).getByRole('alert').textContent).toBe(CANT_REACH);
      expect(inConfirm('Try again')).toBeDefined();
      expect(document.activeElement).not.toBe(document.body);
    });

    it(`goes with the live page when the bell ends the session while it is open, focus on the class’s name${where}`, async () => {
      const { user, end } = await live(present);
      await user.click(end);
      expect(document.activeElement).toBe(inConfirm('Cancel'));
      await act(async () => {
        bali.streams[0]?.onEvent({
          seq: 5,
          eventId: '019a0000-0000-7000-8000-000000000105',
          type: 'session_expired',
          userId: null,
          occurredAt: new Date().toISOString(),
          payload: {},
        });
        await Promise.resolve();
      });
      await ended(present);
      expect(endsSent()).toEqual([]);
    });
  }
});

/*
 * The live lesson and the lessons switch (LO1; ARCHITECTURE, Web portal, decision 8). The class
 * page is rebuilt from the lock-only canvas since LO5, and Present since LO9, neither drawing a
 * lesson piece, so neither shows one whichever way the switch is set, and nothing of a lesson is
 * read: a question or a slide the session has open, or the stream names, included. Converted from
 * the source text of `app/present.test.ts` and `components/question-card.test.ts` (LO1, LO9).
 */
describe('no lesson piece on the class page or in Present, lessons on and off (LO1, LO5, LO9)', () => {
  const QUESTION: TeacherQuestion = {
    id: '019a0000-0000-7000-8000-00000000a001',
    prompt: 'Which value of x solves x² − 5x + 6 = 0?',
    options: ['x = 1', 'x = 2', 'x = 4', 'x = 6'],
    correctOption: 1,
    revealed: false,
    open: true,
  };
  const DECK: Deck = {
    id: '019a0000-0000-7000-8000-00000000d001',
    title: 'Factoring quadratics',
    status: 'ready',
    bytes: 1_048_576,
    sha256: 'a'.repeat(64),
    pageCount: 12,
    rejection: null,
    createdAt: '2026-10-06T15:00:00.000Z',
  };
  /** Its first page, shown by the slide change `SHOWN`. */
  const SHOWN = '019a0000-0000-7000-8000-00000000e001';
  const SLIDE = { deckId: DECK.id, sha256: DECK.sha256, page: 1, pageCount: 12 };

  /** The stream's word of a lesson's change, its `seq` past the read's newest (4). */
  const said = (
    seq: number,
    type: 'question_opened' | 'question_closed' | 'slide_shown',
    payload: object,
  ) => ({
    seq,
    eventId: `019a0000-0000-7000-8000-00000000e${String(seq).padStart(3, '0')}`,
    type,
    userId: null,
    occurredAt: new Date().toISOString(),
    payload,
  });
  const bring = (e: FeedEvent) =>
    act(async () => {
      bali.streams[0]?.onEvent(e);
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
  /** Every answer the page has asked for so far, in and drawn. */
  const settle = () => act(() => new Promise((resolve) => setTimeout(resolve, 20)));

  /** The page live, its reads in and its stream open, Present on or off as this tab left it. */
  async function live(present = false) {
    if (present) sessionStorage.setItem(`bali.present.${bali.CLASS}`, 'on');
    const user = userEvent.setup();
    render(
      <main>
        <ClassDetailPage />
      </main>,
    );
    await screen.findByRole('heading', { level: 1, name: 'Biology, period 3' });
    await vi.waitFor(() => expect(bali.streams).toHaveLength(1));
    await settle();
    return user;
  }
  /** The class page's count, Check on over the room (ClassLive). */
  const theCount = () => screen.queryByRole('region', { name: /^\d+ of \d+ focused$/ });
  /** The session's reads: the grid's snapshot, and a lesson's of what it has open. */
  const sessionReads = () =>
    bali.sent.filter(
      ({ method, path }) => method === 'GET' && path === `/v1/sessions/${bali.SESSION}`,
    ).length;
  /** Every lesson read the page has sent: a question's totals, the decks, the teacher's questions. */
  const lessonReads = () =>
    bali.sent.filter(({ path }) => /^\/v1\/(questions|decks|saved-questions)\b/.test(path));

  for (const lessons of ['on', 'off'] as const) {
    for (const present of [false, true]) {
      const where = present ? 'in Present' : 'on the class page';
      it(`shows no lesson piece ${where} with lessons ${lessons}, and reads none, a question and a slide open included`, async () => {
        if (lessons === 'off') vi.stubEnv('NEXT_PUBLIC_LESSONS', 'off');
        bali.lesson.question = QUESTION;
        bali.lesson.decks = [DECK];
        bali.lesson.presentation = { slide: SLIDE, eventId: SHOWN };
        await live(present);
        // The room, as each draws it: the class page's count over Check on and the room with
        // nothing between them, or Present's band over the room.
        if (present) {
          expect(screen.getByRole('heading', { level: 2, name: '1 of 1 focused' })).toBeTruthy();
          expect(screen.getByRole('list', { name: 'Everyone in the class' })).toBeTruthy();
        } else {
          const room = screen.getByRole('region', { name: 'Everyone' });
          expect(theCount()?.nextElementSibling).toBe(room);
        }
        const nothing = () => {
          expect(screen.queryByText(QUESTION.prompt)).toBeNull();
          expect(screen.queryByText(/^Question\b|answered|of 12|Slides · showing/)).toBeNull();
          expect(screen.queryByRole('region', { name: 'Questions and slides' })).toBeNull();
          for (const name of ['Ask a question', 'Show slides', 'Done', 'Close']) {
            expect(screen.queryByRole('button', { name }), name).toBeNull();
          }
        };
        nothing();
        // The stream names a question and a slide change: neither is read, nor shown.
        await bring(said(5, 'question_opened', { question_id: QUESTION.id }));
        await bring(said(6, 'slide_shown', { deck_id: DECK.id, page: 2 }));
        nothing();
        // The session read once, the grid's own; nothing of a lesson asked.
        expect(sessionReads()).toBe(1);
        expect(lessonReads()).toEqual([]);
        expect(bali.unexpected).toEqual([]);
      });
    }
  }

  it('turns Present on and off with the grid kept, one stream throughout (PV9, LO9)', async () => {
    const user = await live();
    expect(theCount()).not.toBeNull();
    await user.click(screen.getByRole('button', { name: 'Present' }));
    // The projector: its band's count over the room, never the class page's count or Check on.
    const exit = screen.getByRole('button', { name: 'Exit Present' });
    expect(exit.getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByRole('heading', { level: 2, name: '1 of 1 focused' })).toBeTruthy();
    expect(theCount()).toBeNull();
    expect(screen.queryByText(/^Check on/)).toBeNull();
    expect(screen.getByText('Ana Rodríguez')).toBeTruthy();

    await user.click(exit);
    expect(theCount()).not.toBeNull();
    expect(screen.queryByRole('button', { name: 'Exit Present' })).toBeNull();
    expect(bali.streams).toHaveLength(1);
    expect(bali.unexpected).toEqual([]);
  });
});
