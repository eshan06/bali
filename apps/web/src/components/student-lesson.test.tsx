// @vitest-environment jsdom
import type { MeResponse, Presentation, StudentQuestion } from '@bali/shared';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { isValidElement } from 'react';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import Route from '@/app/lessons/[classId]/[sessionId]/page';
import { createApiClient } from '@/lib/api-client';
import { bellTime } from '@/lib/session-controls';
import type { LessonView, Said, Sending, StudentClass } from '@/lib/student-web';
import type { DeckState } from '@/lib/use-slide';

import { Shell } from './shell';
import { StudentLesson, StudentLessonPage } from './student-lesson';

/*
 * A student's lesson (W4, W5) as a student meets it (the owner's decision of 2026-10-22: the
 * portal's tests drive the page), the boards' sample data in it: StudentLesson's (Biology, period 3
 * with Ms. Rivera, 23:14 left to a 9:55 bell, its question answered B, the phone focused),
 * StudentNotIn, StudentClosed, StudentWaiting, StudentEnded, StudentPhoneStates and StudentStates'
 * lines; and the states drawn first on the canvas, StudentNoSlide, StudentCardStates and
 * StudentChipStates. The question card says less since the owner's cut of 2026-11-04 (WC7): no line
 * under an open question's answers while none is picked, and no privacy line under any card.
 *
 * The lesson is rendered from what its page hands it; the page itself is driven in the shell, as the
 * root layout holds it, Bali's answers a stand-in `fetch`'s under the portal's own API client, on a
 * fake clock. jsdom has no ResizeObserver, no `showModal` and no full screen: the stand-ins below do
 * what the browser does, no more. The slide's deck loads through a stand-in for `loadDeck`, its
 * bytes and PDF.js `deck-pdf`'s own tests'.
 */

const bali = vi.hoisted(() => {
  /** One request the page sent: what it asked, and its answer, Bali's or the test's to give. */
  interface Call {
    method: string;
    path: string;
    body: unknown;
    /** The `If-None-Match` it carried. */
    etag: string | null;
    answer: (status: number, json?: unknown, headers?: Record<string, string>) => void;
    fail: () => void;
  }
  type Reply = [status: number, json?: unknown, headers?: Record<string, string>];
  const state = {
    calls: [] as Call[],
    /** Bali's answer to a request, or null to hold it for the test to answer. */
    reply: (() => null) as (call: Call) => Reply | null,
    /** Each deck the page loaded: the slide it named, its stop, and how it ends, the test's. */
    loads: [] as { slide: unknown; signal: AbortSignal | undefined; end: (end: unknown) => void }[],
    router: { replace: vi.fn(), push: vi.fn() },
    path: '/',
    notFound: vi.fn((): never => {
      throw new Error('not found');
    }),
    client: null as ReturnType<typeof import('@/lib/api-client').createApiClient> | null,
    fetch: (url: string | URL | Request, init?: RequestInit) =>
      new Promise<Response>((resolve, reject) => {
        const headers = (init?.headers ?? {}) as Record<string, string>;
        const call: Call = {
          method: init?.method ?? 'GET',
          path: (url as string).replace('http://api', ''),
          body: typeof init?.body === 'string' ? (JSON.parse(init.body) as unknown) : null,
          etag: headers['if-none-match'] ?? null,
          answer: (status, json, extra = {}) =>
            resolve(
              new Response(json === undefined ? null : JSON.stringify(json), {
                status,
                headers: { 'content-type': 'application/json', ...extra },
              }),
            ),
          fail: () => reject(new TypeError('Failed to fetch')),
        };
        init?.signal?.addEventListener('abort', () =>
          reject(new DOMException('The operation was aborted.', 'AbortError')),
        );
        state.calls.push(call);
        const now = state.reply(call);
        if (now) call.answer(...now);
      }),
  };
  return state;
});

vi.mock('next/navigation', () => ({
  notFound: bali.notFound,
  usePathname: () => bali.path,
  useRouter: () => bali.router,
}));
vi.mock('@/lib/auth', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/auth')>()),
  getAccessToken: () => 'token',
}));
vi.mock('@/lib/use-api', () => ({ useApi: () => bali.client, useSignOut: () => () => undefined }));
vi.mock('@/lib/monitoring', () => ({ captureApiFailure: vi.fn() }));
vi.mock('@/lib/deck-pdf', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/deck-pdf')>()),
  loadDeck: (_api: unknown, slide: unknown, opts: { signal?: AbortSignal } = {}) =>
    new Promise((end) => bali.loads.push({ slide, signal: opts.signal, end })),
}));

/** The browser's ResizeObserver, which jsdom lacks: it lays nothing out, so it reports no size. */
class NoLayout {
  observe() {}
  unobserve() {}
  disconnect() {}
}
beforeAll(() => vi.stubGlobal('ResizeObserver', NoLayout));
afterAll(() => vi.unstubAllGlobals());

afterEach(() => {
  // Focus off first, so no Try again unmounted here hands focus on in the next test's page.
  if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
  cleanup();
  vi.useRealTimers();
  bali.calls.length = 0;
  bali.loads.length = 0;
  bali.reply = () => null;
  bali.router.replace.mockClear();
  bali.notFound.mockClear();
});

const STARTED = '2026-10-12T14:05:00.000Z';
const BELL = '2026-10-12T14:55:00.000Z';
/** 23:14 before the bell, as StudentLesson draws it. */
const NOW = Date.parse(BELL) - (23 * 60 + 14) * 1000;
const QUESTION = '01924b2c-0000-7000-8000-000000000003';
const SESSION = '01924b2c-0000-7000-8000-000000000001';
const bell = { id: SESSION, startedAt: STARTED, endsAt: BELL };
const biology: StudentClass = {
  id: 'bio',
  name: 'Biology, period 3',
  teacher: { displayName: 'Ms. Rivera' },
  enrollmentId: 'e-bio',
  liveSession: bell,
};
const PROMPT = 'Which value of x solves x² − 5x + 6 = 0?';
const OPTIONS = ['x = 1', 'x = 2', 'x = 4', 'x = 6'];
const question = (over: Partial<StudentQuestion> = {}): StudentQuestion => ({
  id: QUESTION,
  prompt: PROMPT,
  options: OPTIONS,
  open: true,
  correctOption: null,
  answer: null,
  ...over,
});
const HELD = '01924b2c-0000-7000-8000-00000000000a';
const yours = (option: number) => ({ option, eventId: HELD });
const SHA = 'ab'.repeat(32);
const slide = { deckId: 'd1', sha256: SHA, page: 4, pageCount: 12 };
/** 9:41, the last good read's time while reads fail, as StudentPhoneStates draws it. */
const AS_OF = Date.parse(BELL) - 14 * 60_000;
const live = (over: Partial<Presentation> = {}, behind = false, klass = biology): LessonView => ({
  kind: 'live',
  klass,
  bell,
  presentation: {
    running: true,
    question: null,
    slide: null,
    phone: { state: 'focused', lastSeenAt: null },
    ...over,
  },
  behind,
  asOf: behind ? AS_OF : null,
});

/** What the page hands the lesson besides its view: an answer on its way or said, its deck. */
interface Given {
  sending?: Sending;
  said?: Said;
  /** The slide's deck as the page first holds it (W5): loading. */
  deck?: DeckState;
  held?: boolean;
}

/** The lesson as its page draws `view`, in the shell's `<main>` (PagePlace). */
const lesson = (
  view: LessonView,
  { sending = null, said = null, deck, held = false }: Given = {},
) => (
  <main>
    <StudentLesson
      view={view}
      held={held}
      deck={deck ?? { kind: 'loading' }}
      onReloadDeck={() => undefined}
      sending={sending}
      said={said}
      onPick={() => undefined}
      onRetry={() => undefined}
    />
  </main>
);

/** The lesson drawn at `now` (23:14 before the bell), this computer's clock held there. */
function show(view: LessonView, given: Given = {}, now = NOW) {
  vi.useFakeTimers({ now });
  return render(lesson(view, given));
}

/** The words a person reads, in the page's order: each run between two tags on its own. */
function words(root: Element = document.body): string[] {
  const out: string[] = [];
  let run = '';
  const flush = () => {
    if (run.trim() !== '') out.push(run);
    run = '';
  };
  const walk = (node: Node) => {
    for (const child of Array.from(node.childNodes)) {
      if (child.nodeType === Node.TEXT_NODE) run += child.textContent ?? '';
      else if (child.nodeType === Node.ELEMENT_NODE) {
        flush();
        walk(child);
        flush();
      }
    }
  };
  walk(root);
  flush();
  return out;
}

/** The lesson's page: what its `<main>` holds. */
const page = () => document.querySelector('main > div') as HTMLElement;
/** The question card, a region named by its question. */
const card = () => screen.getByRole('region', { name: PROMPT });
/** Each open answer: whether it is pressed, and whether it ends on a check. */
const buttons = (root: HTMLElement = card()) =>
  within(root)
    .queryAllByRole('button')
    .map((b) => ({
      pressed: b.getAttribute('aria-pressed') === 'true',
      checked: b.querySelector('.lucide-check') !== null,
    }));
/** Each closed answer's row: its classes and its words. */
const rows = (root: HTMLElement = card()) =>
  Array.from(root.querySelectorAll<HTMLElement>('div.min-h-13')).map((row) => ({
    classes: Array.from(row.classList),
    words: words(row),
  }));
/** The card's line under its answers, or the place it is said in. */
const line = () => card().querySelector<HTMLElement>('[aria-live="polite"]');

const HEAD = [
  'Biology, period 3',
  'with Ms. Rivera',
  '23:14',
  'ends ',
  bellTime(BELL),
  'Your phone',
  'Focused',
];
const ANSWERS = ['A', 'x = 1', 'B', 'x = 2', 'C', 'x = 4', 'D', 'x = 6'];
/** The slide's head (StudentLesson): which slide, and Full screen. */
const SLIDE = ['Slide 4 of 12', 'Full screen'];
const ANSWERED = 'Your answer is in. You can change it until the question closes.';
const NOTHING = 'Nothing shared yet. Slides and questions from your teacher show up here.';
const DIDNT = "Bali couldn't send your answer. Check your connection and pick it again.";
const TOO_LATE = "This question closed before your answer reached Bali, so it wasn't counted.";
/** The two lines the owner cut (2026-11-04), which no card says any more. */
const PICK = 'Pick an answer. You can change it until the question closes.';
const PRIVACY = "Your teacher sees the class's totals, never which answer is yours.";

describe('the lesson with a question (StudentLesson, StudentNoSlide)', () => {
  it('says the class’s head, then the card: its question, its answers and its line', () => {
    show(live({ question: question({ answer: yours(1) }) }));
    expect(words(page())).toEqual([...HEAD, 'Question', PROMPT, ...ANSWERS, ANSWERED]);
  });

  it('shows the answer Bali holds picked, the brand’s fill and a check, the rest to pick, no Submit', () => {
    show(live({ question: question({ answer: yours(1) }) }));
    expect(buttons()).toEqual([
      { pressed: false, checked: false },
      { pressed: true, checked: true },
      { pressed: false, checked: false },
      { pressed: false, checked: false },
    ]);
    const picked = within(card()).getByRole('button', { name: 'x = 2', pressed: true });
    expect(picked.getAttribute('type')).toBe('button');
    expect(Array.from(picked.classList)).toEqual(
      expect.arrayContaining([
        'min-h-13',
        'rounded-sm',
        'border-border-strong',
        'text-body-lg',
        'aria-pressed:bg-action-primary-bg',
        'aria-pressed:text-action-primary-fg',
        'aria-pressed:font-semibold',
      ]),
    );
    expect(screen.queryByRole('button', { name: /Submit/ })).toBeNull();
    expect(document.body.textContent).not.toMatch(/Submit/);
  });

  it('is v2’s lesson card, at its own width beside where a slide goes and a column of its own under 1024 px', () => {
    show(live({ question: question({ answer: yours(1) }) }));
    expect(card().tagName).toBe('SECTION');
    expect(card().className).toBe(
      'flex flex-col gap-3.5 rounded-live border border-border-default bg-surface-card p-5.5 shadow-1',
    );
    expect(card().parentElement?.className).toBe('lg:max-w-100');
  });

  it('never shows a count, nor anyone else’s answer: the read carries neither', () => {
    // Every word on the card is the question's, its letters or its line.
    show(live({ question: question({ answer: yours(1) }) }));
    expect(words(card())).toEqual(['Question', PROMPT, ...ANSWERS, ANSWERED]);
  });

  it('shows the card beside the slide, the card first in the page’s order at every width (StudentLesson, StudentZoom; W5)', () => {
    show(live({ question: question({ answer: yours(1) }), slide }));
    expect(words(page())).toEqual([
      ...HEAD,
      'Question',
      PROMPT,
      ...ANSWERS,
      ANSWERED,
      ...SLIDE,
      'Loading…',
    ]);
    // Beside the slide from 1024 px, its 25 rem column on the right; over it under 1024 px.
    const grid = card().parentElement?.parentElement;
    expect(grid?.className).toBe('grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_25rem]');
    expect(card().parentElement?.className).toBe('lg:col-start-2 lg:row-start-1');
    expect(grid?.firstElementChild).toBe(card().parentElement);
    expect(grid?.lastElementChild).toBe(screen.getByRole('region', { name: 'Slide 4 of 12' }));
    // Its question's heading, where focus comes once a question asked closes full screen.
    const heading = screen.getByRole('heading', { name: PROMPT });
    expect(heading.id).toMatch(/-question$/);
    expect(heading.getAttribute('tabindex')).toBe('-1');
    expect(heading.className).toMatch(/^mt-2 text-h3 /);
  });
});

describe('the question card, every state', () => {
  it('shows a pick on its way picked, and says so (StudentCardStates)', () => {
    const sending = { questionId: QUESTION, option: 3 };
    const { rerender } = show(live({ question: question({ answer: yours(1) }) }), { sending });
    expect(buttons().map((b) => b.pressed)).toEqual([false, false, false, true]);
    expect(line()?.textContent).toBe('Sending your answer…');
    // Another question's sending is none of this card's.
    rerender(lesson(live({ question: question() }), { sending: { questionId: 'q0', option: 3 } }));
    expect(buttons().some((b) => b.pressed)).toBe(false);
  });

  it('says an answer that didn’t send in the line’s place, the answer Bali holds left picked', () => {
    const said: Said = { questionId: QUESTION, said: 'failed' };
    const { rerender } = show(live({ question: question({ answer: yours(1) }) }), { said });
    const alert = within(card()).getByRole('alert');
    expect(alert.tagName).toBe('P');
    expect(alert.className).toBe('text-body');
    expect(alert.textContent).toBe(DIDNT);
    expect(words(card())).not.toContain(ANSWERED);
    expect(buttons().map((b) => b.pressed)).toEqual([false, true, false, false]);
    // Once closed there's no picking it again: the closed line in its place.
    rerender(lesson(live({ question: question({ open: false }) }), { said }));
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('says the answer is in once a read shows Bali holding an answer that said it didn’t send, or one after it (W4’s follow-up)', () => {
    const sent = '01924b2c-0000-7000-8000-00000000000b';
    const said: Said = { questionId: QUESTION, said: 'failed', eventId: sent };
    // Its reply lost, or later than 10 s: the read since shows it held under the id it went under.
    const { rerender } = show(
      live({ question: question({ answer: { option: 2, eventId: sent } }) }),
      {
        said,
      },
    );
    expect(screen.queryByRole('alert')).toBeNull();
    expect(line()?.textContent).toBe(ANSWERED);
    expect(buttons().map((b) => b.pressed)).toEqual([false, false, true, false]);
    // A pick on the phone since, its id after this one's: that answer is in.
    const later = { option: 3, eventId: '01924b2c-0000-7000-8000-00000000000c' };
    rerender(lesson(live({ question: question({ answer: later }) }), { said }));
    expect(line()?.textContent).toBe(ANSWERED);
    // Not yet: the read holds an older answer, or none.
    for (const answer of [yours(1), null]) {
      rerender(lesson(live({ question: question({ answer }) }), { said }));
      expect(within(card()).getByRole('alert').textContent).toBe(DIDNT);
    }
  });

  it('says a pick that reached Bali too late, on the closed card, until another question', () => {
    const said: Said = { questionId: QUESTION, said: 'too_late' };
    const { rerender } = show(live({ question: question({ open: false }) }), { said });
    const alert = within(card()).getByRole('alert');
    expect(alert.className).toBe('text-body');
    expect(alert.textContent).toBe(TOO_LATE);
    rerender(lesson(live({ question: question({ id: 'q2' }) }), { said }));
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('closes the card as Bali says too late, before a read shows it closed, the answer it holds marked', () => {
    const said: Said = { questionId: QUESTION, said: 'too_late' };
    show(live({ question: question({ answer: yours(3) }) }), { said });
    expect(buttons()).toEqual([]);
    expect(words(page())).toEqual([
      ...HEAD,
      'Question · closed',
      PROMPT,
      ...ANSWERS.slice(0, 6),
      'D',
      'x = 6',
      'Your answer',
      TOO_LATE,
    ]);
    // No answer marked correct until a read shows it.
    expect(rows()[1]?.classes).toEqual(expect.arrayContaining(['text-text-secondary']));
  });

  it('closed without the answer shown, marks nothing for a student who didn’t answer (StudentCardStates)', () => {
    show(live({ question: question({ open: false }) }));
    expect(words(page())).toEqual([
      ...HEAD,
      'Question · closed',
      PROMPT,
      ...ANSWERS,
      'Your teacher closed this question.',
    ]);
    expect(rows().map((r) => r.classes.includes('text-text-secondary'))).toEqual([
      true,
      true,
      true,
      true,
    ]);
  });

  it('marks the correct answer once shown, and the student’s own, never red (StudentClosed)', () => {
    show(live({ question: question({ open: false, correctOption: 1, answer: yours(3) }) }));
    expect(words(page())).toEqual([
      ...HEAD,
      'Question · closed',
      PROMPT,
      'A',
      'x = 1',
      'B',
      'x = 2',
      'Correct answer',
      'C',
      'x = 4',
      'D',
      'x = 6',
      'Your answer',
      'Your teacher closed it and showed the answer.',
    ]);
    expect(buttons()).toEqual([]);
    const [a, b, , d] = rows();
    expect(a?.classes).toEqual(expect.arrayContaining(['bg-surface-card', 'text-text-secondary']));
    expect(b?.classes).toEqual(
      expect.arrayContaining([
        'border-2',
        'border-bar-right',
        'bg-option-right',
        'text-text-primary',
      ]),
    );
    expect(d?.classes).toEqual(
      expect.arrayContaining(['bg-surface-sunken', 'border-border-strong', 'text-text-primary']),
    );
    const right = within(card()).getByText('Correct answer');
    expect(right.classList.contains('text-text-brand')).toBe(true);
    expect(right.firstElementChild?.classList.contains('lucide-circle-check')).toBe(true);
    const mine = within(card()).getByText('Your answer');
    expect(mine.classList.contains('text-state-notjoined-fg')).toBe(true);
    expect(document.body.innerHTML).not.toMatch(/red|revoked|destructive/);
  });

  it('puts both marks on one answer when the student’s was right (StudentCardStates)', () => {
    show(live({ question: question({ open: false, correctOption: 1, answer: yours(1) }) }));
    expect(rows()[1]?.words).toEqual(['B', 'x = 2', 'Correct answer', 'Your answer']);
    expect(words(page()).filter((w) => w === 'Your answer')).toHaveLength(1);
  });

  it('marks only the correct answer for a student who didn’t answer (StudentCardStates)', () => {
    show(live({ question: question({ open: false, correctOption: 2 }) }));
    expect(words(page())).not.toContain('Your answer');
    expect(rows()[2]?.words).toEqual(['C', 'x = 4', 'Correct answer']);
  });

  it('closed without the answer shown, marks only the student’s own (StudentCardStates)', () => {
    show(live({ question: question({ open: false, answer: yours(3) }) }));
    expect(words(page())).not.toContain('Correct answer');
    expect(rows()[3]?.words).toEqual(['D', 'x = 6', 'Your answer']);
    expect(words(page())).toContain('Your teacher closed this question.');
  });
});

describe('the owner’s two cuts (WC7; the owner, 2026-11-04)', () => {
  /** Every state of the card the boards draw, open and closed, with a slide and while behind. */
  const STATES: [string, LessonView, Given][] = [
    ['open, nothing picked (StudentNotIn)', live({ question: question() }), {}],
    ['open, answered (StudentLesson)', live({ question: question({ answer: yours(1) }) }), {}],
    [
      'an answer on its way',
      live({ question: question() }),
      { sending: { questionId: QUESTION, option: 1 } },
    ],
    [
      'an answer that didn’t send',
      live({ question: question() }),
      { said: { questionId: QUESTION, said: 'failed' } },
    ],
    [
      'too late',
      live({ question: question({ answer: yours(3) }) }),
      { said: { questionId: QUESTION, said: 'too_late' } },
    ],
    ['closed, nothing marked', live({ question: question({ open: false }) }), {}],
    [
      'closed, the answer not shown',
      live({ question: question({ open: false, answer: yours(3) }) }),
      {},
    ],
    [
      'closed, yours right',
      live({ question: question({ open: false, correctOption: 1, answer: yours(1) }) }),
      {},
    ],
    [
      'closed, the answer shown, yours not (StudentClosed)',
      live({ question: question({ open: false, correctOption: 1, answer: yours(3) }) }),
      {},
    ],
    [
      'closed, you didn’t answer',
      live({ question: question({ open: false, correctOption: 2 }) }),
      {},
    ],
    ['beside the slide', live({ question: question({ answer: yours(1) }), slide }), {}],
    ['while Bali can’t be reached', live({ question: question({ answer: yours(1) }) }, true), {}],
  ];

  it.each(STATES)('says no privacy line, with no icon or rule of its own: %s', (_, view, given) => {
    show(view, given);
    expect(document.body.textContent).not.toContain(PRIVACY);
    expect(document.body.textContent).not.toMatch(/sees the class.s totals|which answer is yours/);
    expect(document.querySelector('.lucide-eye-off')).toBeNull();
    // The card ends at its line: its question, its answers, the line (or its place), and no rule.
    expect(card().children).toHaveLength(3);
    expect(card().querySelector('.border-t')).toBeNull();
    // Nor the line the owner cut from an open question.
    expect(document.body.textContent).not.toContain(PICK);
  });

  it('says nothing under an open question’s answers while none is picked (StudentNotIn)', () => {
    show(live({ question: question() }));
    expect(words(card())).toEqual(['Question', PROMPT, ...ANSWERS]);
    expect(buttons().some((b) => b.pressed)).toBe(false);
    // The line's place is kept for a screen reader, out of the card's flow, so the card ends at its
    // answers as StudentNotIn draws it.
    expect(line()?.textContent).toBe('');
    expect(line()?.className).toBe('sr-only');
  });

  it('says an answer on its way in that place, one a screen reader was already watching', () => {
    const { rerender } = show(live({ question: question() }));
    const place = line();
    rerender(
      lesson(live({ question: question() }), { sending: { questionId: QUESTION, option: 1 } }),
    );
    expect(line()).toBe(place);
    expect(place?.textContent).toBe('Sending your answer…');
    expect(place?.className).toBe('text-caption text-text-tertiary');
  });

  it('keeps the answered card’s line exactly (the owner’s exception)', () => {
    show(live({ question: question({ answer: yours(1) }) }));
    expect(line()?.textContent).toBe(ANSWERED);
    expect(line()?.className).toBe('text-caption text-text-tertiary');
  });
});

describe('the lesson page while the class runs', () => {
  it('draws the head as ClassLive’s: the 44 px ring the session left, the countdown to the server’s bell (StudentLesson)', () => {
    show(live());
    const ring = document.querySelector('svg[width="44"]');
    expect(ring?.getAttribute('height')).toBe('44');
    expect(ring?.getAttribute('viewBox')).toBe('0 0 44 44');
    expect(ring?.getAttribute('aria-hidden')).toBe('true');
    const around = 2 * Math.PI * 19.5;
    const arc = (((23 * 60 + 14) / 3000) * around).toFixed(1);
    expect(ring?.querySelector('[stroke-dasharray]')?.getAttribute('stroke-dasharray')).toBe(
      `${arc} ${around.toFixed(1)}`,
    );
    expect(page().className).toBe('flex flex-col gap-5.5');
    const header = page().firstElementChild as HTMLElement;
    expect(header.tagName).toBe('HEADER');
    expect(header.className).toBe(
      'flex flex-wrap items-center gap-x-4.5 gap-y-3.5 max-sm:gap-x-3.5',
    );
    // Focusable from a script alone, for full screen's close (W5).
    const name = screen.getByRole('heading', { level: 1, name: 'Biology, period 3' });
    expect(name.id).toMatch(/-class$/);
    expect(name.getAttribute('tabindex')).toBe('-1');
    expect(name.className).toMatch(/^text-page-title /);
    expect(screen.getByText('with Ms. Rivera').className).toBe(
      'mt-0.5 text-meta text-text-secondary wrap-anywhere',
    );
    expect(screen.getByText('23:14').className).toBe('font-num text-data-lg tabular-nums');
    const time = header.querySelector(`time[datetime="${BELL}"]`);
    expect(time?.textContent).toBe(bellTime(BELL));
    expect(time?.parentElement?.textContent).toBe(`ends ${bellTime(BELL)}`);
    // The student's own phone at its end, on a line of its own on a phone, as ClassLive's controls.
    const phone = header.lastElementChild as HTMLElement;
    expect(phone.className).toBe(
      'ml-auto flex flex-wrap items-center gap-2 max-sm:ml-0 max-sm:basis-full',
    );
    const status = within(phone).getByRole('status');
    expect(status.className).toBe('inline-flex flex-wrap items-center gap-2');
    expect(words(status)).toEqual(['Your phone', 'Focused']);
  });

  it('says nothing is shared yet while no question or slide shows (StudentWaiting)', () => {
    show(live());
    expect(words(page())).toEqual([...HEAD, NOTHING]);
  });

  it('draws the slide alone while no question shows, at the width it has beside one (StudentSlideAlone, drawn first)', () => {
    show(live({ slide }));
    expect(words(page())).toEqual([...HEAD, ...SLIDE, 'Loading…']);
    // The grid's first column, the second left for a question, as v2.css's `.s-lesson` lays it.
    const shown = screen.getByRole('region', { name: 'Slide 4 of 12' });
    expect(shown.parentElement?.className).toBe(
      'grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_25rem]',
    );
    expect(shown.parentElement?.firstElementChild).toBe(shown);
    expect(document.body.textContent).not.toContain(NOTHING);
  });

  it('says Bali can’t be reached under the head, the lesson as last read under it (StudentStates, StudentCardStates)', () => {
    const BEHIND = "Can't reach Bali right now, so this page may be behind. It keeps trying.";
    // The phone's chip kept "as of" the last good read beside it (StudentPhoneStates).
    const AS_OF_WORDS = ['as of ', bellTime(new Date(AS_OF).toISOString())];
    const { rerender } = show(live({}, true));
    expect(words(page())).toEqual([...HEAD, ...AS_OF_WORDS, BEHIND, NOTHING]);
    const said = page().children[1];
    expect(said?.tagName).toBe('P');
    expect(said?.getAttribute('role')).toBe('status');
    expect(said?.className).toBe(
      'rounded-sm border border-border-default bg-surface-sunken px-4 py-3 text-body text-text-primary',
    );
    rerender(lesson(live({ question: question({ answer: yours(1) }) }, true)));
    expect(words(page())).toEqual([
      ...HEAD,
      ...AS_OF_WORDS,
      BEHIND,
      'Question',
      PROMPT,
      ...ANSWERS,
      ANSWERED,
    ]);
    expect(buttons().map((b) => b.pressed)).toEqual([false, true, false, false]);
    rerender(lesson(live()));
    expect(document.body.textContent).not.toMatch(/Can.t reach|as of/);
  });

  it('names a teacher with no name nowhere: the class alone', () => {
    const nameless = { ...biology, teacher: { displayName: '  ' } };
    show(live({}, false, nameless));
    expect(words(page())).toEqual([
      'Biology, period 3',
      '23:14',
      'ends ',
      bellTime(BELL),
      'Your phone',
      'Focused',
      NOTHING,
    ]);
  });
});

describe('the student’s own phone beside the class’s name (StudentPhoneStates, StudentChipStates)', () => {
  /** The phone's chip in the head: its classes, its icon's classes, its words. */
  const chip = () => {
    const status = screen.getByText('Your phone').parentElement as HTMLElement;
    const pill = status.children[1] as HTMLElement;
    return {
      classes: Array.from(pill.classList),
      icon: pill.querySelector('svg')?.getAttribute('class') ?? '',
      words: pill.textContent,
    };
  };
  /** The phone's line under the head: its icon's classes and its words, or none. */
  const phoneLine = () => {
    const under = page().children[1] as HTMLElement | undefined;
    if (
      under?.className !==
      'flex items-start gap-3 rounded-sm border border-border-default bg-surface-sunken px-4 py-3 text-body text-text-primary'
    ) {
      return null;
    }
    const p = under.querySelector('p');
    return { icon: under.querySelector('svg')?.getAttribute('class') ?? '', words: p?.textContent };
  };
  const NOT_IN = "You're not tapped in yet. Tap your teacher's block with your phone.";
  /** 9:41, three minutes after the phone last checked in at 9:38. */
  const SINCE = new Date(AS_OF - 3 * 60_000).toISOString();

  it('is Focused in focus’s green, with no line (StudentLesson)', () => {
    show(live());
    expect(chip()).toMatchObject({ words: 'Focused' });
    expect(chip().classes).toEqual(
      expect.arrayContaining([
        'rounded-full',
        'border-[1.5px]',
        'border-transparent',
        'bg-state-focused-bg',
        'text-state-focused-fg',
        'text-caption',
        'font-medium',
      ]),
    );
    expect(chip().icon).toMatch(/lucide-circle-check/);
    expect(phoneLine()).toBeNull();
  });

  it('is Not in, in not here’s grey, its line under the head saying to tap in (StudentNotIn)', () => {
    show(live({ phone: null, question: question() }));
    expect(chip()).toMatchObject({ words: 'Not in' });
    expect(chip().classes).toEqual(
      expect.arrayContaining(['bg-state-notjoined-bg', 'text-state-notjoined-fg']),
    );
    expect(chip().icon).toBe('lucide lucide-circle shrink-0');
    expect(phoneLine()).toEqual({
      icon: expect.stringMatching(/lucide-nfc/) as string,
      words: NOT_IN,
    });
    // Right under the head, then the card, which ends at its answers.
    expect(words(page())).toEqual([
      ...HEAD.slice(0, -1),
      'Not in',
      NOT_IN,
      'Question',
      PROMPT,
      ...ANSWERS,
    ]);
  });

  it('is Unlocked in emergency orange, its line naming the bell the account says', () => {
    show(live({ phone: { state: 'unlocked', lastSeenAt: null } }));
    expect(chip()).toMatchObject({ words: 'Unlocked' });
    expect(chip().classes).toEqual(
      expect.arrayContaining(['bg-state-emergency-bg', 'text-state-emergency-fg']),
    );
    expect(chip().icon).toMatch(/lucide-lock-open/);
    expect(phoneLine()).toEqual({
      icon: expect.stringMatching(/lucide-smartphone/) as string,
      words: `Everything on your phone is open until you lock your apps again in the Bali app, or until the bell at ${bellTime(BELL)}. Your teacher can see you unlocked.`,
    });
    expect(page().children[1]?.querySelector(`time[datetime="${BELL}"]`)?.textContent).toBe(
      bellTime(BELL),
    );
  });

  it('is Screen Time off in protection off’s red, its line saying how to turn it back on', () => {
    show(live({ phone: { state: 'protection_off', lastSeenAt: null } }));
    expect(chip()).toMatchObject({ words: 'Screen Time off' });
    expect(chip().classes).toEqual(
      expect.arrayContaining(['bg-state-revoked-bg', 'text-state-revoked-fg']),
    );
    expect(chip().icon).toMatch(/lucide-shield-off/);
    expect(phoneLine()).toEqual({
      icon: expect.stringMatching(/lucide-smartphone/) as string,
      words:
        "Screen Time is off for Bali, so no app on your phone is paused and your teacher sees that it's off. Open the Bali app on your phone to turn it back on.",
    });
  });

  it('is Silent with its minutes, dashed, never green, its line naming when Bali last heard from it', () => {
    show(live({ phone: { state: 'silent', lastSeenAt: SINCE } }), {}, AS_OF);
    expect(chip().words).toBe('Silent · 3 min');
    expect(chip().classes).toEqual(
      expect.arrayContaining([
        'border-dashed',
        'border-border-strong',
        'bg-state-ended-bg',
        'text-state-ended-fg',
      ]),
    );
    expect(chip().icon).toMatch(/lucide-wifi-off/);
    expect(phoneLine()).toEqual({
      icon: expect.stringMatching(/lucide-smartphone/) as string,
      words: `Bali hasn't heard from your phone since ${bellTime(SINCE)}, and your teacher sees that. Open the Bali app on your phone so it can check in.`,
    });
    expect(page().children[1]?.querySelector(`time[datetime="${SINCE}"]`)?.textContent).toBe(
      bellTime(SINCE),
    );
  });

  it('is the grid’s Unknown for a state this page has no chip for, with no line (StudentChipStates)', () => {
    const newer = { state: 'charging', lastSeenAt: null } as unknown as Presentation['phone'];
    show(live({ phone: newer }));
    expect(chip().words).toBe('Unknown · refresh');
    expect(chip().classes).toEqual(
      expect.arrayContaining([
        'border-dashed',
        'border-border-strong',
        'bg-state-nodevice-bg',
        'text-text-primary',
      ]),
    );
    expect(chip().icon).toMatch(/lucide-circle-question-mark|lucide-circle-help/);
    expect(phoneLine()).toBeNull();
  });

  it('keeps its state as of the last good read while Bali can’t be reached, Silent’s minutes stopped then (StudentPhoneStates, StudentChipStates)', () => {
    // Ten minutes on, still unreached: the chip says what the read at 9:41 said.
    show(live({ phone: { state: 'silent', lastSeenAt: SINCE } }, true), {}, AS_OF + 10 * 60_000);
    const asOf = new Date(AS_OF).toISOString();
    expect(chip().words).toBe('Silent · 3 min');
    // "as of" at the chip's end, the head's last words.
    const status = screen.getByText('Your phone').parentElement as HTMLElement;
    const kept = status.lastElementChild as HTMLElement;
    expect(kept.className).toBe('text-caption text-text-tertiary');
    expect(words(kept)).toEqual(['as of ', bellTime(asOf)]);
    expect(kept.querySelector('time')?.getAttribute('datetime')).toBe(asOf);
    expect(page().firstElementChild?.lastElementChild?.contains(kept)).toBe(true);
  });

  it('says the phone’s line, then that Bali can’t be reached, then the lesson as last read (StudentChipStates)', () => {
    show(live({ phone: null }, true));
    const asOf = new Date(AS_OF).toISOString();
    expect(words(page())).toEqual([
      ...HEAD.slice(0, -1),
      'Not in',
      'as of ',
      bellTime(asOf),
      NOT_IN,
      "Can't reach Bali right now, so this page may be behind. It keeps trying.",
      NOTHING,
    ]);
  });

  it('shows no phone once the class is over (StudentEnded)', () => {
    show({ kind: 'over', klass: biology, at: Date.parse(BELL) });
    expect(document.body.textContent).not.toMatch(/Your phone|Focused|Checking/);
  });
});

describe('the lesson page in its other states', () => {
  it('says class is over with its time, and leads back to Your classes (StudentEnded)', () => {
    show({ kind: 'over', klass: biology, at: Date.parse(BELL) });
    expect(words(page())).toEqual([
      'Biology, period 3',
      'with Ms. Rivera',
      'Class is over',
      'This class ended at ',
      bellTime(BELL),
      ". Slides and questions from it aren't available after class.",
      'Your classes',
    ]);
    // Over: no ring, no countdown, nothing of the lesson.
    expect(document.querySelector('svg')).toBeNull();
    expect(document.body.textContent).not.toMatch(/23:14|Nothing shared|Question/);
    const over = screen.getByRole('region', { name: 'Class is over' });
    expect(over.className).toBe(
      'flex max-w-160 flex-col items-start gap-3 rounded-md border border-border-default bg-surface-card p-5 shadow-1',
    );
    const title = screen.getByRole('heading', { name: 'Class is over' });
    expect(title.tagName).toBe('H2');
    expect(title.className).toBe('text-h3');
    expect(over.querySelector(`time[datetime="${BELL}"]`)?.textContent).toBe(bellTime(BELL));
    const back = within(over).getByRole('link', { name: 'Your classes' });
    expect(back.getAttribute('href')).toBe('/');
    expect(back.classList.contains('h-10')).toBe(true);
  });

  it('says class is over with no time when the page can’t vouch for one (StudentCardStates)', () => {
    show({ kind: 'over', klass: biology, at: null });
    expect(words(page())).toContain(
      "This class has ended. Slides and questions from it aren't available after class.",
    );
    expect(document.querySelector('time')).toBeNull();
  });

  it('says Loading… until the first read, and a read that failed with Try again (StudentStates)', () => {
    const { rerender } = show({ kind: 'loading' });
    expect(page().className).toBe('');
    expect(page().children).toHaveLength(1);
    const loading = screen.getByRole('status');
    expect(loading.className).toBe('text-body text-text-secondary');
    expect(loading.textContent).toBe('Loading…');
    rerender(lesson({ kind: 'failed' }));
    expect(page().className).toBe('flex flex-wrap items-center gap-x-4 gap-y-3');
    expect(words(page())).toEqual(["Bali couldn't load this lesson.", 'Try again']);
    const alert = screen.getByRole('alert');
    expect(alert.tagName).toBe('P');
    expect(alert.className).toBe('text-body');
    const again = screen.getByRole('button', { name: 'Try again' });
    expect(again.getAttribute('type')).toBe('button');
    expect(again.getAttribute('aria-disabled')).toBe('false');
    expect(again.getAttribute('aria-busy')).toBe('false');
    expect(again.classList.contains('h-8.5')).toBe(true);
  });

  it('keeps its failure said while Try again reads it again, held as Loading…, then lands focus on the class’s name (StudentRetryStates)', () => {
    const { rerender } = show({ kind: 'failed' });
    const again = screen.getByRole('button', { name: 'Try again' });
    again.focus();
    rerender(lesson({ kind: 'failed' }, { held: true }));
    expect(again.textContent).toBe('Loading…');
    expect(again.getAttribute('aria-disabled')).toBe('true');
    expect(again.getAttribute('aria-busy')).toBe('true');
    expect(again.hasAttribute('disabled')).toBe(false);
    expect(screen.getByRole('alert').textContent).toBe("Bali couldn't load this lesson.");
    expect(document.activeElement).toBe(again);
    // Read: focus on the class's name, the page's heading, as the next frame comes.
    rerender(lesson(live()));
    act(() => {
      vi.advanceTimersToNextFrame();
    });
    expect(document.activeElement).toBe(
      screen.getByRole('heading', { level: 1, name: 'Biology, period 3' }),
    );
  });

  it('lands focus on Your classes once Try again finds a class that isn’t the student’s, with no class’s name to land on (StudentRetryStates)', () => {
    const { rerender } = show({ kind: 'failed' });
    screen.getByRole('button', { name: 'Try again' }).focus();
    rerender(lesson({ kind: 'failed' }, { held: true }));
    rerender(lesson({ kind: 'not_in_class' }));
    act(() => {
      vi.advanceTimersToNextFrame();
    });
    expect(document.activeElement).toBe(screen.getByRole('link', { name: 'Your classes' }));
  });

  it('says a class the account doesn’t list isn’t the student’s, and leads to Your classes (StudentCardStates)', () => {
    show({ kind: 'not_in_class' });
    expect(page().className).toBe('flex flex-wrap items-center gap-x-4 gap-y-3');
    expect(words(page())).toEqual(["This lesson is for a class you're not in.", 'Your classes']);
    expect(screen.getByRole('alert').className).toBe('text-body');
    const back = screen.getByRole('link', { name: 'Your classes' });
    expect(back.getAttribute('href')).toBe('/');
    expect(back.classList.contains('h-8.5')).toBe(true);
  });
});

/*
 * Full screen (W5; PV1's StudentSlideFull): only on Full screen's press, the page itself full
 * screen where the browser allows it; left by the student, or closed by itself once a question is
 * asked, the slides stop or the class is over, focus where the student is now.
 */
describe('the slide in full screen (W5; PV1)', () => {
  /** The browser's full screen, which jsdom lacks: what it holds, entered and left as asked. */
  let full: Element | null = null;
  const requestFullscreen = vi.fn(() => {
    full = document.documentElement;
    document.dispatchEvent(new Event('fullscreenchange'));
    return Promise.resolve();
  });
  const exitFullscreen = vi.fn(() => {
    full = null;
    document.dispatchEvent(new Event('fullscreenchange'));
    return Promise.resolve();
  });
  const showModal = Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, 'showModal');
  beforeAll(() => {
    HTMLDialogElement.prototype.showModal = function (this: HTMLDialogElement) {
      this.setAttribute('open', '');
    };
    Object.defineProperty(document, 'fullscreenElement', { configurable: true, get: () => full });
    document.documentElement.requestFullscreen = requestFullscreen;
    document.exitFullscreen = exitFullscreen;
  });
  afterAll(() => {
    if (showModal) Object.defineProperty(HTMLDialogElement.prototype, 'showModal', showModal);
    else delete (HTMLDialogElement.prototype as Partial<HTMLDialogElement>).showModal;
    delete (document as Partial<Document> & { fullscreenElement?: unknown }).fullscreenElement;
    delete (document.documentElement as Partial<HTMLElement>).requestFullscreen;
    delete (document as Partial<Document>).exitFullscreen;
  });
  afterEach(() => {
    full = null;
    requestFullscreen.mockClear();
    exitFullscreen.mockClear();
  });

  /** The lesson with `view` drawn, Full screen pressed, the browser's answer in. */
  async function opened(view: LessonView = live({ slide })) {
    const shown = show(view);
    fireEvent.click(screen.getByRole('button', { name: 'Full screen' }));
    await act(() => Promise.resolve());
    return shown;
  }
  const dialog = () => screen.queryByRole('dialog');

  it('opens on Full screen’s press alone, the page itself full screen, focus on Exit full screen', async () => {
    show(live({ slide }));
    // Shut as the page first draws.
    expect(document.querySelector('dialog')).toBeNull();
    cleanup();
    await opened();
    expect(requestFullscreen).toHaveBeenCalledOnce();
    expect(full).toBe(document.documentElement);
    expect(screen.getByRole('dialog', { name: 'Slide 4 of 12' })).toBeTruthy();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Exit full screen' }));
  });

  it('turns with the teacher’s slide, and stays while the question it opened beside stays', async () => {
    const view = live({ question: question(), slide });
    const { rerender } = await opened(view);
    rerender(lesson(live({ question: question({ open: false }), slide: { ...slide, page: 5 } })));
    expect(screen.getByRole('dialog', { name: 'Slide 5 of 12' })).toBeTruthy();
    expect(exitFullscreen).not.toHaveBeenCalled();
  });

  it('closes by itself once a question is asked, focus on the question', async () => {
    const { rerender } = await opened();
    rerender(lesson(live({ question: question(), slide })));
    expect(dialog()).toBeNull();
    expect(exitFullscreen).toHaveBeenCalledOnce();
    expect(document.activeElement).toBe(screen.getByRole('heading', { name: PROMPT }));
  });

  it('closes by itself once the slides stop or the class is over, focus on the class’s name', async () => {
    for (const next of [live(), { kind: 'over', klass: biology, at: null } as LessonView]) {
      const { rerender } = await opened();
      rerender(lesson(next));
      expect(dialog()).toBeNull();
      expect(exitFullscreen).toHaveBeenCalledOnce();
      expect(document.activeElement).toBe(
        screen.getByRole('heading', { level: 1, name: 'Biology, period 3' }),
      );
      cleanup();
      exitFullscreen.mockClear();
    }
  });

  it('closes by itself once the lesson is refused or no longer the student’s, focus on what the page offers to do', async () => {
    const cases: [LessonView, () => HTMLElement][] = [
      [{ kind: 'failed' }, () => screen.getByRole('button', { name: 'Try again' })],
      [{ kind: 'not_in_class' }, () => screen.getByRole('link', { name: 'Your classes' })],
    ];
    for (const [next, target] of cases) {
      const { rerender } = await opened();
      rerender(lesson(next));
      expect(dialog()).toBeNull();
      expect(document.activeElement).toBe(target());
      cleanup();
    }
  });

  it('is left by Exit full screen, Esc, or the browser leaving full screen, focus back on Full screen', async () => {
    const back = () => screen.getByRole('button', { name: 'Full screen' });
    await opened();
    fireEvent.click(screen.getByRole('button', { name: 'Exit full screen' }));
    expect(dialog()).toBeNull();
    expect(exitFullscreen).toHaveBeenCalledOnce();
    expect(document.activeElement).toBe(back());
    cleanup();

    // Esc, where the browser isn't full screen: the dialog's cancel, which the page closes itself.
    await opened();
    const esc = new Event('cancel', { cancelable: true });
    fireEvent(screen.getByRole('dialog'), esc);
    expect(esc.defaultPrevented).toBe(true);
    expect(dialog()).toBeNull();
    expect(document.activeElement).toBe(back());
    cleanup();

    // The browser's own Esc or control: the slide goes with it, nothing asked of the browser.
    await opened();
    exitFullscreen.mockClear();
    act(() => {
      full = null;
      document.dispatchEvent(new Event('fullscreenchange'));
    });
    expect(dialog()).toBeNull();
    expect(exitFullscreen).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(back());
  });

  it('takes the page out of full screen with it once the page goes', async () => {
    const { unmount } = await opened();
    unmount();
    expect(exitFullscreen).toHaveBeenCalledOnce();
    expect(full).toBeNull();
  });
});

/*
 * The lesson's page as the root layout holds it, in the shell: the account the shell's one read,
 * the lesson followed, a student's answers and the slide's deck, each through Bali's stand-in.
 */
describe('its URL and its reads', () => {
  const CLASS = '0199e3a1-0000-7000-8000-00000000000c';
  const PRESENTATION = `/v1/sessions/${SESSION}/presentation`;
  /** The student's own account, as `/v1/me` answers it. */
  const account = (
    classes: StudentClass[],
    role: 'student' | 'teacher' = 'student',
  ): MeResponse => ({
    user: { id: 'u-ana', role, displayName: 'Ana Rodríguez' },
    classes,
    session: null,
    armed: false,
  });
  /** The class, its session running now (or none, or another). */
  const ours = (liveSession: StudentClass['liveSession']): StudentClass => ({
    ...biology,
    id: CLASS,
    liveSession,
  });
  const running = (over: Partial<Presentation> = {}): Presentation => ({
    running: true,
    question: null,
    slide: null,
    phone: { state: 'focused', lastSeenAt: null },
    ...over,
  });

  /** What Bali says: the 13+ check, the account, and the lesson, tagged as it changes. */
  const said = {
    passed: true,
    me: account([ours(bell)]),
    lesson: running(),
    version: 1,
    /** Bali refuses the lesson's reads (a `404`); or holds them, or the account's, for the test. */
    refused: false,
    hold: new Set<string>(),
  };
  /** The lesson as the teacher changes it: a new tag. */
  const teach = (lesson: Presentation) => {
    said.lesson = lesson;
    said.version += 1;
  };

  beforeEach(() => {
    bali.path = `/lessons/${CLASS}/${SESSION}`;
    bali.client = createApiClient({
      baseUrl: 'http://api',
      getToken: () => 'token',
      fetchImpl: bali.fetch,
    });
    Object.assign(said, {
      passed: true,
      me: account([ours(bell)]),
      lesson: running(),
      version: 1,
      refused: false,
      hold: new Set<string>(),
    });
    bali.reply = (call) => {
      if (call.method !== 'GET' || said.hold.has(call.path)) return null;
      if (call.path === '/v1/me/age-check') return [200, { passed: said.passed }];
      if (call.path === '/v1/me') return [200, said.me];
      if (call.path !== PRESENTATION) return [404, { error: { code: 'not_found', message: 'no' } }];
      if (said.refused) {
        return [
          404,
          { error: { code: 'not_found', reason: 'session_not_found', message: 'no session' } },
        ];
      }
      const etag = `"${said.version}"`;
      return call.etag === etag ? [304, undefined, { etag }] : [200, said.lesson, { etag }];
    };
  });

  /** The page in the shell, as the root layout holds it, on this computer's clock at `now`. */
  function open(now = NOW) {
    vi.useFakeTimers({ now });
    return render(
      <Shell>
        <StudentLessonPage classId={CLASS} sessionId={SESSION} />
      </Shell>,
    );
  }
  /** Bali's answers in and drawn, and `ms` gone by on this computer's clock. */
  async function wait(ms = 0) {
    await act(() => vi.advanceTimersByTimeAsync(ms));
    for (let i = 0; i < 4; i++) await act(() => vi.advanceTimersByTimeAsync(0));
  }
  /** How many times the page read `path`. */
  const reads = (path: string) =>
    bali.calls.filter((c) => c.method === 'GET' && c.path === path).length;
  /** The request to `path` the test holds, answered now. */
  async function answer(path: string, ...reply: Parameters<(typeof bali.calls)[number]['answer']>) {
    const held = bali.calls.filter((c) => c.path === path).at(-1);
    if (!held) throw new Error(`nothing sent to ${path}`);
    await act(() => Promise.resolve(held.answer(...reply)));
    await wait();
  }

  it('is a page for a class and a session each an id the API mints, else none, and afresh for another', async () => {
    const shown = await Route({ params: Promise.resolve({ classId: CLASS, sessionId: SESSION }) });
    expect(isValidElement(shown) && shown.type).toBe(StudentLessonPage);
    expect(isValidElement(shown) && shown.props).toEqual({ classId: CLASS, sessionId: SESSION });
    expect(isValidElement(shown) && shown.key).toBe(`${CLASS}/${SESSION}`);
    for (const [classId, sessionId] of [
      ['..', SESSION],
      [CLASS, '..'],
      ['c1', SESSION],
      [CLASS, `${SESSION}/..`],
    ]) {
      bali.notFound.mockClear();
      await expect(Route({ params: Promise.resolve({ classId, sessionId }) })).rejects.toThrow(
        'not found',
      );
      expect(bali.notFound).toHaveBeenCalledOnce();
    }
  });

  it('reads the account as it opens, the shell’s one read, and again at the bell, once', async () => {
    // A minute before the bell.
    open(Date.parse(BELL) - 60_000);
    await wait();
    expect(reads('/v1/me/age-check')).toBe(1);
    expect(reads('/v1/me')).toBe(1);
    expect(screen.getByText(NOTHING)).toBeTruthy();
    // At the bell, the account again: its teacher added five minutes, so again at the later bell.
    const later = new Date(Date.parse(BELL) + 5 * 60_000).toISOString();
    said.me = account([ours({ ...bell, endsAt: later })]);
    await wait(59_000);
    expect(reads('/v1/me')).toBe(1);
    await wait(1_000);
    expect(reads('/v1/me')).toBe(2);
    // At that bell: the class with no session now. Its bell kept, nothing is read again.
    said.me = account([ours(null)]);
    await wait(5 * 60_000);
    expect(reads('/v1/me')).toBe(3);
    teach({ running: false, question: null, slide: null, phone: null });
    await wait(30 * 60_000);
    expect(reads('/v1/me')).toBe(3);
    expect(screen.getByRole('heading', { name: 'Class is over' })).toBeTruthy();
    // The page reads nothing of its own but the lesson: the rest is the shell's account.
    expect(new Set(bali.calls.map((c) => `${c.method} ${c.path}`))).toEqual(
      new Set(['GET /v1/me/age-check', 'GET /v1/me', `GET ${PRESENTATION}`]),
    );
  });

  it('follows the session only once a read lists it as the class’s, every 2 s from then', async () => {
    said.hold.add('/v1/me');
    open();
    await wait(5_000);
    expect(reads('/v1/me')).toBe(1);
    expect(reads(PRESENTATION)).toBe(0);
    said.hold.clear();
    await answer('/v1/me', 200, account([ours(bell)]));
    expect(reads(PRESENTATION)).toBe(1);
    expect(screen.getByText(NOTHING)).toBeTruthy();
    await wait(2_000);
    expect(reads(PRESENTATION)).toBe(2);
  });

  it('follows no session the account doesn’t list as the class’s: none running, or another', async () => {
    const another = { ...bell, id: '01924b2c-0000-7000-8000-0000000000ff' };
    for (const liveSession of [null, another]) {
      said.me = account([ours(liveSession)]);
      open();
      await wait(10_000);
      expect(reads(PRESENTATION)).toBe(0);
      expect(screen.getByRole('heading', { name: 'Class is over' })).toBeTruthy();
      cleanup();
      vi.useRealTimers();
      bali.calls.length = 0;
    }
  });

  it('stops following once the account no longer lists the class', async () => {
    open(Date.parse(BELL) - 4_000);
    await wait();
    expect(reads(PRESENTATION)).toBe(1);
    // Read again at the bell: removed from the class meanwhile.
    said.me = account([]);
    await wait(4_000);
    expect(reads('/v1/me')).toBe(2);
    expect(screen.getByText("This lesson is for a class you're not in.")).toBeTruthy();
    const followed = reads(PRESENTATION);
    await wait(20_000);
    expect(reads(PRESENTATION)).toBe(followed);
  });

  it('reads the lesson afresh on Try again and the account with it, held until the lesson’s read answers (StudentRetryStates)', async () => {
    open();
    await wait();
    expect(screen.getByText(NOTHING)).toBeTruthy();
    // Bali refuses the next read.
    said.refused = true;
    await wait(2_000);
    const refusal = bali.calls.filter((c) => c.path === PRESENTATION).at(-1);
    expect(refusal?.etag).toBe('"1"');
    expect(screen.getByRole('alert').textContent).toBe("Bali couldn't load this lesson.");
    const accountReads = reads('/v1/me');
    const lessonReads = reads(PRESENTATION);

    said.refused = false;
    said.hold.add(PRESENTATION);
    const again = screen.getByRole('button', { name: 'Try again' });
    again.focus();
    fireEvent.click(again);
    await wait();
    // The lesson read afresh, as a new page would (no tag kept), and the account with it.
    expect(reads(PRESENTATION)).toBe(lessonReads + 1);
    expect(bali.calls.filter((c) => c.path === PRESENTATION).at(-1)?.etag).toBeNull();
    expect(reads('/v1/me')).toBe(accountReads + 1);
    // The account has answered, the lesson not yet: held, its failure still said.
    expect(again.textContent).toBe('Loading…');
    expect(again.getAttribute('aria-busy')).toBe('true');
    expect(screen.getByRole('alert').textContent).toBe("Bali couldn't load this lesson.");
    said.hold.clear();
    await answer(PRESENTATION, 200, said.lesson, { etag: `"${said.version}"` });
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.queryByRole('button', { name: /Try again|Loading/ })).toBeNull();
    expect(screen.getByText(NOTHING)).toBeTruthy();
  });

  it('answers through the lesson it follows, minted after the answer Bali holds, the held one sent again only while one is on its way or after one didn’t send', async () => {
    teach(running({ question: question({ answer: yours(1) }) }));
    open();
    await wait();
    const option = (name: string) => within(card()).getByRole('button', { name });
    const sent = () => bali.calls.filter((c) => c.method === 'POST');
    expect(option('x = 2').getAttribute('aria-pressed')).toBe('true');

    fireEvent.click(option('x = 6'));
    await wait();
    expect(sent().map((c) => c.path)).toEqual([`/v1/questions/${QUESTION}/answers`]);
    const first = sent()[0]?.body as { eventId: string; option: number };
    expect(first.option).toBe(3);
    expect(first.eventId > HELD).toBe(true);
    // On its way: picked, and said.
    expect(option('x = 6').getAttribute('aria-pressed')).toBe('true');
    expect(line()?.textContent).toBe('Sending your answer…');
    await answer(`/v1/questions/${QUESTION}/answers`, 200, {
      outcome: 'answered',
      answer: { option: 3, eventId: first.eventId },
    });
    expect(line()?.textContent).toBe(ANSWERED);

    // The answer Bali holds, tapped again: nothing sent.
    fireEvent.click(option('x = 6'));
    await wait();
    expect(sent()).toHaveLength(1);

    // Another, and again while it's on its way: each sent, each minted after the last.
    fireEvent.click(option('x = 4'));
    fireEvent.click(option('x = 4'));
    await wait();
    expect(sent()).toHaveLength(3);
    const [, second, third] = sent().map((c) => c.body as { eventId: string; option: number });
    expect([second?.option, third?.option]).toEqual([2, 2]);
    expect((second?.eventId ?? '') > first.eventId).toBe(true);
    expect((third?.eventId ?? '') > (second?.eventId ?? '')).toBe(true);
    // The last didn't send: said in the line's place, the answer Bali holds picked again.
    await act(() => Promise.resolve(sent()[2]?.fail()));
    await wait();
    expect(within(card()).getByRole('alert').textContent).toBe(DIDNT);
    expect(option('x = 6').getAttribute('aria-pressed')).toBe('true');
    // Picked again after one didn't send: sent again.
    fireEvent.click(option('x = 6'));
    await wait();
    expect(sent()).toHaveLength(4);
    expect((sent()[3]?.body as { option: number }).option).toBe(3);
  });

  it('loads the slide’s deck only while the lesson shows it, closed once it stops, changes or the class is over (W5)', async () => {
    const other = { deckId: 'd2', sha256: 'cd'.repeat(32), page: 1, pageCount: 3 };
    teach(running({ slide }));
    open();
    await wait();
    expect(bali.loads.map((l) => l.slide)).toEqual([{ deckId: 'd1', sha256: SHA }]);
    const close = vi.fn(() => Promise.resolve());
    await act(() =>
      Promise.resolve(bali.loads[0]?.end({ kind: 'loaded', deck: { pdf: {}, close } })),
    );

    // The teacher turns the page: the same deck, nothing loaded again.
    teach(running({ slide: { ...slide, page: 5 } }));
    await wait(2_000);
    expect(screen.getByRole('heading', { name: 'Slide 5 of 12' })).toBeTruthy();
    expect(bali.loads).toHaveLength(1);
    expect(close).not.toHaveBeenCalled();

    // Another deck: the first closed, the other loaded.
    teach(running({ slide: other }));
    await wait(2_000);
    expect(close).toHaveBeenCalledOnce();
    expect(bali.loads.map((l) => l.slide)).toEqual([
      { deckId: 'd1', sha256: SHA },
      { deckId: 'd2', sha256: other.sha256 },
    ]);

    // The teacher stops: the load on its way is stopped.
    teach(running());
    await wait(2_000);
    expect(bali.loads[1]?.signal?.aborted).toBe(true);
    expect(screen.getByText(NOTHING)).toBeTruthy();

    // Shown again, loaded afresh; one that didn't load says so, and its Try again loads it again.
    teach(running({ slide: other }));
    await wait(2_000);
    expect(bali.loads).toHaveLength(3);
    await act(() => Promise.resolve(bali.loads[2]?.end({ kind: 'unfetched', status: 500 })));
    await wait();
    expect(screen.getByRole('alert').textContent).toBe("Bali couldn't load the slides.");
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    await wait();
    expect(bali.loads).toHaveLength(4);

    // The class is over: the load on its way stopped, nothing more loaded.
    teach({ running: false, question: null, slide: null, phone: null });
    await wait(2_000);
    expect(screen.getByRole('heading', { name: 'Class is over' })).toBeTruthy();
    expect(bali.loads[3]?.signal?.aborted).toBe(true);
    expect(bali.loads).toHaveLength(4);
  });

  it('sends anyone but a student home: a teacher, and an account never through the 13+ check', async () => {
    const accounts: [boolean, MeResponse][] = [
      [true, account([ours(null)], 'teacher')],
      [false, account([])],
    ];
    for (const [passed, me] of accounts) {
      Object.assign(said, { passed, me });
      const { unmount } = open();
      await wait();
      expect(bali.router.replace).toHaveBeenCalledWith('/');
      expect(screen.queryByText('Biology, period 3')).toBeNull();
      unmount();
      vi.useRealTimers();
      bali.router.replace.mockClear();
    }
    Object.assign(said, { passed: true, me: account([ours(bell)]) });
    open();
    await wait();
    expect(screen.getByText(NOTHING)).toBeTruthy();
    expect(bali.router.replace).not.toHaveBeenCalled();
  });
});
