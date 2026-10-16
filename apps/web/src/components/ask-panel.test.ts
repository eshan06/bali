import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import type { SavedQuestion } from '@bali/shared';
import Link from 'next/link';
import { createElement, isValidElement, type ReactElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import { TOO_MANY_TRIES } from '../lib/errors';
import type { Failure, QuestionDraft } from '../lib/live-question';
import { refusalsOf } from '../lib/saved-questions';
import { askSaid, AskPanel, NEW_DRAFT, pickLine, PickView } from './ask-panel';
import type { Opening } from './question-card';
import { CANT_LOAD_QUESTIONS, type Drafts, refusalSaid, UNSHOWABLE } from './saved-questions';

/*
 * Asking a question in the side panel: picked from the teacher's questions (L7b, part 2; LessonAsk,
 * LessonAskStates) and written there (L7; LessonWrite, LessonStates' lines). Each is rendered in
 * its states, the list's buttons pressed through its own element tree; how a failed ask is said is
 * read from the panel's own function; what needs the page or a press of the form, from the source.
 */
const source = readFileSync(fileURLToPath(new URL('./ask-panel.tsx', import.meta.url)), 'utf8');
const page = readFileSync(
  fileURLToPath(new URL('../app/classes/[id]/page.tsx', import.meta.url)),
  'utf8',
);

const IDLE: Opening = { busy: false, failure: null, from: null };
const NO_ANSWER: Failure = { kind: 'failed', status: undefined, retryAfter: undefined };
const ENDED: Failure = { kind: 'refused', status: 409, reason: 'session_not_running' };

/** Markup as read: each tag a space, each run of spaces one. */
const text = (html: string) =>
  html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&#x27;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();

// ---- picking one of the teacher's questions (LessonAsk) ----

const q = (n: number, over: Partial<SavedQuestion>): SavedQuestion => ({
  id: `0199b000-0000-7000-8000-00000000000${n}`,
  prompt: '',
  options: [],
  correctOption: null,
  eventId: `0199b000-0000-7000-8000-00000000010${n}`,
  createdAt: '2026-10-06T15:00:00.000Z',
  updatedAt: '2026-10-06T15:00:00.000Z',
  ...over,
});
/** LessonAsk's four, oldest first. */
const BOARD = [
  q(1, {
    prompt: 'Which value of x solves x² − 5x + 6 = 0?',
    options: ['x = 1', 'x = 2', 'x = 4', 'x = 6'],
    correctOption: 1,
  }),
  q(2, {
    prompt: 'Which pair of numbers multiplies to 12 and adds to −7?',
    options: ['3 and 4', '−3 and −4', '−2 and −6', '2 and 6'],
    correctOption: 1,
  }),
  q(3, {
    prompt: 'Where does the graph of y = (x − 3)(x − 4) cross the x-axis?',
    options: ['At 3 and 4', 'At −3 and −4', 'At 12'],
    correctOption: 0,
  }),
  q(4, {
    prompt: 'How sure are you about factoring now?',
    options: ['Very sure', 'Mostly', 'Not yet'],
  }),
];

const on = () => ({ onRead: vi.fn(), onPick: vi.fn(), onWrite: vi.fn(), onClose: vi.fn() });
const pickProps = (drafts: Drafts, opening: Opening = IDLE, openNow = false, handlers = on()) => ({
  id: 'P',
  drafts,
  openNow,
  opening,
  ...handlers,
});
const pick = (props: ReturnType<typeof pickProps>) =>
  renderToStaticMarkup(createElement(PickView, props));

/** Every host element the tree draws, each component of the portal's drawn out, as React would. */
function hosts(node: ReactNode): ReactElement<Record<string, unknown>>[] {
  if (Array.isArray(node)) return node.flatMap(hosts);
  if (!isValidElement<Record<string, unknown>>(node)) return [];
  // Next's link holds hooks of its own: read as the `<a>` it draws.
  if (typeof node.type === 'function' && node.type !== Link) {
    return hosts((node.type as (p: unknown) => ReactNode)(node.props));
  }
  return [node, ...hosts(node.props.children as ReactNode)];
}
const words = (n: ReactNode): string =>
  Array.isArray(n)
    ? n.map(words).join('')
    : typeof n === 'string'
      ? n
      : isValidElement<{ children?: ReactNode }>(n)
        ? words(n.props.children)
        : '';
/** Each button whose words are `name`, to press or read. */
const buttons = (node: ReactNode, name: string) =>
  hosts(node).filter(
    (e) => e.type === 'button' && words(e.props.children as ReactNode).trim() === name,
  );
const press = (node: ReactNode, name: string, i = 0) =>
  (buttons(node, name)[i]?.props.onClick as () => void)();

describe('the panel, picking one of your questions (LessonAsk)', () => {
  const html = pick(pickProps(BOARD));

  it('is v2’s side panel, 372 px from the right, titled with what it’s for', () => {
    expect(html).toMatch(/^<aside id="P" aria-labelledby="P-h" class="([^"]*)">/);
    const look = /^<aside [^>]*class="([^"]*)"/.exec(html)?.[1]?.split(' ');
    expect(look).toEqual(
      expect.arrayContaining(['fixed', 'right-0', 'w-93', 'max-w-full', 'shadow-3', 'z-5']),
    );
    expect(look).not.toContain('w-115');
    expect(text(html)).toMatch(
      /^Ask a question Pick one you wrote ahead, or write a new one\. Written ahead Which value of x/,
    );
    // Focus comes to the title as it opens; Close and Escape close it.
    expect(html).toContain('<h2 id="P-h" tabindex="-1" class="text-h3">Ask a question</h2>');
    expect(html).toMatch(/<button type="button" aria-label="Close"/);
    // v2.css's `.panel-body`, its words at `.app`'s 15/22 (the page's own size is the browser's 16).
    expect(html).toMatch(
      /<\/div><div class="flex flex-col gap-5\.5 px-5 pt-4\.5 pb-6 text-body"><section aria-labelledby="P-ahead"><h3 id="P-ahead" class="mb-3 text-label text-text-tertiary uppercase">Written ahead<\/h3>/,
    );
  });

  it('lists them in the order given, each with its answers counted, the correct one named, and Ask', () => {
    const rows = [...html.matchAll(/<li class="([^"]*)">([^]*?)<\/li>/g)];
    expect(rows.map((r) => text(r[2]))).toEqual([
      'Which value of x solves x² − 5x + 6 = 0? 4 answers · B marked correct Ask',
      'Which pair of numbers multiplies to 12 and adds to −7? 4 answers · B marked correct Ask',
      'Where does the graph of y = (x − 3)(x − 4) cross the x-axis? 3 answers · A marked correct Ask',
      'How sure are you about factoring now? 3 answers Ask',
    ]);
    // v2.css's `.pick-list`: the question beside Ask, a hairline over each and under the last.
    expect(rows[0]?.[1].split(' ')).toEqual(
      expect.arrayContaining([
        'grid',
        'grid-cols-[minmax(0,1fr)_auto]',
        'items-center',
        'gap-x-3.5',
        'gap-y-1',
        'border-t',
        'border-border-default',
        'py-3',
        'last:border-b',
      ]),
    );
    // The question in its own words, line breaks kept, a long word broken anywhere.
    expect(html).toContain(
      `<p id="P-${BOARD[3].id}" class="font-semibold whitespace-pre-line wrap-anywhere">How sure are you about factoring now?</p>`,
    );
  });

  it('counts its answers and names the correct one by its letter, as LessonAsk does', () => {
    expect(pickLine({ prompt: 'Q', options: ['a', 'b'], correctOption: null })).toBe('2 answers');
    expect(
      pickLine({ prompt: 'Q', options: ['a', 'b', 'c', 'd', 'e', 'f'], correctOption: 5 }),
    ).toBe('6 answers · F marked correct');
  });

  it('names each Ask by its question, for a screen reader, and asks the one pressed', () => {
    for (const draft of BOARD) {
      expect(html).toContain(
        `<button type="button" aria-describedby="P-${draft.id}" aria-disabled="false" aria-busy="false" class="`,
      );
    }
    const handlers = on();
    const tree = PickView(pickProps(BOARD, IDLE, false, handlers));
    press(tree, 'Ask', 1);
    expect(handlers.onPick).toHaveBeenCalledWith(BOARD[1]);
  });

  it('ends on Write a new question and the way to Your questions', () => {
    expect(text(html)).toMatch(
      /How sure are you about factoring now\? 3 answers Ask Write a new question Your questions$/,
    );
    expect(html).toMatch(
      /<button type="button" aria-disabled="false" class="inline-flex h-9 cursor-pointer items-center gap-2 rounded-xs text-body font-semibold text-text-brand aria-disabled:cursor-default aria-disabled:opacity-55"><svg[^>]*lucide-plus[^>]*>[^]*?<\/svg>Write a new question<\/button><a class="rounded-xs text-caption font-semibold text-text-brand underline-offset-2 hover:underline" href="\/questions">Your questions<\/a>/,
    );
    const handlers = on();
    press(PickView(pickProps(BOARD, IDLE, false, handlers)), 'Write a new question');
    expect(handlers.onWrite).toHaveBeenCalledOnce();
    expect(html).not.toMatch(/role="alert"|closes the open question/);
  });

  it('says asking closes the question open now, when one is, at its foot', () => {
    expect(text(pick(pickProps(BOARD, IDLE, true)))).toMatch(
      /Write a new question Your questions Asking this closes the open question\.$/,
    );
  });
});

describe('the list’s other states (LessonAskStates)', () => {
  it('says Loading… under Written ahead while it is read, Write a new question working meanwhile', () => {
    const html = pick(pickProps('loading'));
    expect(text(html)).toBe(
      'Ask a question Pick one you wrote ahead, or write a new one. Written ahead Loading… Write a new question Your questions',
    );
    expect(html).toContain('<p role="status" class="text-body text-text-secondary">Loading…</p>');
  });

  it('says a failed read in Your questions’ words, with Try again, which reads it again', () => {
    const handlers = on();
    const props = pickProps('failed', IDLE, false, handlers);
    expect(pick(props)).toMatch(
      /Written ahead<\/h3><div class="flex flex-wrap items-center gap-x-4 gap-y-3"><p role="alert" class="text-body">Bali couldn&#x27;t load your questions\.<\/p><button type="button" class="[^"]*\bh-8\.5\b[^"]*">Try again<\/button><\/div>/,
    );
    expect(CANT_LOAD_QUESTIONS).toBe("Bali couldn't load your questions.");
    press(PickView(props), 'Try again');
    expect(handlers.onRead).toHaveBeenCalledOnce();
  });

  it('says none saved yet in LessonStates’ line, in the primary ink, Write a new question under it', () => {
    const html = pick(pickProps([]));
    expect(html).toContain('Written ahead</h3><p class="text-body">No saved questions yet.</p>');
    expect(text(html)).toMatch(/No saved questions yet\. Write a new question Your questions$/);
  });
});

describe('asking one (LessonAskStates)', () => {
  it('holds every Ask while an ask is on its way, the one asked busy, and sends nothing more', () => {
    const handlers = on();
    const props = pickProps(
      BOARD,
      { busy: true, failure: null, from: BOARD[0].id },
      false,
      handlers,
    );
    const html = pick(props);
    expect(html.match(/aria-disabled="true" aria-busy="(true|false)"/g)).toEqual([
      'aria-disabled="true" aria-busy="true"',
      'aria-disabled="true" aria-busy="false"',
      'aria-disabled="true" aria-busy="false"',
      'aria-disabled="true" aria-busy="false"',
    ]);
    press(PickView(props), 'Ask', 2);
    expect(handlers.onPick).not.toHaveBeenCalled();
    // Held, not disabled: focus stays where it is.
    expect(html).not.toMatch(/\sdisabled=""/);
  });

  it('holds Write a new question too, so an ask that fails is said under its question (santa’s review)', () => {
    // Left for the form mid-ask, a failure of the question asked had nowhere to be said: the form
    // says only an ask of what is written, and its Cancel forgets a failure (LessonAskStates).
    const handlers = on();
    const busy = pickProps(
      BOARD,
      { busy: true, failure: null, from: BOARD[0].id },
      false,
      handlers,
    );
    expect(pick(busy)).toMatch(
      /<button type="button" aria-disabled="true" class="[^"]*\baria-disabled:opacity-55\b[^"]*"><svg[^>]*lucide-plus[^>]*>[^]*?<\/svg>Write a new question<\/button>/,
    );
    press(PickView(busy), 'Write a new question');
    expect(handlers.onWrite).not.toHaveBeenCalled();
    // Answered, it lets go.
    expect(pick(pickProps(BOARD))).toMatch(
      /<button type="button" aria-disabled="false" class="[^"]*">(?:(?!<\/button>)[^])*Write a new question<\/button>/,
    );
  });

  it('says one with no answer under its question, with Try again, which asks it again', () => {
    const handlers = on();
    const props = pickProps(
      BOARD,
      { busy: false, failure: NO_ANSWER, from: BOARD[2].id },
      false,
      handlers,
    );
    const html = pick(props);
    const row = [...html.matchAll(/<li class="[^"]*">([^]*?)<\/li>/g)].map((r) => r[1]);
    expect(text(row[2] ?? '')).toBe(
      "Where does the graph of y = (x − 3)(x − 4) cross the x-axis? 3 answers · A marked correct Ask Bali couldn't ask the question. Check your connection and try again. Try again",
    );
    expect(row[2]).toMatch(
      /<\/button><div class="col-span-full mt-1\.5 flex flex-wrap items-center gap-x-4 gap-y-3"><p role="alert" class="text-body">Bali couldn&#x27;t ask the question\. Check your connection and try again\.<\/p><button type="button" aria-describedby="P-[^"]+" aria-disabled="false" class="[^"]*\bh-8\.5\b[^"]*">Try again<\/button><\/div>$/,
    );
    // Said under that question alone.
    expect(html.match(/role="alert"/g)).toHaveLength(1);
    press(PickView(props), 'Try again');
    expect(handlers.onPick).toHaveBeenCalledWith(BOARD[2]);
  });

  it('says the session ended first, with no Try again; too many tries and a refusal in theirs', () => {
    const said = (failure: Failure) =>
      text(pick(pickProps(BOARD, { busy: false, failure, from: BOARD[0].id })));
    expect(said(ENDED)).toContain(
      "Ask This session has ended, so Bali didn't ask the question. Which pair",
    );
    expect(said({ kind: 'failed', status: 429, retryAfter: 2 })).toContain(
      `Ask ${TOO_MANY_TRIES} Try again Which pair`,
    );
    expect(said({ kind: 'refused', status: 409, reason: 'event_id_conflict' })).toContain(
      "Ask Bali couldn't ask the question. Try again Which pair",
    );
  });

  it('says nothing here of an ask of the words written in the panel', () => {
    const html = pick(pickProps(BOARD, { busy: false, failure: NO_ANSWER, from: null }));
    expect(html).not.toContain('role="alert"');
  });

  it('asks through the live question, the question’s own words with its id; asked, the panel goes', () => {
    const panel = source.slice(source.indexOf('export function PickPanel'));
    expect(panel).toMatch(
      /const answer = await onAsk\(trimmed\(draft\), draft\.id\);\s*if \(answer\?\.kind === 'opened'\) onAsked\(\);/,
    );
    // Its words read from Bali each time it opens, and again by Try again, oldest first.
    expect(panel).toMatch(
      /const read = useCallback\(async \(\) => \{\s*setDrafts\('loading'\);\s*const answer = await readDrafts\(api\);\s*setDrafts\(answer\.kind === 'read' \? answer\.drafts : 'failed'\);/,
    );
    expect(panel).toMatch(/useEffect\(\(\) => \{\s*void read\(\);\s*\}, \[read\]\);/);
    expect(panel).toMatch(/onRead=\{\(\) => void read\(\)\}/);
    // Focus comes to its title as it opens.
    expect(panel).toMatch(
      /useEffect\(\(\) => document\.getElementById\(`\$\{id\}-h`\)\?\.focus\(\), \[id\]\);/,
    );
  });
});

// ---- writing a new question (LessonWrite) ----

const render = (draft: QuestionDraft, openNow = false, opening: Opening = IDLE) =>
  renderToStaticMarkup(
    createElement(AskPanel, {
      id: 'P',
      draft,
      onDraft: vi.fn(),
      openNow,
      opening,
      onAsk: vi.fn(),
      onAsked: vi.fn(),
      onCancel: vi.fn(),
      onClose: vi.fn(),
    }),
  );

describe('the panel, writing a new question (LessonWrite)', () => {
  const html = render(NEW_DRAFT);

  it('is v2’s side panel, 460 px from the right, titled with what phones do', () => {
    expect(html).toMatch(/^<aside id="P" aria-labelledby="P-h" class="([^"]*)">/);
    const look = /^<aside [^>]*class="([^"]*)"/.exec(html)?.[1]?.split(' ');
    expect(look).toEqual(
      expect.arrayContaining(['fixed', 'right-0', 'w-115', 'max-w-full', 'shadow-3', 'z-5']),
    );
    expect(text(html)).toMatch(
      /^Ask a question Phones in this class show it within a few seconds\. Question 0 \/ 500 Answers/,
    );
    expect(html).toMatch(/<button type="button" aria-label="Close"/);
  });

  it('starts with no words and the two answers a question needs, neither removable', () => {
    expect(html).toMatch(/<textarea id="P-prompt" rows="3" maxLength="500"[^>]*><\/textarea>/);
    expect(html.match(/aria-label="Answer [A-F]"/g)).toEqual([
      'aria-label="Answer A"',
      'aria-label="Answer B"',
    ]);
    expect(html).not.toContain('Remove answer');
    // Every answer is the Field's own input, typed at 16 px (the owner's ruling).
    expect(html.match(/<input [^>]*class="[^"]*\btext-input\b[^"]*"/g)).toHaveLength(2);
    expect(html.match(/aria-pressed="false"[^>]*>Mark correct</g)).toHaveLength(2);
  });

  it('ends with Ask the class and Cancel, what the guard means, and nothing failed yet', () => {
    expect(text(html)).toMatch(
      /Add an answer Marking a correct answer is optional\. When you close the question, you choose whether students see it\. Ask the class Cancel You'll see how many picked each answer once 3 have answered\.$/,
    );
    expect(html).toMatch(/<button type="submit" aria-disabled="false" aria-busy="false"/);
    expect(html).not.toMatch(/role="alert"|aria-invalid|closes the open question/);
  });

  it('says asking closes the question open now, when one is', () => {
    expect(text(render(NEW_DRAFT, true))).toMatch(/Asking this closes the open question\.$/);
  });
});

describe('the panel as it is written', () => {
  it('six answers, each removable, and no more to add', () => {
    const html = render({
      prompt: 'Pick one',
      options: ['1', '2', '3', '4', '5', '6'],
      correctOption: null,
    });
    expect(html.match(/aria-label="Remove answer [A-F]"/g)).toHaveLength(6);
    expect(html).not.toContain('Add an answer');
    expect(text(html)).toContain('8 / 500');
  });

  it('the correct one pressed, its letter green and its button saying Correct with a check', () => {
    const html = render({ prompt: 'Q', options: ['x = 1', 'x = 2', 'x = 4'], correctOption: 1 });
    expect(html).toMatch(
      /aria-pressed="true"[^>]*><svg[^>]*\blucide-check\b[^>]*>[^]*?<\/svg>Correct</,
    );
    expect(html.match(/bg-letter-right/g)).toHaveLength(1);
  });

  it('removing an answer moves the correct mark with its answer, or drops it with it', () => {
    // Your questions' own (`withoutAnswer`, saved-questions.test.ts), never a second copy.
    expect(source).toMatch(/onDraft\(withoutAnswer\(draft, i\)\);/);
  });
});

describe('what Bali refuses before it asks (LessonStates)', () => {
  /** What the panel says under each field: Your questions' checks, in Your questions' words. */
  const said = (draft: QuestionDraft) => {
    const found = refusalsOf(draft);
    const removable = draft.options.length > 2;
    return {
      prompt: found.prompt && refusalSaid(found.prompt, 'prompt'),
      options: found.options.map((r) => r && refusalSaid(r, 'answer', removable)),
    };
  };

  it('checks and says through Your questions’ one copy, none of its own (#390’s review)', () => {
    expect(source).toMatch(
      /import \{ readDrafts, refusalsOf, trimmed, withoutAnswer \} from '@\/lib\/saved-questions';/,
    );
    expect(source).toMatch(/import \{ CANT_LOAD_QUESTIONS, type Drafts, refusalSaid \} from/);
    expect(source).not.toMatch(/\\p\{|UNPRINTABLE|INVISIBLE|Write the question first|or remove it/);
    expect(source).toMatch(/const refused = tried \? refusalsOf\(draft\) : null;/);
    expect(source).toMatch(/const found = refusalsOf\(draft\);/);
    expect(source).toMatch(/\{refusalSaid\(refused\.prompt, 'prompt'\)\}/);
    expect(source).toMatch(/\{refusalSaid\(refusal, 'answer', count > QUESTION_OPTIONS_MIN\)\}/);
  });

  it('a question with no words, an empty answer, an answer over 200 characters', () => {
    const long = 'x'.repeat(214);
    expect(said({ prompt: '  ', options: ['A', ' ', long], correctOption: null })).toEqual({
      prompt: 'Write the question first.',
      options: [
        null,
        'Fill in this answer or remove it.',
        'Keep each answer to 200 characters. This one has 214.',
      ],
    });
    // Of the two a question needs, never "remove it": there's no Remove to press.
    expect(said({ prompt: 'Q', options: ['A', ''], correctOption: null }).options).toEqual([
      null,
      'Fill in this answer.',
    ]);
  });

  it('counts characters as the server does: trimmed, by code point', () => {
    const emoji = '🙂'.repeat(200);
    expect(
      said({ prompt: 'Q', options: [` ${emoji} `, 'B'], correctOption: null }).options,
    ).toEqual([null, null]);
    expect(said({ prompt: 'Q', options: [`${emoji}!`, 'B'], correctOption: null }).options[0]).toBe(
      'Keep each answer to 200 characters. This one has 201.',
    );
  });

  it('a tab or a hidden character pasted in, as the server refuses it, never sent to be refused', () => {
    // santa's review (#389's stack): a tab from a numbered list or a spreadsheet, or a soft
    // hyphen or a zero-width space from a web page, was sent, refused 400, and said as the
    // connection's fault, Try again failing for ever.
    expect(
      said({
        prompt: '1.\tWhich value of x?',
        options: ['x\u00ad= 1', 'x =\u200b2'],
        correctOption: null,
      }),
    ).toEqual({ prompt: UNSHOWABLE, options: [UNSHOWABLE, UNSHOWABLE] });
    // A question's line breaks are its own; words no one could see are no words.
    expect(
      said({ prompt: 'Line one\nline two', options: ['A', 'B'], correctOption: null }),
    ).toEqual({
      prompt: null,
      options: [null, null],
    });
    expect(said({ prompt: '\u200b', options: ['\u2800', 'B', 'C'], correctOption: null })).toEqual({
      prompt: 'Write the question first.',
      options: ['Fill in this answer or remove it.', null, null],
    });
  });

  it('says each under its field, marks it, and focuses the first; nothing is sent', () => {
    expect(source).toMatch(
      /if \(first !== -1\) \{\s*setTried\(true\);\s*document\.getElementById\([^)]*\)\?\.focus\(\);\s*return;\s*\}/,
    );
    expect(source).toMatch(/aria-invalid=\{refusal \? true : undefined\}/);
    expect(source).toMatch(/className="col-\[2\/-1\] text-body"/);
  });
});

describe('a failed ask (LessonStates)', () => {
  it('no answer to go by: said with Try again, which resends it under its id', () => {
    expect(askSaid(NO_ANSWER)).toEqual({
      words: "Bali couldn't ask the question. Check your connection and try again.",
      retry: true,
    });
    expect(askSaid({ kind: 'failed', status: 503, retryAfter: undefined }).retry).toBe(true);
    expect(askSaid({ kind: 'refused', status: 409, reason: 'event_id_conflict' }).retry).toBe(true);
    // Try again submits the form again: the same words are the same attempt (L6).
    expect(source).toMatch(
      /\{failed\.retry \? \(\s*<Button variant="secondary" size="sm" type="submit" aria-disabled=\{busy\}>\s*Try again/,
    );
  });

  it('the session ended first: said, with no Try again', () => {
    expect(askSaid(ENDED)).toEqual({
      words: "This session has ended, so Bali didn't ask the question.",
      retry: false,
    });
  });

  it('over the budget: the portal’s words for a 429', () => {
    expect(askSaid({ kind: 'failed', status: 429, retryAfter: 1 }).words).toBe(TOO_MANY_TRIES);
  });

  it('a refusal of another kind is never blamed on the connection', () => {
    for (const status of [400, 403, 404]) {
      expect(askSaid({ kind: 'refused', status, reason: undefined }).words).toBe(
        "Bali couldn't ask the question.",
      );
    }
    expect(askSaid({ kind: 'refused', status: 409, reason: 'event_id_conflict' }).words).toBe(
      "Bali couldn't ask the question.",
    );
  });

  it('is said right above Ask the class, as an alert, with Try again; asked, the panel goes', () => {
    const written = { prompt: 'Q', options: ['A', 'B'], correctOption: null };
    const html = render(written, false, { busy: false, failure: NO_ANSWER, from: null });
    expect(html).toMatch(
      /<p role="alert" class="text-body">Bali couldn&#x27;t ask the question\. Check your connection and try again\.<\/p><button type="submit" aria-disabled="false" class="[^"]*\bh-8\.5\b[^"]*">Try again<\/button><\/div><div class="[^"]*border-t[^"]*"><button type="submit"/,
    );
    const ended = render(written, false, { busy: false, failure: ENDED, from: null });
    expect(text(ended)).toContain("This session has ended, so Bali didn't ask the question.");
    expect(ended).not.toContain('Try again');
    // An ask of one of the teacher's questions is said in their list, never over what is written.
    expect(
      render(written, false, { busy: false, failure: NO_ANSWER, from: BOARD[0].id }),
    ).not.toContain('role="alert"');
    expect(source).toMatch(
      /const answer = await onAsk\(trimmed\(draft\)\);\s*if \(answer\?\.kind === 'opened'\) onAsked\(\);/,
    );
  });

  it('on its way, holds Ask the class and Try again, also in a panel opened again meanwhile', () => {
    const html = render({ prompt: 'Q', options: ['A', 'B'], correctOption: null }, false, {
      busy: true,
      failure: null,
      from: BOARD[0].id,
    });
    // Whichever was asked: one ask at a time, the live question's.
    expect(html).toMatch(/<button type="submit" aria-disabled="true" aria-busy="true"/);
    // The ask is the live question's, not the panel's (santa's review: a panel unmounted mid-send
    // and opened again sent the same words under a second id, a second question closing the first).
    expect(source).not.toMatch(/useState<Failure|sending\.current/);
    expect(source).toMatch(/const \{ busy \} = opening;/);
    expect(source).toMatch(/if \(busy\) return;/);
  });
});

describe('on the class page', () => {
  it('opens on your questions, and writes a new one from there', () => {
    expect(page).toMatch(
      /\{panel === 'ask' && !writing \? \(\s*<PickPanel[^]*?\/>\s*\) : null\}\s*\{panel === 'ask' && writing \? \(\s*<AskPanel[^]*?\/>\s*\) : null\}\s*<\/main>/,
    );
    expect(page).toMatch(/onWrite=\{\(\) => setWriting\(true\)\}/);
    // Ask a question opens it, on whichever card shows (M6, part 2b-2).
    expect(page.match(/onAsk=\{\(\) => setSide\('ask'\)\}/g)).toHaveLength(2);
  });

  it('asks through the live question either way; asked, the panel goes and focus goes to it', () => {
    expect(page.match(/onAsk=\{ask\}/g)).toHaveLength(2);
    expect(page).toMatch(
      /const asked = \(\) => \{\s*if \(sideNow\.current === 'decks'\) return;\s*setSide\(null\);\s*window\.requestAnimationFrame\(\(\) => document\.getElementById\(`\$\{id\}-q`\)\?\.focus\(\)\);\s*\};/,
    );
    // The decks' panel, opened while an ask was on its way, keeps its place and its focus (santa's
    // review): the panel open now, as the last render left it.
    expect(page).toMatch(
      /const sideNow = useRef\(side\);\s*useEffect\(\(\) => \{\s*sideNow\.current = side;\s*\}, \[side\]\);/,
    );
    // What was written goes once it is asked; a question picked leaves it as it was.
    expect(page).toMatch(
      /onAsked=\{\(\) => \{\s*setWriting\(false\);\s*setDraft\(NEW_DRAFT\);\s*asked\(\);\s*\}\}/,
    );
    expect(page).toMatch(/<PickPanel[^]*?onAsked=\{asked\}/);
  });

  it('Cancel drops what was written and its ask’s failure; Close and Escape keep both', () => {
    expect(page).toMatch(
      /onCancel=\{\(\) => \{\s*setWriting\(false\);\s*setDraft\(NEW_DRAFT\);\s*forgetAsk\(\);\s*closePanel\(\);/,
    );
    // The decks' panel closes the same way (M6, part 2c).
    expect(page.match(/onClose=\{closePanel\}/g)).toHaveLength(3);
    expect(page.match(/opening=\{opening\}/g)).toHaveLength(2);
    // Focus back on Ask a question (Show slides for the decks), or on the question when one shows
    // (opened from another tab).
    expect(page).toMatch(
      /const closePanel = \(\) => \{\s*setSide\(null\);\s*\(\s*document\.getElementById\(`\$\{id\}-\$\{side === 'decks' \? 'show' : 'ask'\}`\) \?\?\s*document\.getElementById\(`\$\{id\}-ask`\) \?\?\s*document\.getElementById\(`\$\{id\}-q`\)\s*\)\?\.focus\(\);/,
    );
    expect(source).toMatch(/if \(e\.key === 'Escape'\) onClose\(\);/);
  });

  it('removing an answer moves focus to the one in its place, its button gone', () => {
    expect(source).toMatch(
      /window\.requestAnimationFrame\(\(\) =>\s*document\.getElementById\(`\$\{id\}-a\$\{Math\.min\(i, count - 2\)\}`\)\?\.focus\(\),\s*\);/,
    );
  });

  it('shares the student panel’s place: one opening closes the other', () => {
    // Either side panel (asking, the decks) closes a student's, and a student's closes either.
    expect(page).toMatch(/asking=\{panel !== null\}\s*onStudentPanel=\{\(\) => setSide\(null\)\}/);
    const grid = readFileSync(fileURLToPath(new URL('./live-grid.tsx', import.meta.url)), 'utf8');
    expect(grid).toMatch(
      /useEffect\(\(\) => \{\s*if \(asking\) setPanel\(null\);\s*\}, \[asking\]\);/,
    );
    expect(grid).toMatch(/const open = \(studentId: string\) => \{\s*onStudentPanel\?\.\(\);/);
  });

  it('a new session starts with no panel, nothing written, and your questions first', () => {
    expect(page).toMatch(
      /useEffect\(\(\) => \{\s*setSide\(null\);\s*setWriting\(false\);\s*setDraft\(NEW_DRAFT\);\s*\}, \[grid\?\.id\]\);/,
    );
  });
});
