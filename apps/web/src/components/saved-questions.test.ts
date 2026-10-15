import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import type { SavedQuestion } from '@bali/shared';
import { createElement, isValidElement, type ReactElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import { TOO_MANY_TRIES } from '../lib/errors';
import {
  DraftCard,
  type Drafts,
  type QuestionsActions,
  QuestionsView,
  type Removal,
  removeSaid,
} from './saved-questions';

/*
 * Your questions (L7b, part 1; Questions and LessonStates' lines), drawn in each state from the
 * board's own data: the list, none yet, loading, failed; a removal asked, on its way and failed.
 * Its buttons are pressed through its own element tree; the page's wiring is read from its source.
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
  ask: vi.fn(),
  remove: vi.fn(),
  keep: vi.fn(),
  read: vi.fn(),
});
const view = (drafts: Drafts, removals: Record<string, Removal> = {}, on = actions()) => ({
  drafts,
  removals,
  on,
});
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

  it('says the page’s head, then each draft in the order given', () => {
    expect(text(html)).toMatch(
      /^Your questions Write questions before class\. In class, ask one with a click\. Which value of x solves/,
    );
    expect(
      [...html.matchAll(/<p id="q-[^"]+" class="[^"]*">([^<]*)<\/p>/g)].map((m) => m[1]),
    ).toEqual(BOARD.map((d) => d.prompt));
    expect(html).toMatch(/<h1 class="text-page-title">Your questions<\/h1>/);
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
      `Which value of x solves x² − 5x + 6 = 0? A x = 1 B x = 2 Correct C x = 4 D x = 6 Added ${at(BOARD[0].createdAt)} Remove`,
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
    expect(text(html)).toContain(`Not yet Edited ${at(BOARD[3].updatedAt)} Remove`);
    expect(text(html)).toContain(`At 12 Added ${at(BOARD[2].createdAt)}`);
    // A question with no correct answer has no tag.
    expect(text(html)).toMatch(/Very sure B Mostly C Not yet Edited/);
  });

  it('names each Remove by its question, for a screen reader, and asks before removing', () => {
    const id = `q-${BOARD[0].id}`;
    expect(html).toContain(
      `<button type="button" id="${id}-remove" aria-describedby="${id}" class="`,
    );
    const on = actions();
    press(QuestionsView(view([BOARD[0]], {}, on)), 'Remove');
    expect(on.ask).toHaveBeenCalledWith(BOARD[0].id);
  });

  it('offers nothing to write or edit yet: they come with the form (part 1c)', () => {
    expect(html).not.toMatch(/Write a question|>Edit</);
  });
});

describe('the list’s other states (LessonStates)', () => {
  it('says none yet in a plain line', () => {
    const html = render(view([]));
    expect(text(html)).toBe(
      'Your questions Write questions before class. In class, ask one with a click. No questions yet. Write one now, then ask it in class with a click.',
    );
    expect(html).toMatch(/<p class="text-body text-text-secondary">No questions yet\./);
  });

  it('says Loading… while the list is read', () => {
    expect(render(view('loading'))).toContain(
      '<p role="status" class="text-body text-text-secondary">Loading…</p>',
    );
  });

  it('says a failed read with Try again, which reads it again', () => {
    const on = actions();
    const props = view('failed', {}, on);
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

  it('asks across the card’s foot, with Remove and Keep in place of Remove', () => {
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
    expect(html).toContain(`id="${id}-keep"`);
    expect(html).not.toContain(`id="${id}-remove"`);
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

describe('the page’s wiring (app/questions/page.tsx)', () => {
  it('reads the list as it opens, signed in', () => {
    expect(page).toMatch(
      /if \(getAccessToken\(\)\) void read\(\);\s*else router\.replace\('\/login'\);/,
    );
    expect(page).toMatch(/setDrafts\(answer\.kind === 'read' \? answer\.drafts : 'failed'\)/);
  });

  it('sends a removal with no answer again under its id, and forgets it once answered', () => {
    expect(page).toMatch(
      /const attempt = removeAttemptFor\(unremoved\.current\.get\(draftId\), draftId\);/,
    );
    expect(page).toMatch(/if \(answer\.kind !== 'failed'\) unremoved\.current\.delete\(draftId\);/);
  });
});
