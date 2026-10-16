import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import type { SavedQuestion } from '@bali/shared';
import { createElement, isValidElement, type ReactElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import { ACCOUNT_DELETED, TOO_MANY_TRIES } from '../lib/errors';
import type { QuestionDraft } from '../lib/live-question';
import {
  DraftCard,
  type Drafts,
  focusAfter,
  type Form,
  formAfter,
  nothingToSave,
  type QuestionsActions,
  QuestionsView,
  type Removal,
  removeSaid,
  saveSaid,
  TITLE,
  UNSHOWABLE,
} from './saved-questions';

/*
 * Your questions (L7b, part 1; Questions, QuestionsEdit and LessonStates' lines), drawn in each
 * state from the boards' own data: the list, none yet, loading, failed; a removal asked, on its way
 * and failed; a question written, new and edited, what Bali refuses, and a save that didn't go
 * through. Its buttons are pressed through its own element tree; the page's wiring is read from
 * its source.
 */
const page = readFileSync(
  fileURLToPath(new URL('../app/questions/page.tsx', import.meta.url)),
  'utf8',
);

const at = (iso: string) =>
  new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' }).format(new Date(iso));
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
/** The Questions board's four, oldest first. */
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
    createdAt: '2026-10-07T15:00:00.000Z',
    updatedAt: '2026-10-07T15:00:00.000Z',
  }),
  q(4, {
    prompt: 'How sure are you about factoring now?',
    options: ['Very sure', 'Mostly', 'Not yet'],
    createdAt: '2026-10-06T16:00:00.000Z',
    updatedAt: '2026-10-07T16:00:00.000Z',
  }),
];
const actions = (): QuestionsActions => ({
  write: vi.fn(),
  edit: vi.fn(),
  change: vi.fn(),
  addAnswer: vi.fn(),
  removeAnswer: vi.fn(),
  save: vi.fn(),
  cancel: vi.fn(),
  ask: vi.fn(),
  remove: vi.fn(),
  keep: vi.fn(),
  read: vi.fn(),
});
const form = (words: QuestionDraft, over: Partial<Form> = {}): Form => ({
  draft: null,
  words,
  tried: false,
  busy: false,
  problem: null,
  tries: 0,
  ...over,
});
const view = (
  drafts: Drafts,
  f: Form | null = null,
  removals: Record<string, Removal> = {},
  on = actions(),
) => ({ drafts, form: f, removals, on });
const render = (props: ReturnType<typeof view>) =>
  renderToStaticMarkup(createElement(QuestionsView, props));

/** Markup as read: each tag a space, each run of spaces one. */
const text = (html: string) =>
  html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&#x27;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();

/** Every host element the tree draws, each component drawn out, as React would. */
function hosts(node: ReactNode): ReactElement<Record<string, unknown>>[] {
  if (Array.isArray(node)) return node.flatMap(hosts);
  if (!isValidElement<Record<string, unknown>>(node)) return [];
  if (typeof node.type === 'function') {
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
/** The button whose words are `name`, or the element so labelled, to press or read. */
function find(node: ReactNode, name: string) {
  const found = hosts(node).filter(
    (e) =>
      (e.type === 'button' && words(e.props.children as ReactNode).trim() === name) ||
      e.props['aria-label'] === name,
  );
  if (found.length !== 1) throw new Error(`${found.length} elements named "${name}"`);
  return found[0].props;
}
const press = (node: ReactNode, name: string) => (find(node, name).onClick as () => void)();

describe('the list (Questions)', () => {
  const html = render(view(BOARD));

  it('says the page’s head with Write a question, then each draft in the order given', () => {
    expect(text(html)).toMatch(
      /^Your questions Write questions before class\. In class, ask one with a click\. Write a question Which value of x solves/,
    );
    expect(
      [...html.matchAll(/<p id="q-[^"]+" class="[^"]*">([^<]*)<\/p>/g)].map((m) => m[1]),
    ).toEqual(BOARD.map((d) => d.prompt));
    expect(html).toMatch(
      /<h1 id="q-title" tabindex="-1" class="text-page-title">Your questions<\/h1>/,
    );
    expect(html).toMatch(
      /<button type="button" id="q-write" class="[^"]*\bh-10\b[^"]*"><svg[^>]*lucide-plus/,
    );
  });

  it('draws each draft as the board’s card: its question, its lettered answers, the correct one marked', () => {
    const card = /<li class="([^"]*)">([^]*?)<\/li><li class="grid/.exec(html);
    expect(card?.[1]?.split(' ')).toEqual(
      expect.arrayContaining([
        'grid',
        'grid-cols-[minmax(0,1fr)_auto]',
        'items-start',
        'gap-x-5',
        'gap-y-2',
        'rounded-md',
        'border-border-default',
        'bg-surface-card',
        'p-5',
        'shadow-1',
      ]),
    );
    expect(text(card?.[2] ?? '')).toBe(
      `Which value of x solves x² − 5x + 6 = 0? A x = 1 B x = 2 Correct C x = 4 D x = 6 Added ${at(BOARD[0].createdAt)} Edit Remove`,
    );
    // The letters are drawn, not read: a screen reader hears each answer, then "Correct".
    expect(card?.[2]).toMatch(
      /<span aria-hidden="true" class="[^"]*\bsize-6\b[^"]*\bbg-letter-right\b[^"]*">B<\/span>/,
    );
    expect(card?.[2]).toMatch(
      /<span aria-hidden="true" class="[^"]*\bbg-surface-sunken\b[^"]*">A<\/span>/,
    );
    expect(card?.[2]).toMatch(
      /<span class="[^"]*\btext-section-label\b[^"]*\btext-text-brand\b[^"]*\buppercase\b[^"]*"><svg [^>]*width="14" height="14"[^>]*lucide-circle-check[^>]*>.*?<\/svg>Correct<\/span>/,
    );
  });

  it('says Added on its first write’s day, and Edited on its last, once edited', () => {
    expect(text(html)).toContain(`Not yet Edited ${at(BOARD[3].updatedAt)} Edit Remove`);
    expect(text(html)).toContain(`At 12 Added ${at(BOARD[2].createdAt)}`);
    // A question with no correct answer has no tag.
    expect(text(html)).toMatch(/Very sure B Mostly C Not yet Edited/);
  });

  it('names each Edit and Remove by its question, for a screen reader', () => {
    const id = `q-${BOARD[0].id}`;
    expect(html).toContain(
      `<button type="button" id="${id}-edit" aria-describedby="${id}" aria-disabled="false" class="`,
    );
    expect(html).toContain(
      `<button type="button" id="${id}-remove" aria-describedby="${id}" class="`,
    );
  });

  it('opens a question to edit, asks before removing one, and writes a new one', () => {
    const on = actions();
    const tree = QuestionsView(view([BOARD[0]], null, {}, on));
    press(tree, 'Edit');
    press(tree, 'Remove');
    press(tree, 'Write a question');
    expect(on.edit).toHaveBeenCalledWith(BOARD[0].id);
    expect(on.ask).toHaveBeenCalledWith(BOARD[0].id);
    expect(on.write).toHaveBeenCalledOnce();
  });
});

describe('the list’s other states (LessonStates)', () => {
  it('says none yet in a plain line, and Write a question stays', () => {
    const html = render(view([]));
    expect(text(html)).toBe(
      'Your questions Write questions before class. In class, ask one with a click. Write a question No questions yet. Write one now, then ask it in class with a click.',
    );
    expect(html).toMatch(/<p class="text-body text-text-secondary">No questions yet\./);
  });

  it('says nothing of none yet while the first one is being written', () => {
    expect(
      text(render(view([], form({ prompt: '', options: ['', ''], correctOption: null })))),
    ).not.toContain('No questions yet');
  });

  it('says Loading… while the list is read', () => {
    expect(render(view('loading'))).toContain(
      '<p role="status" class="text-body text-text-secondary">Loading…</p>',
    );
  });

  it('says a failed read with Try again, which reads it again', () => {
    const on = actions();
    const props = view('failed', null, {}, on);
    expect(render(props)).toMatch(
      /<p role="alert" class="text-body">Bali couldn&#x27;t load your questions\.<\/p><button type="button" class="[^"]*\bh-8\.5\b[^"]*">Try again<\/button>/,
    );
    press(QuestionsView(props), 'Try again');
    expect(on.read).toHaveBeenCalledOnce();
  });
});

describe('removing a draft (Questions’ third card)', () => {
  const card = (removal: Removal | undefined, on = actions()) => ({
    draft: BOARD[2],
    removal,
    on,
  });
  const id = `q-${BOARD[2].id}`;

  it('asks across the card’s foot, with Remove and Keep in place of Edit and Remove', () => {
    const html = renderToStaticMarkup(
      createElement(DraftCard, card({ busy: false, failure: null })),
    );
    expect(text(html)).toBe(
      `Where does the graph of y = (x − 3)(x − 4) cross the x-axis? A At 3 and 4 Correct B At −3 and −4 C At 12 Added ${at(BOARD[2].createdAt)} Remove this question? Questions you already asked keep their results. Remove Keep`,
    );
    expect(html).toMatch(
      new RegExp(
        `<div role="group" aria-labelledby="${id}-rm" class="col-span-full border-t border-border-default pt-3 flex flex-wrap items-center gap-x-4 gap-y-3"><p id="${id}-rm" class="text-body">Remove this question\\?`,
      ),
    );
    expect(html).not.toContain('Edit');
    expect(html).not.toContain(`id="${id}-remove"`);
    expect(html).toContain(`id="${id}-keep"`);
  });

  it('removes on Remove, and keeps on Keep', () => {
    const on = actions();
    const tree = DraftCard(card({ busy: false, failure: null }, on));
    press(tree, 'Remove');
    press(tree, 'Keep');
    expect(on.remove).toHaveBeenCalledWith(BOARD[2].id);
    expect(on.keep).toHaveBeenCalledWith(BOARD[2].id);
  });

  it('holds both while the removal is on its way', () => {
    const on = actions();
    const props = card({ busy: true, failure: null }, on);
    const html = renderToStaticMarkup(createElement(DraftCard, props));
    expect(html.match(/<button type="button" (?:id="[^"]+" )?aria-disabled="true"/g)).toHaveLength(
      2,
    );
    press(DraftCard(props), 'Remove');
    press(DraftCard(props), 'Keep');
    expect(on.remove).not.toHaveBeenCalled();
    expect(on.keep).not.toHaveBeenCalled();
  });

  it('says a removal that failed in the question’s place, Remove there trying again', () => {
    const failed = { kind: 'failed', status: undefined, retryAfter: undefined } as const;
    const html = renderToStaticMarkup(
      createElement(DraftCard, card({ busy: false, failure: failed })),
    );
    expect(html).toContain(
      `<p id="${id}-rm" role="alert" class="text-body">Bali couldn&#x27;t remove the question. Check your connection and try again.</p>`,
    );
    expect(removeSaid({ kind: 'failed', status: 429, retryAfter: 5 })).toBe(TOO_MANY_TRIES);
    expect(removeSaid({ kind: 'refused', status: 403, reason: undefined })).toBe(
      "Bali couldn't remove the question.",
    );
  });
});

const NEW: QuestionDraft = { prompt: '', options: ['', ''], correctOption: null };
const WRITTEN: QuestionDraft = {
  prompt: 'What does the vertex of y = (x − 3)(x − 4) tell you?',
  options: ['Where the curve is lowest', 'Where the curve crosses the x-axis', ''],
  correctOption: 0,
};

describe('writing a question (QuestionsEdit)', () => {
  it('opens over the list, in place of Write a question, its head and its line', () => {
    const html = render(view(BOARD, form(NEW)));
    expect(html).not.toContain('id="q-write"');
    expect(text(html)).toMatch(
      /^Your questions Write questions before class\. In class, ask one with a click\. Write a question Students see it only when you ask it in class\. Question 0 \/ 500 Answers/,
    );
    expect(html).toMatch(
      /<section aria-labelledby="q-h" class="flex max-w-215 flex-col gap-4\.5 [^"]*\bp-5\b/,
    );
    expect(html).toMatch(/<h2 id="q-h" class="text-h3">Write a question<\/h2>/);
    // Then the list, as the board draws it under the card.
    expect(text(html)).toContain('Which value of x solves');
  });

  it('starts with no words and the two answers a question needs, neither removable', () => {
    const html = render(view(BOARD, form(NEW)));
    expect(html).toMatch(
      /<textarea id="q-prompt" rows="3" maxLength="500" autoComplete="off" aria-describedby="q-prompt-count" class="[^"]*\btext-input\b[^"]*"><\/textarea>/,
    );
    expect(html.match(/aria-label="Answer [A-F]"/g)).toEqual([
      'aria-label="Answer A"',
      'aria-label="Answer B"',
    ]);
    expect(html).not.toContain('Remove answer');
    // Every answer is the Field's own input, typed at 16 px (the owner's ruling).
    expect(html.match(/<input [^>]*class="[^"]*\btext-input\b[^"]*"/g)).toHaveLength(2);
    expect(html.match(/aria-pressed="false"[^>]*>Mark correct</g)).toHaveLength(2);
    expect(text(html)).toContain(
      'Add an answer Marking a correct answer is optional. When you close the question, you choose whether students see it. Save Cancel',
    );
    expect(html).not.toMatch(/role="alert"|aria-invalid/);
  });

  it('shows the words being written, the one marked correct, and every answer removable from three', () => {
    const html = render(view(BOARD, form(WRITTEN, { draft: BOARD[0] })));
    expect(html).toContain('>What does the vertex of y = (x − 3)(x − 4) tell you?</textarea>');
    expect(text(html)).toContain('52 / 500');
    expect(html).toMatch(
      /aria-pressed="true"[^>]*><svg[^>]*lucide-check[^>]*>.*?<\/svg>Correct<\/button>/,
    );
    // Its letter stays grey, 28 px, as QuestionsEdit draws it: the Correct button says which.
    expect(html).toMatch(
      /<span aria-hidden="true" class="[^"]*\bsize-7\b[^"]*\bbg-surface-sunken\b[^"]*">A<\/span>/,
    );
    expect(html.match(/aria-label="Remove answer [A-C]"/g)).toHaveLength(3);
    expect(html).toContain('Add an answer');
  });

  it('offers no seventh answer', () => {
    const six = { ...WRITTEN, options: ['a', 'b', 'c', 'd', 'e', 'f'] };
    expect(render(view(BOARD, form(six)))).not.toContain('Add an answer');
  });

  it('hands each change to the page: a word typed, the correct one marked, an answer added or removed', () => {
    const on = actions();
    const tree = QuestionsView(view([], form(WRITTEN), {}, on));
    const typed = (name: string, value: string) =>
      (find(tree, name).onChange as (e: { target: { value: string } }) => void)({
        target: { value },
      });
    typed('Answer C', 'Where it turns');
    expect(on.change).toHaveBeenLastCalledWith({
      ...WRITTEN,
      options: [
        'Where the curve is lowest',
        'Where the curve crosses the x-axis',
        'Where it turns',
      ],
    });
    press(tree, 'Correct');
    expect(on.change).toHaveBeenLastCalledWith({ ...WRITTEN, correctOption: null });
    const marks = hosts(tree).filter(
      (e) => words(e.props.children as ReactNode) === 'Mark correct',
    );
    (marks[1].props.onClick as () => void)();
    expect(on.change).toHaveBeenLastCalledWith({ ...WRITTEN, correctOption: 2 });
    press(tree, 'Add an answer');
    press(tree, 'Remove answer B');
    press(tree, 'Cancel');
    expect(on.addAnswer).toHaveBeenCalledOnce();
    expect(on.removeAnswer).toHaveBeenCalledWith(1);
    expect(on.cancel).toHaveBeenCalledOnce();
  });

  it('saves on submit, the page’s to send', () => {
    const on = actions();
    const tree = QuestionsView(view([], form(WRITTEN), {}, on));
    const submit = hosts(tree).find((e) => e.type === 'form')?.props.onSubmit as (e: {
      preventDefault: () => void;
    }) => void;
    const preventDefault = vi.fn();
    submit({ preventDefault });
    expect(preventDefault).toHaveBeenCalledOnce();
    expect(on.save).toHaveBeenCalledOnce();
    expect(render(view([], form(WRITTEN, { busy: true })))).toMatch(
      /<button type="submit" aria-disabled="true" aria-busy="true" class="[^"]*">Save<\/button>/,
    );
  });
});

describe('what Bali refuses while writing (LessonStates)', () => {
  const said = (words: QuestionDraft) => render(view([], form(words, { tried: true })));

  it('says each under its field once Save is pressed, the field marked', () => {
    const html = said({ prompt: ' ', options: ['x'.repeat(214), '', 'c'], correctOption: null });
    expect(html).toMatch(
      /<textarea id="q-prompt"[^>]*aria-invalid="true" aria-describedby="q-prompt-said q-prompt-count"[^>]*>[^<]*<\/textarea><p id="q-prompt-said" class="text-body">Write the question first\.<\/p>/,
    );
    expect(html).toContain(
      '<p id="q-a0-said" class="col-[2/-1] text-body">Keep each answer to 200 characters. This one has 214.</p>',
    );
    expect(html).toContain(
      '<p id="q-a1-said" class="col-[2/-1] text-body">Fill in this answer or remove it.</p>',
    );
    expect(html.match(/aria-invalid="true"/g)).toHaveLength(3);
    expect(html).not.toContain('q-a2-said');
  });

  it('asks only to fill in an answer that can’t be removed', () => {
    expect(said({ prompt: 'Q', options: ['a', ''], correctOption: null })).toContain(
      '<p id="q-a1-said" class="col-[2/-1] text-body">Fill in this answer.</p>',
    );
  });

  it('says a tab or a hidden character, which the server would refuse', () => {
    const tab = String.fromCharCode(9);
    // Trimmed, a tab at either end is gone, as the server trims it: one inside stays.
    expect(said({ prompt: `Q${tab}`, options: ['a', 'b'], correctOption: null })).not.toContain(
      'q-prompt-said',
    );
    expect(said({ prompt: `Q${tab}x`, options: ['a', 'b'], correctOption: null })).toContain(
      `<p id="q-prompt-said" class="text-body">${UNSHOWABLE.replaceAll("'", '&#x27;')}</p>`,
    );
    // #390's words, the portal's one copy since the class page's panel says them through it too.
    expect(UNSHOWABLE).toBe("This has a tab or a hidden character Bali can't show. Type it again.");
  });

  it('says nothing before Save is pressed', () => {
    expect(render(view([], form({ ...NEW, prompt: ' ' })))).not.toMatch(/-said|aria-invalid/);
  });
});

describe('a save that didn’t go through', () => {
  const failed = (problem: Form['problem']) => render(view([], form(WRITTEN, { problem })));

  it('says it right above Save, with Try again, which sends it again', () => {
    const html = failed({ kind: 'failed', status: undefined, retryAfter: undefined });
    expect(html).toMatch(
      /<div class="flex flex-wrap items-center gap-x-4 gap-y-3"><p role="alert" class="text-body">Bali couldn&#x27;t save the question\. Check your connection and try again\.<\/p><button type="submit" aria-disabled="false" class="[^"]*\bh-8\.5\b[^"]*">Try again<\/button><\/div><div class="[^"]*\bborder-t\b[^"]*"><button type="submit"[^>]*>Save<\/button>/,
    );
  });

  it('says each answer in its words, and offers Try again where it can help', () => {
    expect(saveSaid({ kind: 'failed', status: 503, retryAfter: undefined })).toEqual({
      words: "Bali couldn't save the question. Check your connection and try again.",
      retry: true,
    });
    expect(saveSaid({ kind: 'failed', status: 429, retryAfter: 1 })).toEqual({
      words: TOO_MANY_TRIES,
      retry: true,
    });
    expect(saveSaid({ kind: 'not_saved' })).toEqual({
      words:
        "This question was edited in another tab or on another computer, so Bali didn't save your changes.",
      retry: true,
    });
    expect(saveSaid({ kind: 'gone' })).toEqual({
      words: "This question was removed, so Bali didn't save it.",
      retry: true,
    });
    expect(saveSaid({ kind: 'refused', status: 409, reason: 'event_id_conflict' })).toEqual({
      words: "Bali couldn't save the question.",
      retry: true,
    });
    // Nothing a resend can change: the way on is a fresh sign-in.
    expect(saveSaid({ kind: 'refused', status: 409, reason: 'account_deleted' })).toEqual({
      words: ACCOUNT_DELETED,
      retry: false,
    });
    expect(failed({ kind: 'refused', status: 409, reason: 'account_deleted' })).not.toContain(
      'Try again',
    );
  });
});

describe('a save of the draft’s own words', () => {
  const held = BOARD[0];
  const own = { prompt: held.prompt, options: [...held.options], correctOption: 1 };

  it('sends nothing for the draft’s own words, nor for a new question’s', () => {
    expect(nothingToSave(held, own, null)).toBe(true);
    expect(nothingToSave(held, { ...own, prompt: ` ${held.prompt} ` }, null)).toBe(true);
    expect(nothingToSave(held, { ...own, correctOption: 2 }, null)).toBe(false);
    expect(nothingToSave(null, own, null)).toBe(false);
  });

  it('sends them while a save whose answer never came is held: it may have landed (santa’s review)', () => {
    // Edited B to C correct, saved, the answer lost though it landed; then B again: unless these
    // words are sent, the server keeps C while the card says B.
    const unanswered = { draftId: held.id, ...own, correctOption: 2, eventId: 'e1' };
    expect(nothingToSave(held, own, unanswered)).toBe(false);
  });
});

describe('the page’s wiring (app/questions/page.tsx)', () => {
  it('reads the list as it opens, signed in, and saves each answer’s draft into it', () => {
    expect(page).toMatch(
      /if \(getAccessToken\(\)\) void read\(\);\s*else router\.replace\('\/login'\);/,
    );
    expect(page).toMatch(/setDrafts\(answer\.kind === 'read' \? answer\.drafts : 'failed'\)/);
    expect(page).toMatch(
      /if \(answer\.kind === 'saved' \|\| answer\.kind === 'not_saved'\) listed\(answer\.draft\);/,
    );
  });

  it('mints each save after the draft it holds, and sends one with no answer again', () => {
    expect(page).toMatch(
      /if \(draft && nothingToSave\(draft, form\.words, unsaved\.current\)\) \{/,
    );
    expect(page).toMatch(
      /const attempt = saveAttemptFor\(unsaved\.current, draft, form\.words\);\s*unsaved\.current = attempt;/,
    );
    expect(page).toMatch(/if \(answer\.kind !== 'failed'\) unsaved\.current = null;/);
    // The form after the answer, from the words as last drawn: typed while it was sent included.
    expect(page).toMatch(/const next = formAfter\(drawn\.current, attempt, answer\);/);
    expect(page).toMatch(
      /const attempt = removeAttemptFor\(unremoved\.current\.get\(draftId\), draftId\);/,
    );
    expect(page).toMatch(/if \(answer\.kind !== 'failed'\) unremoved\.current\.delete\(draftId\);/);
  });

  it('takes a removed draft off the list, its confirm with it, and moves focus on from its card', () => {
    expect(page).toMatch(
      /if \(answer\.kind !== 'removed'\) return removal\(draftId, \{ busy: false, failure: answer \}\);/,
    );
    expect(page).toMatch(/unlisted\(draftId\);\s*removal\(draftId, null\);/);
    // Only from the card that went (or from nowhere): never from where the teacher has gone since;
    // to the next card's Edit, else the one before's, else Write a question, else the title.
    expect(page).toMatch(
      /if \(!from \|\| from === document\.body \|\| card\?\.contains\(from\)\) \{\s*setFocus\(\[\.\.\.near, WRITE, TITLE\]\);/,
    );
    expect(page).toMatch(
      /focusAfter\(Array\.isArray\(drafts\) \? drafts : \[\], draftId, 'edit'\)/,
    );
  });

  it('holds Save, Cancel and Edit while a save is on its way, so its answer is always said', () => {
    expect(page).toMatch(/if \(!form \|\| form\.busy\) return;/);
    expect(page).toMatch(/if \(draft && !form\?\.busy\) show\(draft, \[PROMPT\]\);/);
    expect(page).toMatch(/cancel: \(\) => \{\s*if \(!form\?\.busy\) show\(/);
    expect(page).toMatch(/if \(mine !== opened\.current \|\| !drawn\.current\) return;/);
    // Leaving a save whose answer never came (Cancel, Edit, Write) reads the list again: it may
    // have landed, and the cards then show the drafts as they are, or that they couldn't load.
    expect(page).toMatch(
      /opened\.current \+= 1;[^]*?if \(unsaved\.current\) void read\(\);\s*unsaved\.current = null;/,
    );
  });
});

describe('the form once a save is answered', () => {
  const held = BOARD[0];
  const words = { prompt: 'Q', options: ['a', 'b'], correctOption: 0 };
  const attempt = { draftId: held.id, ...words, eventId: 'e1' };
  const sent = form(words, { draft: held, busy: true });
  const now = { ...held, ...words, eventId: 'e1' };

  it('closes once saved', () => {
    expect(formAfter(sent, attempt, { kind: 'saved', draft: now })).toBeNull();
  });

  it('stays open over the draft now when words were typed while it was sent', () => {
    const typed = { ...sent, words: { ...words, prompt: 'Q2' } };
    expect(formAfter(typed, attempt, { kind: 'saved', draft: now })).toEqual({
      ...typed,
      draft: now,
      busy: false,
      problem: null,
    });
  });

  it('says not saved over the draft another save left, whose id the next save is minted after', () => {
    const theirs = { ...held, prompt: 'Theirs', eventId: 'e2' };
    expect(formAfter(sent, attempt, { kind: 'not_saved', draft: theirs })).toEqual({
      ...sent,
      draft: theirs,
      busy: false,
      problem: { kind: 'not_saved', draft: theirs },
      tries: 1,
    });
  });

  it('turns a removed draft into a new question, and keeps the draft for any other failure', () => {
    expect(formAfter(sent, attempt, { kind: 'gone' })).toMatchObject({
      draft: null,
      busy: false,
      problem: { kind: 'gone' },
      tries: 1,
    });
    const lost = { kind: 'failed', status: undefined, retryAfter: undefined } as const;
    expect(formAfter({ ...sent, tries: 1 }, attempt, lost)).toMatchObject({
      draft: held,
      busy: false,
      problem: lost,
      tries: 2,
    });
  });

  it('keeps a failure and its Try again, held, while it sends again, Cancel held too', () => {
    const lost = { kind: 'failed', status: undefined, retryAfter: undefined } as const;
    const html = render(view([], form(WRITTEN, { problem: lost, busy: true })));
    expect(html).toMatch(/<button type="submit" aria-disabled="true" class="[^"]*">Try again</);
    expect(html).toMatch(/<button type="button" aria-disabled="true" class="[^"]*">Cancel</);
    // Each answer's toggle is described by its answer, for a screen reader.
    expect(html).toMatch(/aria-pressed="true" aria-describedby="q-a0"/);
  });

  it('holds every card’s Edit while a save is on its way', () => {
    const html = render(view(BOARD, form(WRITTEN, { busy: true })));
    expect(
      html.match(/id="q-[^"]+-edit" aria-describedby="[^"]+" aria-disabled="true"/g),
    ).toHaveLength(4);
  });
});

describe('where focus goes once a draft is removed', () => {
  const ids = BOARD.map((d) => d.id);

  it('to the card after it, else the one before, the page’s title last', () => {
    expect(focusAfter(BOARD, ids[1], 'remove')).toEqual([
      `q-${ids[2]}-remove`,
      `q-${ids[0]}-remove`,
    ]);
    expect(focusAfter(BOARD, ids[3], 'remove')).toEqual([`q-${ids[2]}-remove`]);
    expect(focusAfter(BOARD.slice(0, 1), ids[0], 'remove')).toEqual([]);
    expect(focusAfter(BOARD, 'gone', 'remove')).toEqual([]);
    // The title takes focus when nothing nearer is left: in the tab order only by a press.
    expect(render(view(BOARD))).toContain(
      `<h1 id="${TITLE}" tabindex="-1" class="text-page-title">Your questions</h1>`,
    );
  });
});
