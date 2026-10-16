import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import type { QuestionResults, TeacherQuestion } from '@bali/shared';
import { createElement, type ReactElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import {
  closeButtons,
  closeFailedLine,
  doneButton,
  isOpen,
  type LiveQuestion,
  QuestionCard,
} from './question-card';

/*
 * The class page's "Questions and slides" card with a question in it (L7-1a; LessonWaiting,
 * LessonLive, LessonClosed, LessonStates' lines), rendered in each state: open under the small-group
 * guard and past it, closed with and without its answer shown, the bell's close, a close that failed,
 * results that can't refresh. Only totals: never a name, never who picked what. Its buttons are
 * pressed through the card's own element tree; the hook's wiring is read from the source.
 */
const source = readFileSync(fileURLToPath(new URL('./question-card.tsx', import.meta.url)), 'utf8');

const question = (over: Partial<TeacherQuestion> = {}): TeacherQuestion => ({
  id: '0199e0a0-0000-7000-8000-000000000001',
  prompt: 'Which value of x solves x² − 5x + 6 = 0?',
  options: ['x = 1', 'x = 2', 'x = 4', 'x = 6'],
  correctOption: 1,
  revealed: false,
  open: true,
  ...over,
});
const totals = (over: Partial<QuestionResults> = {}): QuestionResults => ({
  answered: 2,
  eligible: 28,
  open: true,
  correctOption: 1,
  revealed: false,
  counts: null,
  ...over,
});
function lesson(over: Partial<LiveQuestion> = {}, read: QuestionResults | null = totals()) {
  return {
    question: question(),
    results: read && { results: read, final: false, problem: null, at: 0 },
    closing: false,
    closeFailed: null,
    close: vi.fn(),
    done: vi.fn(),
    ...over,
  } satisfies LiveQuestion;
}
const props = (l: LiveQuestion, endsAt: string | null = null) => ({
  id: 'L',
  lesson: l,
  endsAt,
  asking: false,
  onAsk: vi.fn(),
  showing: false,
  onShow: vi.fn(),
});
const render = (l: LiveQuestion, endsAt: string | null = null) =>
  renderToStaticMarkup(createElement(QuestionCard, props(l, endsAt)));

/** Markup as read: each tag a space, each run of spaces one. */
const text = (html: string) =>
  html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&#x27;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
/** Each option's row as read: its letter, words, tag and count. */
const rows = (html: string) => [...html.matchAll(/<li class="grid[^"]*">([^]*?)<\/li>/g)];
/** The count beside each option, empty under the guard. */
const counts = (html: string) =>
  rows(html).map((m) => /<span class="text-right[^"]*">([^<]*)<\/span>/.exec(m[1] ?? '')?.[1]);

/** The card's buttons, by their words, from its own element tree, to press. */
function buttons(node: ReactNode): Map<string, () => void> {
  const found = new Map<string, () => void>();
  const words = (n: ReactNode): string =>
    Array.isArray(n)
      ? n.map(words).join('')
      : typeof n === 'string'
        ? n
        : n && typeof n === 'object' && 'props' in n
          ? words((n as ReactElement<{ children?: ReactNode }>).props.children)
          : '';
  const walk = (n: ReactNode): void => {
    if (Array.isArray(n)) return n.forEach(walk);
    if (!n || typeof n !== 'object' || !('props' in n)) return;
    const p = (n as ReactElement<{ onClick?: () => void; children?: ReactNode }>).props;
    if (p.onClick) found.set(words(p.children).trim(), p.onClick);
    walk(p.children);
  };
  walk(node);
  return found;
}
const press = (l: LiveQuestion, words: string, endsAt: string | null = null) => {
  const click = buttons(QuestionCard(props(l, endsAt))).get(words);
  if (!click) throw new Error(`no button "${words}"`);
  click();
};

describe('the card at rest (LessonClass, L7-1b)', () => {
  const html = render(lesson({ question: null }, null));

  it('is titled Questions and slides, with Ask a question and Show slides, its panel closed', () => {
    expect(html).toMatch(
      /^<section aria-labelledby="L-lesson" class="[^"]*"><div class="[^"]*"><h2 id="L-lesson" class="text-h3">Questions and slides<\/h2>/,
    );
    expect(html).toMatch(
      /<button type="button" id="L-ask" aria-expanded="false" class="[^"]*\bbg-action-primary-bg\b[^"]*"><svg[^>]*\blucide-message-circle-question-mark\b[^>]*>[^]*<\/svg>Ask a question<\/button>/,
    );
    // Show slides beside it, secondary, with the slides' icon, as LessonClass draws it (M6, 2c).
    expect(html).toMatch(
      /<\/svg>Ask a question<\/button><button type="button" id="L-show" aria-expanded="false" class="[^"]*\bbg-surface-card\b[^"]*"><svg[^>]*\blucide-presentation\b[^>]*>[^]*?<\/svg>Show slides<\/button>/,
    );
    expect(html).not.toMatch(/Question ·|answered/);
  });

  it('marks each button as controlling the panel while it is open on what it opened', () => {
    const at = (over: object) =>
      renderToStaticMarkup(
        createElement(QuestionCard, { ...props(lesson({ question: null }, null)), ...over }),
      );
    expect(at({ asking: true })).toMatch(/id="L-ask" aria-expanded="true" aria-controls="L-panel"/);
    expect(at({ asking: true })).toMatch(/id="L-show" aria-expanded="false" class/);
    expect(at({ showing: true })).toMatch(
      /id="L-show" aria-expanded="true" aria-controls="L-panel"/,
    );
    expect(at({ showing: true })).toMatch(/id="L-ask" aria-expanded="false" class/);
  });

  it('opens the panel on the decks with Show slides', () => {
    const p = props(lesson({ question: null }, null));
    buttons(QuestionCard(p)).get('Show slides')?.();
    expect(p.onShow).toHaveBeenCalledOnce();
    expect(p.onAsk).not.toHaveBeenCalled();
  });

  it('offers Show slides at rest alone, never beside a question', () => {
    expect(render(lesson())).not.toMatch(/Show slides/);
    expect(render(lesson({ question: question({ open: false }) }))).not.toMatch(/Show slides/);
  });
});

describe('the card', () => {
  it('is v2’s card on its own, its parts 16 px apart, titled by its question', () => {
    const html = render(lesson());
    expect(html).toMatch(/^<section aria-labelledby="L-q" class="[^"]*">/);
    // Focusable from code (L7-1b): asked, focus comes to the question.
    expect(html).toMatch(/<h2 id="L-q" tabindex="-1" class="[^"]*">Which value of x solves/);
    const card = /^<section [^>]*class="([^"]*)"/.exec(html)?.[1]?.split(' ');
    expect(card).toEqual(
      expect.arrayContaining(['rounded-md', 'p-5', 'shadow-1', 'flex-col', 'gap-4']),
    );
  });
});

describe('a question open (LessonWaiting, LessonLive)', () => {
  it('under 3 answers says "2 of 28 answered" and nothing per option: the guard’s', () => {
    const html = render(lesson());
    expect(html).toMatch(
      /<p class="text-section-label uppercase text-text-brand">Question · open<\/p>/,
    );
    expect(text(html)).toContain('2 of 28 answered');
    expect(counts(html)).toEqual(['', '', '', '']);
    expect(html).not.toContain('style=');
    // The three sentences the canvas drops are not built (DESIGN.md §1, The words).
    expect(html).not.toMatch(/The breakdown shows|Updates every few seconds|never who picked/);
    // Each option with its letter, the correct one marked for the teacher alone.
    expect(rows(html).map((m) => text(m[1] ?? ''))).toEqual([
      'A x = 1',
      'B x = 2 Correct',
      'C x = 4',
      'D x = 6',
    ]);
  });

  it('from 3 answers shows each option’s count and its bar, out of those who answered', () => {
    const html = render(lesson({}, totals({ answered: 3, counts: [1, 2, 0, 0] })));
    expect(text(html)).toContain('3 of 28 answered');
    expect(counts(html)).toEqual(['1', '2', '0', '0']);
    const bars = [
      ...html.matchAll(/<span aria-hidden="true" class="([^"]*)" style="width:(\d+)%"/g),
    ];
    expect(bars.map((m) => [m[2], m[1]?.includes('bg-bar-right')])).toEqual([
      ['33', false],
      ['67', true],
      ['0', false],
      ['0', false],
    ]);
  });

  it('closes with Close, and with Close and show answer only when it has a correct one', () => {
    const close = vi.fn();
    const l = lesson({ close });
    expect(text(render(l))).toContain('Close Close and show answer');
    press(l, 'Close');
    press(l, 'Close and show answer');
    expect(close.mock.calls).toEqual([[false], [true]]);
    const none = lesson({ question: question({ correctOption: null }) });
    expect(text(render(none))).not.toContain('show answer');
    expect(render(none)).not.toMatch(/Correct/);
  });

  it('holds both while a close is on its way', () => {
    const html = render(lesson({ closing: true }));
    expect(html.match(/<button [^>]*aria-disabled="true"[^>]*>Close/g)).toHaveLength(2);
  });

  it('says a close that failed with Try again, which sends the same choice again', () => {
    const l = lesson({ closeFailed: { reveal: true } });
    expect(render(l)).toMatch(
      /<p role="alert" class="text-body">Bali couldn&#x27;t close the question\.<\/p><button type="button" aria-disabled="false" class="[^"]*\bh-8\.5\b[^"]*">Try again<\/button>/,
    );
    press(l, 'Try again');
    expect(l.close).toHaveBeenCalledWith(true);
  });

  it('says results that can’t refresh, drawn as the stale banner, until its final count', () => {
    const behind = lesson();
    behind.results = {
      results: totals(),
      final: false,
      problem: { kind: 'failed', status: undefined, retryAfter: undefined },
      at: 0,
    };
    expect(render(behind)).toMatch(
      /<p role="status" class="[^"]*\bbg-surface-sunken\b[^"]*">These totals may be behind\. Bali can&#x27;t reach the server and keeps trying\.<\/p>/,
    );
    behind.results = { ...behind.results, final: true };
    expect(render(behind)).not.toContain('may be behind');
  });

  it('shows the question with no count before its first read', () => {
    const html = render(lesson({}, null));
    expect(text(html)).toContain('Which value of x solves');
    expect(html).not.toMatch(/answered|aria-live/);
  });
});

describe('a question closed (LessonClosed, LessonStates)', () => {
  const closed = (
    revealed: boolean,
    read = totals({ answered: 21, open: false, revealed, counts: [3, 14, 1, 3] }),
  ) => lesson({ question: question({ open: false, revealed }) }, read);

  it('with its answer shown: Correct answer, what students see, and the final count', () => {
    const l = closed(true);
    l.results = { ...(l.results as NonNullable<LiveQuestion['results']>), final: true };
    const html = render(l);
    expect(html).toMatch(
      /<p class="text-section-label uppercase text-text-tertiary">Question · closed<\/p>/,
    );
    expect(text(html)).toContain('B x = 2 Correct answer 14');
    expect(text(html)).toContain('Students see the correct answer on their phones.');
    expect(text(html)).toContain('21 of 28 answered Final count');
  });

  it('without it: Correct, and that students don’t see which', () => {
    const html = render(closed(false));
    expect(text(html)).toContain('B x = 2 Correct 14');
    expect(text(html)).toContain("Students don't see which answer was correct.");
    // The final count only once the read after the close has come (L6).
    expect(html).not.toContain('Final count');
  });

  it('under 3 answers keeps the guard: no count per option, closed or not', () => {
    const html = render(closed(false, totals({ answered: 2, open: false, counts: null })));
    expect(counts(html)).toEqual(['', '', '', '']);
    expect(text(html)).toContain('2 of 28 answered');
  });

  it('with no correct option says nothing of one', () => {
    const html = render(
      lesson({ question: question({ open: false, correctOption: null }) }, totals({ open: false })),
    );
    expect(html).not.toMatch(/Correct|correct answer|Students/);
  });

  it('offers Ask another question and Done, which leaves the card at rest, focus on its Ask', () => {
    const l = closed(true);
    const html = render(l);
    expect(text(html)).toMatch(/^Question · closed Ask another question Done Which value/);
    expect(html).toMatch(
      /<button type="button" id="L-ask" aria-expanded="false" class="[^"]*">[^]*?Ask another question<\/button>/,
    );
    const frame = vi.fn<(then: () => void) => void>();
    const focus = vi.fn();
    const getElementById = vi.fn(() => ({ focus }));
    vi.stubGlobal('window', { requestAnimationFrame: frame });
    vi.stubGlobal('document', { getElementById });
    press(l, 'Done');
    expect(l.done).toHaveBeenCalled();
    expect(frame).toHaveBeenCalledOnce();
    // The next frame, once the card is at rest: focus on its Ask a question.
    frame.mock.calls[0]?.[0]();
    vi.unstubAllGlobals();
    expect(getElementById).toHaveBeenCalledWith('L-ask');
    expect(focus).toHaveBeenCalledOnce();
    expect(html).not.toMatch(/>Close</);
  });

  it('says the bell closed it when a read found it closed past the bell, no close heard', () => {
    // Held open (no close answered, none streamed), its results closed: the bell's, before the sweep.
    const l = lesson({}, totals({ open: false }));
    expect(isOpen(l)).toBe(false);
    (l.results as NonNullable<LiveQuestion['results']>).at = Date.parse('2026-10-15T14:55:00Z');
    const html = render(l, '2026-10-15T14:55:00Z');
    expect(html).toContain('Question · closed');
    expect(html).toContain('<p class="mt-3.5 text-body">The bell closed this question.</p>');
    // Before the bell, another tab's close on its way: closed, said as any close.
    expect(render(l, '2026-10-15T15:05:00Z')).not.toContain('The bell');
  });
});

describe('its buttons, the class page’s card and Present’s alike (L7, part 3)', () => {
  /** A piece rendered on its own, and its buttons by their words, to press. */
  const markup = (node: ReactNode) => renderToStaticMarkup(createElement('div', null, node));

  it('are one copy, in the class page’s words: the card says them through it', () => {
    // Close and Close and show answer, Done and the close that didn't go through: one copy each,
    // which Present's foot says too (present-question.tsx).
    for (const words of [
      '>\\s*Close\\s*<',
      '>\\s*Close and show answer\\s*<',
      '>\\s*Done\\s*<',
      'Bali couldn&apos;t close the question\\.',
      '>\\s*Try again\\s*<',
    ]) {
      expect(source.match(new RegExp(words, 'g'))).toHaveLength(1);
    }
    expect(source).toMatch(/\{open \? \(\s*closeButtons\(lesson\)\s*\) : \(/);
    expect(source).toMatch(/\{doneButton\(lesson, `\$\{id\}-ask`\)\}/);
    expect(source).toMatch(/\{closeFailedLine\(lesson\)\}/);
  });

  it('Close and Close and show answer close through the hook, held while a close is on its way', () => {
    const close = vi.fn();
    const l = lesson({ close });
    expect(markup(closeButtons(l))).toMatch(
      /^<div><button type="button" aria-disabled="false" class="[^"]*\bh-10\b[^"]*">Close<\/button><button type="button" aria-disabled="false" class="[^"]*\bh-10\b[^"]*">Close and show answer<\/button><\/div>$/,
    );
    const click = buttons(closeButtons(l));
    click.get('Close')?.();
    click.get('Close and show answer')?.();
    expect(close.mock.calls).toEqual([[false], [true]]);
    expect(
      markup(closeButtons(lesson({ closing: true }))).match(/aria-disabled="true"/g),
    ).toHaveLength(2);
    // No correct answer: Close alone (PresentControlsStates, as on the class page).
    expect(markup(closeButtons(lesson({ question: question({ correctOption: null }) })))).toMatch(
      /^<div><button [^>]*>Close<\/button><\/div>$/,
    );
  });

  it('says a close that didn’t go through while the question is open, Present’s at its size', () => {
    const l = lesson({ closeFailed: { reveal: false } });
    // The class page's, under its head: the body's size, a small Try again.
    expect(markup(closeFailedLine(l))).toMatch(
      /^<div><div class="flex flex-wrap items-center gap-x-4 gap-y-3"><p role="alert" class="text-body">Bali couldn&#x27;t close the question\.<\/p><button type="button" aria-disabled="false" class="[^"]*\bh-8\.5\b[^"]*">Try again<\/button><\/div><\/div>$/,
    );
    // Present's (PresentControlsStates): 20/28, at the right, a full-size Try again.
    expect(markup(closeFailedLine(l, true))).toMatch(
      /^<div><div class="flex flex-wrap items-center gap-x-4 gap-y-3 justify-end"><p role="alert" class="text-present-line">Bali couldn&#x27;t close the question\.<\/p><button type="button" aria-disabled="false" class="[^"]*\bh-10\b[^"]*">Try again<\/button><\/div><\/div>$/,
    );
    buttons(closeFailedLine(l, true)).get('Try again')?.();
    expect(l.close).toHaveBeenCalledWith(false);
    // None once it is closed, or with nothing failed.
    const closedSince = lesson(
      { question: question({ open: false }), closeFailed: { reveal: true } },
      totals({ open: false }),
    );
    expect(closeFailedLine(closedSince, true)).toBeNull();
    expect(closeFailedLine(lesson(), true)).toBeNull();
  });

  it('Done puts the question away through the hook, focus going on to what takes its place', () => {
    const l = lesson({ question: question({ open: false }) });
    expect(markup(doneButton(l, 'L-present'))).toMatch(
      /^<div><button type="button" class="[^"]*\bh-10\b[^"]*">Done<\/button><\/div>$/,
    );
    const frame = vi.fn<(then: () => void) => void>();
    const focus = vi.fn();
    const getElementById = vi.fn(() => ({ focus }));
    vi.stubGlobal('window', { requestAnimationFrame: frame });
    vi.stubGlobal('document', { getElementById });
    buttons(doneButton(l, 'L-present')).get('Done')?.();
    frame.mock.calls[0]?.[0]();
    vi.unstubAllGlobals();
    expect(l.done).toHaveBeenCalledOnce();
    expect(getElementById).toHaveBeenCalledWith('L-present');
    expect(focus).toHaveBeenCalledOnce();
  });
});

describe('only totals, never who answered (ARCHITECTURE, Live lesson, decision 2)', () => {
  it('draws nothing but the counts, whatever else a read carried', () => {
    const smuggled = {
      ...totals({ answered: 3, counts: [1, 2, 0, 0] }),
      names: ['Ana Rodríguez'],
      answers: [{ student: 'Ben Okafor', option: 1 }],
    };
    const html = render(lesson({}, smuggled));
    expect(html).not.toMatch(/Ana|Ben|Rodríguez|Okafor/);
  });

  it('reads no student: its file names none, and its results are the guarded count alone', () => {
    expect(source).not.toMatch(/displayName|studentId|Student\b|responses/);
    expect(source).toMatch(
      /import type \{ FeedEvent, SessionSnapshot, TeacherQuestion \} from '@bali\/shared';/,
    );
    // The counts are the server's, null under the guard: the card never makes its own.
    expect(source).toMatch(/const counts = totals\?\.counts \?\? null;/);
  });
});

describe('its hook (L6’s logic, held for one session)', () => {
  const hook = source.slice(
    source.indexOf('export function useLiveQuestion'),
    source.indexOf('/** v2.css'),
  );

  it('reads the session’s open question as it starts, and when the stream names one it doesn’t hold', () => {
    expect(hook).toMatch(/if \(sessionId !== null\) void read\(sessionId\);/);
    expect(hook).toMatch(
      /const next = questionAfter\(question, e\);\s*if \(next === 'unknown'\) void read\(session\);/,
    );
    // Only ever a newer question: a slow read never puts back one closed or asked over.
    expect(hook).toMatch(/if \(q && q\.id > newest\.current\) put\(session, q\);/);
    // A read that failed for want of an answer is read again shortly.
    expect(hook).toMatch(
      /failureOf\(e\)\.kind === 'failed'[^]*?setTimeout\(\(\) => void read\(session\), POLL_EVERY_MS\)/,
    );
  });

  it('keeps each read of the session for the slide’s hook, and reads it again when asked (M6, part 2b)', () => {
    // One read for both cards: the slide's hook takes what the session shows from it, this
    // session's only.
    expect(hook).toMatch(
      /const snap = await api\.get<SessionSnapshot>\(`\/v1\/sessions\/\$\{session\}`\);\s*if \(now\.current\.session === session\) setSnapshot\(\{ session, snap \}\);/,
    );
    // Again through the one read at a time, never beside it.
    expect(hook).toMatch(
      /const reread = useCallback\(\(\) => \{\s*const session = now\.current\.session;\s*if \(session !== null\) void read\(session\);\s*\}, \[read\]\);/,
    );
    expect(hook).toMatch(
      /return \{ lesson, onEvent, ask, opening, forgetAsk, snapshot, reread \};/,
    );
  });

  it('reads one at a time, and nothing once the page has gone', () => {
    // The stream's overlap as it starts can name many old questions: one more read, not a burst.
    expect(hook).toMatch(
      /if \(reading\.current\?\.session === session\) \{\s*reading\.current\.again = true;\s*return;\s*\}/,
    );
    expect(hook).toMatch(
      /if \(now\.current\.session !== session\) return;\s*if \(again\) void read\(session\);\s*else if \(failed\) retry\.current = window\.setTimeout/,
    );
    expect(hook).toMatch(
      /return \(\) => \{\s*window\.clearTimeout\(retry\.current\);\s*now\.current = \{ session: null, question: null \};/,
    );
  });

  it('hears the stream through the class page’s live grid', () => {
    const page = readFileSync(
      fileURLToPath(new URL('../app/classes/[id]/page.tsx', import.meta.url)),
      'utf8',
    );
    const grid = readFileSync(fileURLToPath(new URL('./live-grid.tsx', import.meta.url)), 'utf8');
    expect(page).toMatch(
      /const \{ lesson, onEvent, ask, opening, forgetAsk, snapshot, reread \} = useLiveQuestion\(\s*live \? grid\.id : null,?\s*\);/,
    );
    // Beside the slide's (M6, part 2b-2), which hears its slide changes the same way.
    expect(page).toMatch(/onEvent=\{onLessonEvent\}/);
    expect(page).toMatch(/\(e: FeedEvent\) => \{\s*onEvent\(e\);\s*onSlideEvent\(e\);/);
    expect(grid).toMatch(
      /if \(endsSession\(e\)\) onEndedRef\.current\?\.\(sessionId\);\s*onEventRef\.current\?\.\(e\);/,
    );
  });

  it('asks and closes through L6, an unanswered attempt resent under its id', () => {
    expect(hook).toMatch(
      /openAttemptFor\(unansweredOpen\.current, session, draft\);[^]*?unansweredOpen\.current = keepUnanswered\(attempt, answer\);/,
    );
    // One ask at a time, held by the hook, never by a panel that can unmount mid-send (santa's
    // review): a second press, in a panel opened again, sends nothing.
    // The same one ask whatever it asks, the words written or one of the teacher's questions
    // (L7b, part 2), its `from` saying which, so the panel says it where it was pressed.
    expect(hook).toMatch(
      /const ask = useCallback\(\s*async \(draft: QuestionDraft, from: string \| null = null\): Promise<OpenAnswer \| null> => \{/,
    );
    expect(hook).toMatch(/if \(session === null \|\| askingNow\.current\) return null;/);
    expect(hook).toMatch(/setOpening\(\{ busy: true, failure: null, from \}\);/);
    // Answered, it lets go: the guard and the busy look, its failure said unless Cancel forgot it
    // meanwhile; an ask of a session gone touches the next one's nothing; one cancelled on its way
    // closes no panel opened since. A new session starts with none.
    expect(hook).toMatch(
      /if \(now\.current\.session !== session\) return null;\s*unansweredOpen\.current = keepUnanswered\(attempt, answer\);\s*askingNow\.current = false;\s*const cancelled = asks\.current !== mine;\s*setOpening\(\{\s*busy: false,\s*failure: answer\.kind === 'opened' \|\| cancelled \? null : answer,\s*from,\s*\}\);/,
    );
    expect(hook).toMatch(/return cancelled \? null : answer;/);
    expect(hook).toMatch(/askingNow\.current = false;\s*setOpening\(IDLE\);/);
    expect(source).toMatch(/const IDLE: Opening = \{ busy: false, failure: null, from: null \};/);
    // Cancel, the write form's, forgets what was written: its ask's failure, and one still on its
    // way; never an ask of one of the teacher's questions, whose failure waits under it in their list
    // however the panel was left meanwhile (santa's review, round 2).
    expect(hook).toMatch(
      /askedFrom\.current = from;\s*setOpening\(\{ busy: true, failure: null, from \}\);/,
    );
    expect(hook).toMatch(
      /const forgetAsk = useCallback\(\(\) => \{\s*if \(askedFrom\.current !== null\) return;\s*asks\.current \+= 1;\s*setOpening\(\(cur\) => \(\{ \.\.\.cur, failure: null \}\)\);\s*\}, \[\]\);/,
    );
    // An open's answer, its replay's too, never over a question asked after it.
    expect(hook).toMatch(
      /if \(answer\.kind === 'opened' && answer\.question\.id >= newest\.current\) \{\s*put\(session, answer\.question\);/,
    );
    expect(hook).toMatch(
      /closeAttemptFor\(unansweredClose\.current, question\.id, reveal\);[^]*?unansweredClose\.current = keepUnanswered\(attempt, answer\);/,
    );
    expect(hook).toMatch(
      /if \(answer\.kind === 'closed'\) put\(session, answer\.question\);\s*else setCloseFailed\(\{ id: question\.id, reveal \}\);/,
    );
  });

  it('tells its Done to every Bali window of this browser, and puts away what another’s Done names', () => {
    // Done: only the question it was drawn for (one held since, not yet redrawn, stays), away here,
    // then told, with the session and the question's id alone.
    expect(hook).toMatch(
      /done: \(\) => \{\s*const \{ session, question: held \} = now\.current;[^]*?if \(session === null \|\| question === null \|\| held\?\.id !== question\.id\) return;\s*put\(session, null\);\s*told\.current\?\.tell\(\{ sessionId: session, questionId: question\.id \}\);/,
    );
    // Heard: what it puts away is `heardDone`'s (live-question.test.ts), and so is the newest
    // question a read may bring after it (a read only ever brings a newer one).
    expect(hook).toMatch(
      /const channel = doneChannel\(\(news\) => \{\s*const \{ session, question \} = now\.current;\s*const heard = heardDone\(news, session, question, newest\.current\);\s*newest\.current = heard\.newest;\s*if \(heard\.putAway\) put\(session, null\);\s*\}\);/,
    );
    expect(hook).toMatch(/if \(q && q\.id > newest\.current\) put\(session, q\);/);
    // One channel for the page's life, closed as it goes.
    expect(hook).toMatch(
      /told\.current = channel;\s*return \(\) => \{\s*channel\.close\(\);\s*told\.current = null;\s*\};\s*\}, \[put\]\);/,
    );
  });

  it('polls the shown question’s results, once more after it closes for the final counts', () => {
    expect(hook).toMatch(/pollResults\(api, id, \(state\) =>\s*setResults\(\(prev\) => \(\{/);
    // Timed from the read that first found it closed, so a close heard just before the bell, its
    // last read landing after it, is never said as the bell's.
    expect(hook).toMatch(
      /at: prev\?\.id === id && prev\.state\.results\?\.open === false \? prev\.at : Date\.now\(\),/,
    );
    expect(hook).toMatch(
      /if \(before\?\.open && question\?\.id === before\.id && !question\.open\) \{\s*if \(poll\.current\?\.id === question\.id\) poll\.current\.poll\.closed\(\);/,
    );
    expect(hook).toMatch(/return \(\) => p\.stop\(\);/);
  });
});
