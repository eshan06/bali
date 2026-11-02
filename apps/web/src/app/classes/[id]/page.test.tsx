// @vitest-environment jsdom
import type { ClassDetail, FeedEvent, RosterResponse, SessionSnapshot } from '@bali/shared';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { DIALOG } from '@/components/join-code';
import { type ApiClient, createApiClient, SAVE_TIMEOUT_MS } from '@/lib/api-client';
import { CANT_REACH } from '@/lib/errors';
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
   * Whether the class's session runs yet: none until a Start, when a test says so; and whether a
   * Start's answer waits for the test to give it (`starts`).
   */
  const now = { running: true, holdStart: false };
  const starts: (() => void)[] = [];
  const answer = (method: string, path: string): [number, unknown] => {
    if (method === 'GET' && path === `/v1/classes/${CLASS}`) {
      return [200, now.running ? klass : { ...klass, liveSessionId: null }];
    }
    if (method === 'POST' && path === `/v1/classes/${CLASS}/sessions`) {
      now.running = true;
      return [201, { outcome: 'created', session: snapshot.session, armedConverted: 0 }];
    }
    if (method === 'GET' && path === `/v1/classes/${CLASS}/roster`) return [200, roster];
    if (method === 'GET' && path === `/v1/sessions/${SESSION}`) return [200, snapshot];
    if (method === 'POST' && path === `/v1/sessions/${SESSION}/extend`) return [409, tooLong];
    // The student panel's read of the session's moments (PV11a): none yet.
    const moments = new RegExp(`^/v1/sessions/${SESSION}/events\\?after=(\\d+)$`).exec(path);
    if (method === 'GET' && moments) return [200, { events: [], nextAfter: Number(moments[1]) }];
    // After the bell, the recap's read of the last session (PV12b): none to show here.
    if (method === 'GET' && path === `/v1/classes/${CLASS}/reports/sessions?limit=1`) {
      return [200, { sessions: [], nextBefore: null }];
    }
    unexpected.push(`${method} ${path}`);
    return [404, { error: { code: 'not_found', message: 'not found' } }];
  };
  /** Each End on its way, its answer the test's to give, or no answer at all (its time limit). */
  const ends: { answer: (res: Response) => void; fail: () => void }[] = [];
  /** `fetch`, answered at once as Bali would answer it; an End when the test says. */
  const fetch = (url: string | URL | Request, init?: RequestInit) => {
    const method = init?.method ?? 'GET';
    const path = (url as string).replace('http://api', '');
    const body = typeof init?.body === 'string' ? (JSON.parse(init.body) as unknown) : null;
    if (method === 'POST' && path === `/v1/sessions/${SESSION}/end`) {
      sent.push({ method, path, body });
      return new Promise<Response>((answer, reject) => {
        const fail = () => reject(new TypeError('Failed to fetch'));
        init?.signal?.addEventListener('abort', fail);
        ends.push({ answer, fail });
      });
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
    starts,
    sent,
    unexpected,
    ends,
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
  bali.now.running = true;
  bali.now.holdStart = false;
  bali.starts.length = 0;
  bali.sent.length = 0;
  bali.unexpected.length = 0;
  bali.streams.length = 0;
  bali.ends.length = 0;
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
    // Beside her tile's pulse (bali-softpulse), which the same live unlock starts.
    const anasTile = screen.getByRole('button', { name: /^Ana Rodríguez/ });
    expect(anasTile.querySelector('.animate-softpulse')).not.toBeNull();
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
    // Her tile says Unlocked, as the replay applies it, and doesn't pulse.
    const anasTile = screen.getByRole('button', { name: /^Ana Rodríguez/ });
    expect(anasTile.textContent).toMatch(/Unlocked/);
    expect(anasTile.querySelector('.animate-softpulse')).toBeNull();
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
      expect(screen.queryByText(/used Emergency Unlock/)).toBeNull();
      expect(document.activeElement).toBe(screen.getByRole('button', { name: /^Ana Rodríguez/ }));
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
