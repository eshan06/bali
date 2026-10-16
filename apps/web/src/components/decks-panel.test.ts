import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import type { Deck } from '@bali/shared';
import Link from 'next/link';
import { createElement, isValidElement, type ReactElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import type { SlideChange } from '../lib/presenter';
import type { Said } from '../lib/use-slide';
import { DecksView } from './decks-panel';
import type { Decks } from './slides';

/*
 * Show slides in the side panel (M6, part 2c; LessonDecks, LessonStates' lines and the
 * intermediate states LessonDecksStates draws), rendered in each state, its buttons pressed through
 * its own element tree; its read and the page's wiring are read from their source.
 */
const source = readFileSync(fileURLToPath(new URL('./decks-panel.tsx', import.meta.url)), 'utf8');
const page = readFileSync(
  fileURLToPath(new URL('../app/classes/[id]/page.tsx', import.meta.url)),
  'utf8',
);

/** Markup as read: each tag a space, each run of spaces one. */
const text = (html: string) =>
  html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&#x27;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();

const deck = (n: number, over: Partial<Deck> = {}): Deck => ({
  id: `0199b000-0000-7000-8000-0000000000d${n}`,
  title: '',
  status: 'ready',
  bytes: 1_200_000,
  sha256: String(n).repeat(64),
  pageCount: 12,
  rejection: null,
  createdAt: '2026-10-06T15:00:00.000Z',
  ...over,
});
/** LessonDecks' three, newest first as the API lists them, and two it never shows. */
const DECKS: Deck[] = [
  deck(1, { title: 'Factoring quadratics', createdAt: '2026-10-06T15:00:00.000Z' }),
  deck(4, { title: 'Still being checked', status: 'pending', pageCount: null }),
  deck(2, { title: 'Graphing parabolas', pageCount: 9, createdAt: '2026-10-02T15:00:00.000Z' }),
  deck(5, { title: 'A refused one', status: 'rejected', rejection: 'encrypted', pageCount: null }),
  deck(3, { title: 'Unit 2 review', pageCount: 24, createdAt: '2026-09-28T15:00:00.000Z' }),
];
const [A, , B, , C] = DECKS as [Deck, Deck, Deck, Deck, Deck];
const showOf = (d: Deck): SlideChange => ({ deckId: d.id, page: 1 });

const props = (decks: Decks, changing: SlideChange | null = null, said: Said | null = null) => ({
  id: 'P',
  decks,
  lesson: { changing, said },
  onRead: vi.fn(),
  onShow: vi.fn(),
  onClose: vi.fn(),
});
const view = (p: ReturnType<typeof props>) => renderToStaticMarkup(createElement(DecksView, p));

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
/** The markup of each deck's row, in order. */
const rows = (html: string) => [...html.matchAll(/<li class="grid[^"]*">([^]*?)<\/li>/g)];

describe('the panel, picking a deck (LessonDecks)', () => {
  const html = view(props(DECKS));

  it('is v2’s side panel, 372 px from the right, titled Show slides over “Pick a deck.”', () => {
    expect(html).toMatch(/^<aside id="P" aria-labelledby="P-h" class="([^"]*)">/);
    const look = /^<aside [^>]*class="([^"]*)"/.exec(html)?.[1]?.split(' ');
    expect(look).toEqual(expect.arrayContaining(['fixed', 'right-0', 'w-93', 'max-w-full']));
    expect(look).not.toContain('w-115');
    expect(html).toContain('<h2 id="P-h" tabindex="-1" class="text-h3">Show slides</h2>');
    expect(text(html)).toMatch(/^Show slides Pick a deck\. Factoring quadratics/);
    // Its line's second sentence waits for W5 and M8 (the conductor's call, 2026-10-16).
    expect(html).not.toMatch(/Every phone|so does Present/);
    expect(html).toMatch(/<button type="button" aria-label="Close"/);
  });

  it('lists the ready decks alone, newest first as Bali lists them, each with its pages, its day and Show', () => {
    expect(rows(html).map((m) => text(m[1] ?? ''))).toEqual([
      'Factoring quadratics 12 pages · Added Oct 6 Show',
      'Graphing parabolas 9 pages · Added Oct 2 Show',
      'Unit 2 review 24 pages · Added Sep 28 Show',
    ]);
    // A hairline over each and under the last (v2.css's `.pick-list`); Show names its deck.
    expect(html).toMatch(
      /<li class="grid grid-cols-\[minmax\(0,1fr\)_auto\] items-center gap-x-3\.5 gap-y-1 border-t border-border-default py-3 last:border-b">/,
    );
    expect(html).toMatch(
      new RegExp(
        `<p id="P-${A.id}" class="font-semibold wrap-anywhere">Factoring quadratics</p><p class="text-caption text-text-tertiary">12 pages · Added Oct.6</p></div><button type="button" aria-describedby="P-${A.id}" aria-disabled="false" aria-busy="false" class="[^"]*\\bh-8\\.5\\b`,
      ),
    );
  });

  it('shows the deck pressed', () => {
    const p = props(DECKS);
    press(DecksView(p), 'Show', 1);
    expect(p.onShow).toHaveBeenCalledWith(B);
  });

  it('leads to Your slides at its foot, whatever the list says', () => {
    for (const decks of [DECKS, 'loading', 'failed', []] as Decks[]) {
      expect(view(props(decks))).toMatch(
        /<a class="[^"]*" href="\/slides">Upload a PDF in Your slides<\/a><\/div><\/aside>$/,
      );
    }
  });
});

describe('its states (LessonStates, LessonDecksStates)', () => {
  it('says Loading… in the list’s place until Bali answers', () => {
    expect(view(props('loading'))).toMatch(
      /<p role="status" class="text-text-secondary">Loading…<\/p><a /,
    );
  });

  it('says your slides didn’t load, Try again reading them again', () => {
    const p = props('failed');
    expect(text(view(p))).toContain("Bali couldn't load your slides. Try again");
    expect(view(p)).toMatch(/<p role="alert">Bali couldn&#x27;t load your slides\.<\/p>/);
    press(DecksView(p), 'Try again');
    expect(p.onRead).toHaveBeenCalledOnce();
  });

  it('says none are ready yet, none uploaded or none checked', () => {
    const none = [[], DECKS.filter((d) => d.status !== 'ready')];
    for (const decks of none) {
      expect(view(props(decks))).toMatch(/<p>You have no slides ready yet\.<\/p><a /);
    }
  });

  it('holds every Show while a change is on its way, its own busy', () => {
    const busy = (changing: SlideChange) => {
      const html = view(props(DECKS, changing));
      return rows(html).map((m) => [
        /aria-disabled="true"/.test(m[1] ?? ''),
        /aria-busy="true"/.test(m[1] ?? ''),
      ]);
    };
    expect(busy(showOf(B))).toEqual([
      [true, false],
      [true, true],
      [true, false],
    ]);
    // A turn of the card's on its way (another page of a deck shown): every Show held, none busy.
    expect(busy({ deckId: A.id, page: 5 })).toEqual([
      [true, false],
      [true, false],
      [true, false],
    ]);
  });

  it('says a Show that didn’t go through under its deck alone, Try again showing it again', () => {
    const p = props(DECKS, null, { why: 'failed', change: showOf(B) });
    const html = view(p);
    const [first, second, third] = rows(html).map((m) => text(m[1] ?? ''));
    expect(first).not.toMatch(/couldn't/);
    expect(second).toBe(
      "Graphing parabolas 9 pages · Added Oct 2 Show Bali couldn't change the slide. Try again",
    );
    expect(third).not.toMatch(/couldn't/);
    expect(html).toMatch(
      /<div class="flex flex-wrap items-center gap-x-4 gap-y-3 col-span-full mt-1\.5"><p role="alert" class="text-body">Bali couldn&#x27;t change the slide\.<\/p>/,
    );
    press(DecksView(p), 'Try again');
    expect(p.onShow).toHaveBeenCalledWith(B);
    // Held while another change is on its way.
    const held = DecksView(props(DECKS, showOf(A), { why: 'failed', change: showOf(B) }));
    expect(buttons(held, 'Try again')[0]?.props['aria-disabled']).toBe(true);
  });

  it('says the session ended first, and the slides gone, under their deck with no Try again', () => {
    const over = view(props(DECKS, null, { why: 'over', change: showOf(A) }));
    expect(text(rows(over)[0]?.[1] ?? '')).toBe(
      "Factoring quadratics 12 pages · Added Oct 6 Show This session has ended, so Bali didn't change the slide.",
    );
    const gone = view(props(DECKS, null, { why: 'gone', change: showOf(C) }));
    expect(text(rows(gone)[2]?.[1] ?? '')).toBe(
      "Unit 2 review 24 pages · Added Sep 28 Show These slides aren't in Your slides anymore, so Bali can't show them.",
    );
    expect(text(gone)).not.toContain('Try again');
  });

  it('says nothing of a turn of the card’s: the card says it, where it was made', () => {
    const html = view(props(DECKS, null, { why: 'failed', change: { deckId: A.id, page: 5 } }));
    expect(text(html)).not.toMatch(/couldn't change/);
  });
});

describe('the panel as Show slides opens it', () => {
  it('reads your slides each time it opens, again by Try again, focus to its title', () => {
    expect(source).toMatch(
      /const read = useCallback\(async \(\) => \{\s*setDecks\('loading'\);\s*const answer = await readDecks\(api\);\s*setDecks\(answer\.kind === 'read' \? answer\.decks : 'failed'\);\s*\}, \[api\]\);/,
    );
    expect(source).toMatch(/useEffect\(\(\) => \{\s*void read\(\);\s*\}, \[read\]\);/);
    expect(source).toMatch(
      /useEffect\(\(\) => document\.getElementById\(`\$\{id\}-h`\)\?\.focus\(\), \[id\]\);/,
    );
  });

  it('shows through the slide’s own change, and closes once shown, only while it is open', () => {
    expect(source).toMatch(
      /void lesson\.show\(deck\.id\)\.then\(\(shown\) => \{\s*if \(shown && open\.current\) onShown\(\);\s*\}\);/,
    );
    expect(source).toMatch(
      /useEffect\(\(\) => \{\s*open\.current = true;\s*return \(\) => \{\s*open\.current = false;\s*\};\s*\}, \[\]\);/,
    );
  });

  it('is opened by Show slides on the card at rest, closed back to it, never in Present', () => {
    expect(page).toMatch(/showing=\{panel === 'decks'\}\s*onShow=\{\(\) => setSide\('decks'\)\}/);
    expect(page).toMatch(
      /\{panel === 'decks' \? \(\s*<DecksPanel id=\{`\$\{id\}-panel`\} lesson=\{slides\} onShown=\{shown\} onClose=\{closePanel\} \/>\s*\) : null\}/,
    );
    expect(page).toMatch(/const panel = present \? null : side;/);
    // Shown: the panel goes, focus to the slide card's title, or to the question shown first.
    expect(page).toMatch(
      /const shown = \(\) => \{\s*setSide\(null\);\s*window\.requestAnimationFrame\(\(\) =>\s*\(document\.getElementById\(`\$\{id\}-slides`\) \?\? document\.getElementById\(`\$\{id\}-q`\)\)\?\.focus\(\),\s*\);\s*\};/,
    );
  });

  it('names no student: its file reads none', () => {
    expect(source).not.toMatch(/displayName|studentId|Student\b|responses/);
  });
});
