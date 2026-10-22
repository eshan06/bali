import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import type { Slide } from '@bali/shared';
import { createElement, isValidElement, type ReactElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import type { SlideLesson } from '../lib/use-slide';
import { PresentSlide, presentSlide } from './present-slide';
import { SlideFrame } from './slide-card';
import { TryAgain } from './try-again';

/*
 * Present's slide (M6, part 2d; PresentSlide, and the intermediate states PresentSlideStates and
 * PresentSlidePhone draw), rendered in each state the slide's hook gives it, its buttons pressed
 * through its own element tree; its frame is the class page's card's own (slide-card.test.ts), and
 * its keys are read from its source.
 */
const source = readFileSync(fileURLToPath(new URL('./present-slide.tsx', import.meta.url)), 'utf8');

const slide = (page = 4, pageCount = 12): Slide => ({
  deckId: '0199b000-0000-7000-8000-0000000000d1',
  sha256: 'a'.repeat(64),
  page,
  pageCount,
});
function lesson(over: Partial<SlideLesson> = {}): SlideLesson {
  return {
    slide: slide(),
    title: 'Factoring quadratics',
    deck: { kind: 'loading' },
    changing: null,
    said: null,
    turn: vi.fn(),
    show: vi.fn(() => Promise.resolve(true)),
    stop: vi.fn(() => Promise.resolve(true)),
    again: vi.fn(),
    reload: vi.fn(),
    ...over,
  };
}
const props = (l: SlideLesson, s = slide()) => ({ id: 'L', lesson: l, slide: s });
const render = (l: SlideLesson, s = slide()) =>
  renderToStaticMarkup(createElement(PresentSlide, props(l, s)));

/** Markup as read: each tag a space, each run of spaces one. */
const text = (html: string) =>
  html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&#x27;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
/** A button's tag, by its words. */
const buttonTag = (html: string, words: string) =>
  new RegExp(`<button [^>]*>${words}</button>`).exec(html)?.[0] ?? '';

/** Every host element the tree draws, the frame aside (it draws a page with hooks of its own). */
function hosts(node: ReactNode): ReactElement<Record<string, unknown>>[] {
  if (Array.isArray(node)) return node.flatMap(hosts);
  if (!isValidElement<Record<string, unknown>>(node)) return [];
  // `TryAgain` keeps state of its own: its line, then its button, pressed through its `onRetry`.
  if (node.type === TryAgain) {
    const { onRetry, children } = node.props as Parameters<typeof TryAgain>[0];
    return [...hosts(children), createElement('button', { onClick: onRetry }, 'Try again')];
  }
  if (typeof node.type === 'function' && node.type !== SlideFrame) {
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
const press = (node: ReactNode, name: string) => {
  const button = hosts(node).find(
    (e) => e.type === 'button' && words(e.props.children as ReactNode).trim() === name,
  );
  if (!button) throw new Error(`no button "${name}"`);
  (button.props.onClick as () => void)();
};

describe('Present’s slide (PresentSlide)', () => {
  const html = render(lesson());

  it('is its frame, as large as fits under the header, one size up, then its title, page and buttons', () => {
    // The rest of the page, a container, so its frame is never past 16:9 (`100cqw`).
    expect(html).toMatch(
      /^<section aria-labelledby="L-ps" class="@container flex flex-1 flex-col gap-5\.5"><figure /,
    );
    // Present's frame, the page's width and as tall as the screen leaves, its Loading… one size up
    // (slide-card.test.ts).
    expect(html).toMatch(
      /<figure class="[^"]*\bw-full flex-\[1_1_0\] max-h-\[min\(760px,calc\(100cqw\*9\/16\)\)\]/,
    );
    expect(html).toMatch(
      /<p role="status" class="text-present-line text-text-secondary">Loading…<\/p>/,
    );
    expect(text(html)).toMatch(/Factoring quadratics · 4 of 12 Previous Next Stop showing$/);
  });

  it('says its title and page at 18/24 as PresentSlide draws them, as each changes, on their own line on a phone', () => {
    // A title of one long word (a file's name) wraps rather than run off a phone's screen.
    expect(html).toMatch(
      /<p id="L-ps" aria-live="polite" aria-atomic="true" class="min-w-0 text-h3 font-normal wrap-break-word text-text-secondary tabular-nums max-sm:basis-full max-sm:text-center"><span>Factoring quadratics<\/span> · 4 of 12<\/p>/,
    );
    // Under the slide, in the middle, as the board draws them.
    expect(html).toMatch(
      /<div class="flex flex-wrap items-center justify-center gap-x-4 gap-y-3"><p id="L-ps"/,
    );
  });

  it('says “…” for its title until the teacher’s decks are read', () => {
    expect(render(lesson({ title: null }))).toMatch(
      /<span class="text-text-tertiary">…<\/span> · 4 of 12<\/p>/,
    );
  });

  it('draws Previous, Next and Stop showing as PresentSlide does, each secondary and full size', () => {
    for (const name of ['Previous', 'Next', 'Stop showing']) {
      expect(buttonTag(html, name), name).toMatch(/\bbg-surface-card\b/);
      expect(buttonTag(html, name), name).toMatch(/\bh-10\b/);
    }
  });

  it('names no student, and nothing the room shouldn’t see', () => {
    expect(source).not.toMatch(/displayName|studentId|Student\b|responses|reason/);
    expect(html).not.toMatch(/Every phone|Ask a question/);
  });
});

describe('turning pages on the projector (PresentSlideStates)', () => {
  it('turns with Previous and Next, and stops showing with Stop showing', () => {
    const l = lesson({ stop: vi.fn(() => Promise.resolve(false)) });
    const node = presentSlide(props(l));
    press(node, 'Previous');
    press(node, 'Next');
    expect(l.turn).toHaveBeenNthCalledWith(1, -1);
    expect(l.turn).toHaveBeenNthCalledWith(2, 1);
    press(node, 'Stop showing');
    expect(l.stop).toHaveBeenCalledOnce();
  });

  it('turns with the ← and → keys too, as the class page’s card does', () => {
    expect(source).toMatch(
      /export function PresentSlide\(props: Props\) \{\s*useSlideKeys\(props\.lesson\.turn\);\s*return presentSlide\(props\);/,
    );
  });

  it('holds every control while a change is on its way, its own busy', () => {
    const { deckId } = slide();
    const busy = (changing: SlideLesson['changing']) => {
      const html = render(lesson({ changing }));
      for (const name of ['Previous', 'Next', 'Stop showing']) {
        expect(buttonTag(html, name), name).toMatch(/aria-disabled="true"/);
      }
      return ['Previous', 'Next', 'Stop showing'].filter((n) =>
        /aria-busy="true"/.test(buttonTag(html, n)),
      );
    };
    expect(busy({ deckId, page: 5 })).toEqual(['Next']);
    expect(busy({ deckId, page: 3 })).toEqual(['Previous']);
    expect(busy({ deckId: null, page: null })).toEqual(['Stop showing']);
  });

  it('holds Previous on the first page and Next on the last, both on a deck of one page', () => {
    const held = (s: Slide) =>
      ['Previous', 'Next'].map((n) =>
        /aria-disabled="true"/.test(buttonTag(render(lesson(), s), n)),
      );
    expect(held(slide(1))).toEqual([true, false]);
    expect(held(slide(12))).toEqual([false, true]);
    expect(held(slide(1, 1))).toEqual([true, true]);
  });

  it('gives focus to Present in the header once stopped, the grid back in the slide’s place', async () => {
    const frame = vi.fn<(then: () => void) => void>();
    const focus = vi.fn();
    const getElementById = vi.fn(() => ({ focus }));
    vi.stubGlobal('window', { requestAnimationFrame: frame });
    vi.stubGlobal('document', { getElementById });
    press(presentSlide(props(lesson())), 'Stop showing');
    await vi.waitFor(() => expect(frame).toHaveBeenCalledOnce());
    frame.mock.calls[0]?.[0]();
    expect(getElementById).toHaveBeenCalledWith('L-present');
    expect(focus).toHaveBeenCalledOnce();
    // Not stopped: focus stays.
    press(
      presentSlide(props(lesson({ stop: vi.fn(() => Promise.resolve(false)) }))),
      'Stop showing',
    );
    await Promise.resolve();
    await Promise.resolve();
    expect(frame).toHaveBeenCalledOnce();
    vi.unstubAllGlobals();
  });
});

describe('what a change said, under the row (PresentSlideStates)', () => {
  const turnTo = { deckId: slide().deckId, page: 5 };

  it('says a change that didn’t go through one size up, Try again full size, in the middle', () => {
    const l = lesson({ said: { why: 'failed', change: turnTo } });
    const html = render(l);
    expect(html).toMatch(
      /<div class="flex flex-wrap items-center gap-x-4 gap-y-3 justify-center text-center"><p role="alert" class="text-present-line">Bali couldn&#x27;t change the slide\.<\/p><button type="button" aria-disabled="false" aria-busy="false" class="[^"]*\bh-10\b[^"]*">Try again<\/button><\/div><\/section>$/,
    );
    press(presentSlide(props(l)), 'Try again');
    expect(l.again).toHaveBeenCalledOnce();
    // Sent again: its line kept, Try again held as Loading…; answered, focus on the slide's title
    // and page, under it (LessonRetryStates), its frame's lines landing there too; on Present once
    // a Stop showing sent again gave the grid back, where a Stop showing's own puts it (santa's
    // review).
    expect(render(lesson({ said: { why: 'failed', change: turnTo }, changing: turnTo }))).toMatch(
      /Bali couldn&#x27;t change the slide\.<\/p><button type="button" aria-disabled="true" aria-busy="true" class="[^"]*">Loading…<\/button>/,
    );
    expect(source.match(/then=\{\[`\$\{id\}-ps`\]\}/g)).toHaveLength(1);
    expect(source.match(/then=\{\[`\$\{id\}-ps`, `\$\{id\}-present`\]\}/g)).toHaveLength(1);
    expect(source).toMatch(/document\.getElementById\(`\$\{id\}-present`\)\?\.focus\(\)/);
  });

  it('says the session ended first, and the slides gone, with no Try again', () => {
    const over = render(lesson({ said: { why: 'over', change: turnTo } }));
    expect(over).toMatch(
      /<p role="alert" class="text-present-line justify-center text-center">This session has ended, so Bali didn&#x27;t change the slide\.<\/p><\/section>$/,
    );
    const gone = render(lesson({ said: { why: 'gone', change: turnTo } }));
    expect(text(gone)).toMatch(
      /These slides aren't in Your slides anymore, so Bali can't show them\.$/,
    );
    expect(text(gone)).not.toContain('Try again');
  });
});
