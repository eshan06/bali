import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import type { Slide } from '@bali/shared';
import { createElement, type ReactElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import type { OpenDeck } from '@/lib/deck-pdf';
import type { DeckState, DeckUnopened, SlideLesson } from '@/lib/use-slide';

import { placeOf, SaidLine, SlideCard, slideCard, typesText, UnshownLine } from './slide-card';

/*
 * The class page's slide card (M6, part 2b-2; LessonSlide, LessonStates' slide lines and the
 * intermediate states LessonSlideStates draws), rendered in each state 2b-1's hook gives it, its
 * buttons pressed through its own element tree. Its page drawn and its keys need a browser, so they
 * are read from its source; 2b-1's hook is tested beside it (use-slide-hook.test.ts).
 */
const source = readFileSync(fileURLToPath(new URL('./slide-card.tsx', import.meta.url)), 'utf8');

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
const props = (l: SlideLesson, s = slide()) => ({
  id: 'L',
  lesson: l,
  slide: s,
  asking: false,
  onAsk: vi.fn(),
});
const render = (l: SlideLesson, s = slide()) =>
  renderToStaticMarkup(createElement(SlideCard, props(l, s)));
/** Markup as read: each tag a space, each run of spaces one. */
const text = (html: string) =>
  html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&#x27;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
/** A button's tag, by its words. */
const buttonTag = (html: string, words: string) =>
  new RegExp(`<button [^>]*>(?:<svg[^]*?</svg>)?${words}</button>`).exec(html)?.[0] ?? '';

/** The buttons in an element tree, by their words, to press. */
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
const press = (node: ReactNode, words: string) => {
  const click = buttons(node).get(words);
  if (!click) throw new Error(`no button "${words}"`);
  click();
};

const open: DeckState = { kind: 'open', deck: { pdf: {}, close: vi.fn() } as unknown as OpenDeck };

describe('the card while a slide shows (LessonSlide)', () => {
  const html = render(lesson({ deck: open }));

  it('is v2’s card on its own: Slides · showing over its deck’s title, Ask a question and Stop showing', () => {
    expect(html).toMatch(/^<section aria-labelledby="L-slides" class="[^"]*\bp-5\b[^"]*">/);
    expect(text(html)).toMatch(
      /^Slides · showing Factoring quadratics Ask a question Stop showing /,
    );
    expect(html).toMatch(
      /<p class="text-section-label text-text-brand uppercase">Slides · showing<\/p><h2 id="L-slides" tabindex="-1" class="text-h3 text-pretty wrap-break-word">Factoring quadratics<\/h2>/,
    );
    // Ask a question is the question card's own, secondary here as LessonSlide draws it.
    expect(buttonTag(html, 'Ask a question')).toMatch(
      /id="L-ask" aria-expanded="false" class="[^"]*\bbg-surface-card\b/,
    );
    expect(buttonTag(html, 'Stop showing')).toMatch(/aria-disabled="false"/);
  });

  it('shows the slide beside “4 of 12”, Previous, Next and the keys’ line', () => {
    expect(text(html)).toMatch(/4 of 12 Previous Next The ← and → keys turn pages too\.$/);
    // Said whole as it changes, so a turn is heard before its page is drawn.
    expect(html).toMatch(
      /<p aria-live="polite" aria-atomic="true" class="flex items-baseline gap-2"><span [^>]*>4<\/span><span [^>]*>of 12<\/span><\/p>/,
    );
    expect(buttonTag(html, 'Next')).toMatch(/\bbg-action-primary-bg\b/);
    expect(buttonTag(html, 'Previous')).toMatch(/\bbg-surface-card\b/);
    // The frame: white, 16:9, 420 px at most, its canvas filling it, the page fitted in it.
    expect(html).toMatch(
      /<figure class="relative aspect-video w-full min-w-0 flex-\[0_1_420px\] overflow-hidden rounded-frame border border-border-default bg-surface-card shadow-1">/,
    );
    expect(html).toMatch(/<canvas role="img" class="absolute inset-0 size-full object-contain/);
    // The presenter card's sentence is not built (PLAN, M6).
    expect(html).not.toMatch(/Every phone/);
  });

  it('says Loading… in the slide’s place until its first page is drawn', () => {
    // Nothing drawn in a render with no browser: its deck open, or still loading.
    for (const deck of [open, { kind: 'loading' } as const]) {
      const card = render(lesson({ deck }));
      expect(card).toMatch(/<p role="status" class="text-body text-text-secondary">Loading…<\/p>/);
      expect(card).toMatch(/<canvas [^>]*class="[^"]*\binvisible\b/);
    }
    // In the frame's middle, scrolling where a narrow frame can't hold a line and its Try again.
    expect(render(lesson())).toMatch(
      /<div class="absolute inset-0 grid place-items-center overflow-y-auto p-5 text-center"><p role="status"/,
    );
  });

  it('says “…” for its title until the teacher’s decks are read, as a class’s name before it is', () => {
    expect(render(lesson({ title: null }))).toMatch(
      /<h2 id="L-slides" tabindex="-1" class="text-h3 text-pretty wrap-break-word text-text-tertiary">…<\/h2>/,
    );
  });
});

describe('its slide’s place (LessonSlideStates)', () => {
  it('says a deck that didn’t load, changed or didn’t open, each with Try again loading it again', () => {
    const lines: [DeckUnopened, string][] = [
      ['unloaded', "Bali couldn't load these slides."],
      [
        'mismatch',
        "These slides don't match the PDF you uploaded, so Bali won't show them. Upload it again.",
      ],
      ['unopened', "Bali couldn't open these slides. Try again, or reload this page."],
    ];
    for (const [why, words] of lines) {
      const html = render(lesson({ deck: { kind: 'failed', why } }));
      expect(text(html)).toContain(`${words} Try again`);
      expect(html).toMatch(/<p role="alert" class="text-body">/);
      expect(html).not.toContain('Loading…');
    }
  });

  it('says a page it couldn’t draw, Try again drawing it again', () => {
    const again = vi.fn();
    const line = UnshownLine({ why: 'undrawn', onAgain: again });
    expect(text(renderToStaticMarkup(line))).toBe("Bali couldn't draw this page. Try again");
    press(line, 'Try again');
    expect(again).toHaveBeenCalledOnce();
  });

  it('shows the page once drawn, Loading… before, a line in its stead, never the page before it', () => {
    expect(placeOf({ kind: 'loading' }, false, false)).toBe('loading');
    expect(placeOf(open, false, false)).toBe('loading');
    expect(placeOf(open, true, false)).toBe('page');
    expect(placeOf(open, true, true)).toBe('undrawn');
    expect(placeOf({ kind: 'failed', why: 'mismatch' }, true, false)).toBe('mismatch');
  });

  it('draws the page at the frame’s own size, a later draw or the card going stopping one', () => {
    expect(source).toMatch(
      /new ResizeObserver\(\(\[entry\]\) => \{[^]*?const \{ width, height \} = entry\.contentRect;/,
    );
    expect(source).toMatch(
      /void drawPage\(open\.pdf, page, target, box, stop\.signal\)\.then\(\(end\) => \{\s*if \(stop\.signal\.aborted \|\| end\.kind === 'cancelled'\) return;/,
    );
    expect(source).toMatch(/return \(\) => stop\.abort\(\);\s*\}, \[open, page, box, redraws\]\);/);
    // Its label: which slide it is, and the page's text (decision 8).
    expect(source).toMatch(
      /`Slide \$\{held\.page\} of \$\{slide\.pageCount\}\.\$\{held\.text \? ` \$\{held\.text\}` : ''\}`/,
    );
    // Try again: a deck loaded afresh (2b-1), a page drawn again.
    expect(source).toMatch(
      /onAgain=\{place === 'undrawn' \? \(\) => setRedraws\(\(n\) => n \+ 1\) : onReload\}/,
    );
  });
});

describe('turning pages', () => {
  it('turns with Previous and Next, and stops showing with Stop showing', () => {
    // Not stopped: no focus to move, in a test with no browser.
    const l = lesson({ stop: vi.fn(() => Promise.resolve(false)) });
    const card = slideCard(props(l));
    press(card, 'Previous');
    press(card, 'Next');
    expect(l.turn).toHaveBeenNthCalledWith(1, -1);
    expect(l.turn).toHaveBeenNthCalledWith(2, 1);
    press(card, 'Stop showing');
    expect(l.stop).toHaveBeenCalledOnce();
  });

  it('holds every slide control while a change is on its way, but Ask a question, its own button busy', () => {
    const { deckId } = slide();
    const busy = (changing: SlideLesson['changing']) => {
      const html = render(lesson({ changing }));
      for (const words of ['Previous', 'Next', 'Stop showing']) {
        expect(buttonTag(html, words)).toMatch(/aria-disabled="true"/);
      }
      expect(buttonTag(html, 'Ask a question')).not.toMatch(/aria-disabled="|aria-busy="/);
      return ['Previous', 'Next', 'Stop showing'].filter((w) =>
        /aria-busy="true"/.test(buttonTag(html, w)),
      );
    };
    expect(busy({ deckId, page: 5 })).toEqual(['Next']);
    expect(busy({ deckId, page: 3 })).toEqual(['Previous']);
    expect(busy({ deckId: null, page: null })).toEqual(['Stop showing']);
    // Another page than the next or the one before (a slide shown in another tab meanwhile).
    expect(busy({ deckId, page: 9 })).toEqual([]);
    // At rest, none.
    const html = render(lesson());
    for (const words of ['Previous', 'Next', 'Stop showing']) {
      expect(buttonTag(html, words)).toMatch(/aria-busy="false"/);
    }
  });

  it('holds Previous on the first page and Next on the last, both on a deck of one page', () => {
    const held = (s: Slide) =>
      ['Previous', 'Next'].map((w) =>
        /aria-disabled="true"/.test(buttonTag(render(lesson(), s), w)),
      );
    expect(held(slide(1))).toEqual([true, false]);
    expect(held(slide(12))).toEqual([false, true]);
    expect(held(slide(1, 1))).toEqual([true, true]);
    expect(held(slide(4))).toEqual([false, false]);
  });

  it('turns pages with the ← and → keys too, but in a field, or with a key held', () => {
    expect(source).toMatch(
      /const by = e\.key === 'ArrowLeft' \? -1 : e\.key === 'ArrowRight' \? 1 : 0;\s*if \(by === 0 \|\| e\.defaultPrevented \|\| e\.altKey \|\| e\.ctrlKey \|\| e\.metaKey \|\| e\.shiftKey\) \{\s*return;\s*\}\s*if \(typesText\(e\.target\)\) return;\s*e\.preventDefault\(\);\s*turn\(by\);/,
    );
    expect(source).toMatch(/return \(\) => window\.removeEventListener\('keydown', onKey\);/);
    expect(typesText({ tagName: 'INPUT' } as unknown as EventTarget)).toBe(true);
    expect(typesText({ tagName: 'TEXTAREA' } as unknown as EventTarget)).toBe(true);
    expect(typesText({ tagName: 'SELECT' } as unknown as EventTarget)).toBe(true);
    expect(typesText({ tagName: 'DIV', isContentEditable: true } as unknown as EventTarget)).toBe(
      true,
    );
    expect(typesText({ tagName: 'BUTTON' } as unknown as EventTarget)).toBe(false);
    expect(typesText(null)).toBe(false);
  });

  it('sends focus to the card at rest’s Ask a question once stopped, and nowhere if not', async () => {
    const frame = vi.fn<(then: () => void) => void>();
    const focus = vi.fn();
    const getElementById = vi.fn(() => ({ focus }));
    vi.stubGlobal('window', { requestAnimationFrame: frame });
    vi.stubGlobal('document', { getElementById });
    const stopped = lesson();
    press(slideCard(props(stopped)), 'Stop showing');
    await vi.waitFor(() => expect(frame).toHaveBeenCalledOnce());
    frame.mock.calls[0]?.[0]();
    expect(getElementById).toHaveBeenCalledWith('L-ask');
    expect(focus).toHaveBeenCalledOnce();
    const kept = lesson({ stop: vi.fn(() => Promise.resolve(false)) });
    press(slideCard(props(kept)), 'Stop showing');
    await Promise.resolve();
    await Promise.resolve();
    expect(frame).toHaveBeenCalledOnce();
    vi.unstubAllGlobals();
  });
});

describe('what a change said, under the card’s head (LessonStates, LessonSlideStates)', () => {
  const turnTo = { deckId: slide().deckId, page: 5 };

  it('says a change that didn’t go through, Try again sending it again', () => {
    const l = lesson({ said: { why: 'failed', change: turnTo } });
    const html = render(l);
    expect(html).toMatch(
      /<p role="alert" class="text-body">Bali couldn&#x27;t change the slide\.<\/p><button type="button" aria-disabled="false" class="[^"]*\bh-8\.5\b[^"]*">Try again<\/button>/,
    );
    // The line's Try again is the hook's own: the last change again.
    expect(source).toMatch(
      /<SaidLine why=\{said\.why\} held=\{held\} onAgain=\{lesson\.again\} \/>/,
    );
    const again = vi.fn();
    press(SaidLine({ why: 'failed', held: false, onAgain: again }), 'Try again');
    expect(again).toHaveBeenCalledOnce();
    // Held while another change is on its way.
    const busy = render(lesson({ said: { why: 'failed', change: turnTo }, changing: turnTo }));
    expect(buttonTag(busy, 'Try again')).toMatch(/aria-disabled="true"/);
  });

  it('says the session ended first, and the slides gone, with no Try again', () => {
    expect(text(render(lesson({ said: { why: 'over', change: turnTo } })))).toContain(
      "This session has ended, so Bali didn't change the slide.",
    );
    const gone = render(lesson({ said: { why: 'gone', change: turnTo } }));
    expect(text(gone)).toContain(
      "These slides aren't in Your slides anymore, so Bali can't show them.",
    );
    expect(text(gone)).not.toContain('Try again');
  });
});

describe('only the slide, never who is following', () => {
  it('names no student: its file reads none', () => {
    expect(source).not.toMatch(/displayName|studentId|Student\b|responses/);
  });
});
