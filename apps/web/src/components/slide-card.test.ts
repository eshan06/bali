import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import type { Slide } from '@bali/shared';
import { createElement, type ReactElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import type { OpenDeck } from '@/lib/deck-pdf';
import type { DeckState, DeckUnopened, SlideLesson } from '@/lib/use-slide';

import {
  answered,
  type Key,
  keyTurn,
  placeOf,
  type Retried,
  SaidLine,
  SlideCard,
  slideCard,
  SlideFrame,
  typesText,
  UnshownLine,
} from './slide-card';
import { TryAgain } from './try-again';

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
    // `TryAgain` draws its own button: pressed, it calls its `onRetry`.
    if ((n as ReactElement).type === TryAgain) {
      found.set('Try again', (p as Parameters<typeof TryAgain>[0]).onRetry as () => void);
    }
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

/** A key pressed on `target`, nothing held. */
const keyOn = (key: string, target: unknown): Key => ({
  key,
  target: target as EventTarget | null,
  defaultPrevented: false,
  altKey: false,
  ctrlKey: false,
  metaKey: false,
  shiftKey: false,
});

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
    const frame = /<figure class="([^"]*)">/.exec(html)?.[1]?.split(' ');
    expect(frame?.sort()).toEqual(
      [
        'relative',
        'aspect-video',
        'w-full',
        'min-w-0',
        'flex-[0_1_420px]',
        'overflow-hidden',
        'rounded-frame',
        'border',
        'border-border-default',
        'bg-surface-card',
        'shadow-1',
      ].sort(),
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

  it('keeps its line while Try again loads or draws it again, until a newer answer (LessonRetryStates)', () => {
    const failed: DeckState = { kind: 'failed', why: 'unloaded' };
    const deckId = slide().deckId;
    const loaded: Retried = { why: 'unloaded', deckId, deck: failed, failed: null };
    // The deck loading afresh, opened and not drawn yet: no answer, the line said meanwhile.
    for (const deck of [{ kind: 'loading' } as const, open]) {
      expect(answered(loaded, { place: 'loading', deck, failed: null, deckId })).toBe(false);
    }
    // Drawn, or a line from the new answer, however worded: answered.
    expect(answered(loaded, { place: 'page', deck: open, failed: null, deckId })).toBe(true);
    const again: DeckState = { kind: 'failed', why: 'unloaded' };
    expect(answered(loaded, { place: 'unloaded', deck: again, failed: null, deckId })).toBe(true);
    // A page drawn again: the same line until the draw answers, a new one then.
    const undrawn = { page: 4 };
    const drawing: Retried = { why: 'undrawn', deckId, deck: open, failed: undrawn };
    expect(answered(drawing, { place: 'undrawn', deck: open, failed: undrawn, deckId })).toBe(
      false,
    );
    expect(answered(drawing, { place: 'undrawn', deck: open, failed: { page: 4 }, deckId })).toBe(
      true,
    );
    expect(answered(drawing, { place: 'page', deck: open, failed: null, deckId })).toBe(true);
    // Another deck shown meanwhile: its own loading, never this line.
    expect(
      answered(loaded, { place: 'loading', deck: { kind: 'loading' }, failed: null, deckId: 'x' }),
    ).toBe(true);
    // The frame says the kept line, Try again held, while it has no answer.
    expect(source).toMatch(
      /const done = again !== null && answered\(again, \{ place, deck, failed, deckId: slide\.deckId \}\);\s*if \(done\) setAgain\(null\);\s*const shown = again === null \|\| done \? place : again\.why;/,
    );
    expect(source).toMatch(/held=\{again !== null\}\s*then=\{then\}/);
  });

  it('holds its Try again as Loading… with its line, focus once drawn on the slide’s title', () => {
    const held = renderToStaticMarkup(
      UnshownLine({ why: 'unloaded', onAgain: vi.fn(), held: true, then: ['L-slides'] }),
    );
    expect(held).toMatch(
      /<p role="alert" class="text-body">Bali couldn&#x27;t load these slides\.<\/p><button type="button" aria-disabled="true" aria-busy="true" class="[^"]*\bh-8\.5\b[^"]*">Loading…<\/button>/,
    );
    // The card's, Present's and a student's frame each name where focus lands once it is drawn.
    expect(source).toMatch(
      /<SlideFrame deck=\{deck\} slide=\{slide\} onReload=\{lesson\.reload\} then=\{\[`\$\{id\}-slides`\]\} \/>/,
    );
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
    // Try again: a deck loaded afresh (2b-1), a page drawn again, but one PDF.js gave no answer
    // for, whose deck is opened again (its worker most likely gone); its line kept meanwhile.
    expect(source).toMatch(
      /onAgain=\{\(\) => \{\s*setAgain\(\{ why: shown, deck, failed, deckId: slide\.deckId \}\);\s*if \(shown === 'undrawn' && !failed\?\.unanswered\) setRedraws\(\(n\) => n \+ 1\);\s*else onReload\(\);\s*\}\}/,
    );
    expect(source).toMatch(
      /setUndrawn\(\s*end\.kind === 'undrawn' \? \{ deck: open, page, unanswered: end\.unanswered === true \} : null,\s*\);/,
    );
  });
});

describe('Present’s frame (PresentSlide, PresentSlideStates)', () => {
  const draw = (deck: DeckState) =>
    renderToStaticMarkup(
      createElement(SlideFrame, { deck, slide: slide(), onReload: vi.fn(), look: 'present' }),
    );

  it('is the page’s width and as tall as the screen leaves, 760 px and 16:9 at most, as PresentSlide renders', () => {
    // The board's `.app figure` margin 0 outranks `.p-slide`'s auto one: the white frame spans the
    // page, as the question's card does, the page drawn in its middle (1351 × 760 at 1920 × 1080).
    // It grows into what Present's header and its row leave (its section fills the page), so a
    // header on two lines (a 1280 px projector) never pushes the row off the screen.
    const frame = /<figure class="([^"]*)">/.exec(draw(open))?.[1]?.split(' ');
    expect(frame).toEqual(
      expect.arrayContaining([
        'w-full',
        'flex-[1_1_0]',
        'min-h-36',
        'max-h-[min(760px,calc(100cqw*9/16))]',
        'rounded-md',
      ]),
    );
    // Never the card's 16:9 by its width alone, which would keep the frame from shrinking to fit,
    // but on a phone: the screen's width at 16:9, the page scrolling (PresentSlidePhone).
    expect(frame).not.toContain('aspect-video');
    expect(frame).toEqual(expect.arrayContaining(['max-sm:flex-none', 'max-sm:aspect-video']));
    expect(frame).not.toContain('flex-[0_1_420px]');
  });

  it('says Loading… and each line one size up, 24 px in, Try again full size', () => {
    expect(draw(open)).toMatch(
      /<div class="absolute inset-0 grid place-items-center overflow-y-auto p-6 text-center"><p role="status" class="text-present-line text-text-secondary">Loading…<\/p>/,
    );
    const failed = draw({ kind: 'failed', why: 'unloaded' });
    expect(failed).toMatch(/<p role="alert" class="text-present-line">Bali couldn&#x27;t load/);
    expect(buttonTag(failed, 'Try again')).toMatch(/\bh-10\b/);
  });
});

describe('a student’s frame (W5; StudentLesson, StudentSlideFull, StudentSlideStates)', () => {
  const draw = (deck: DeckState) =>
    renderToStaticMarkup(
      createElement(SlideFrame, { deck, slide: slide(), onReload: vi.fn(), look: 'student' }),
    );

  it('is v2.css’s `.slide`, 16:9 at the width it is given, never the card’s 420 px nor Present’s', () => {
    const frame = /<figure class="([^"]*)">/.exec(draw(open))?.[1]?.split(' ');
    expect(frame).toEqual(expect.arrayContaining(['aspect-video', 'w-full', 'rounded-frame']));
    expect(frame).not.toContain('flex-[0_1_420px]');
    expect(frame).not.toContain('flex-[1_1_0]');
  });

  it('says each line in a student’s words, at the page’s size, with Try again small', () => {
    const lines: [DeckUnopened | 'undrawn', string][] = [
      ['unloaded', "Bali couldn't load the slides."],
      [
        'mismatch',
        "These slides don't match the PDF your teacher uploaded, so Bali won't show them.",
      ],
      ['unopened', "Bali couldn't open the slides. Try again, or reload this page."],
      ['undrawn', "Bali couldn't draw this page."],
    ];
    for (const [why, words] of lines) {
      const line = renderToStaticMarkup(UnshownLine({ why, onAgain: vi.fn(), look: 'student' }));
      expect(text(line)).toBe(`${words} Try again`);
      expect(line).toMatch(/<p role="alert" class="text-body">/);
      expect(buttonTag(line, 'Try again')).toMatch(/\bh-8\.5\b/);
    }
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
    // Heard on the window while the card or Present's slide shows, the key then the card's own.
    expect(source).toMatch(
      /const onKey = \(e: KeyboardEvent\) => \{\s*const by = keyTurn\(e\);\s*if \(by === null\) return;\s*e\.preventDefault\(\);\s*turn\(by\);\s*\};\s*window\.addEventListener\('keydown', onKey\);\s*return \(\) => window\.removeEventListener\('keydown', onKey\);/,
    );
    expect(source).toMatch(/export function SlideCard\(props: CardProps\) \{\s*useSlideKeys\(/);
    const page = { tagName: 'BODY', closest: () => null };
    expect(keyTurn(keyOn('ArrowLeft', page))).toBe(-1);
    expect(keyTurn(keyOn('ArrowRight', page))).toBe(1);
    expect(keyTurn(keyOn('ArrowUp', page))).toBeNull();
    for (const held of ['altKey', 'ctrlKey', 'metaKey', 'shiftKey', 'defaultPrevented']) {
      expect(keyTurn({ ...keyOn('ArrowRight', page), [held]: true }), held).toBeNull();
    }
    for (const field of ['INPUT', 'TEXTAREA', 'SELECT']) {
      expect(
        keyTurn(keyOn('ArrowRight', { tagName: field, closest: () => null })),
        field,
      ).toBeNull();
    }
    expect(typesText({ tagName: 'INPUT' } as unknown as EventTarget)).toBe(true);
    expect(typesText({ tagName: 'TEXTAREA' } as unknown as EventTarget)).toBe(true);
    expect(typesText({ tagName: 'SELECT' } as unknown as EventTarget)).toBe(true);
    expect(typesText({ tagName: 'DIV', isContentEditable: true } as unknown as EventTarget)).toBe(
      true,
    );
    expect(typesText({ tagName: 'BUTTON' } as unknown as EventTarget)).toBe(false);
    expect(typesText(null)).toBe(false);
  });

  it('leaves the keys alone anywhere in an open side panel: a question being written, a student’s moments, a deck being picked', () => {
    // #416's review: a teacher in the write form, or on a button in a panel, turned the class's slide.
    const inPanel = (tagName: string) => ({
      tagName,
      closest: (selector: string) => (selector === 'aside' ? { tagName: 'ASIDE' } : null),
    });
    for (const tagName of ['BUTTON', 'A', 'H2', 'ASIDE']) {
      expect(keyTurn(keyOn('ArrowRight', inPanel(tagName))), tagName).toBeNull();
      expect(keyTurn(keyOn('ArrowLeft', inPanel(tagName))), tagName).toBeNull();
    }
    // Anywhere else on the page, a button there included, they turn it.
    expect(keyTurn(keyOn('ArrowRight', { tagName: 'BUTTON', closest: () => null }))).toBe(1);
    // A target that is no element (the window, the document) is the page's.
    expect(keyTurn(keyOn('ArrowRight', {}))).toBe(1);
    expect(keyTurn(keyOn('ArrowRight', null))).toBe(1);
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
      /<p role="alert" class="text-body">Bali couldn&#x27;t change the slide\.<\/p><button type="button" aria-disabled="false" aria-busy="false" class="[^"]*\bh-8\.5\b[^"]*">Try again<\/button>/,
    );
    // The line's Try again is the hook's own: the last change again; answered, focus on the
    // slides' title (LessonRetryStates).
    expect(source).toMatch(
      /<SaidLine\s+why=\{said\.why\}\s+held=\{changing !== null\}\s+onAgain=\{lesson\.again\}\s+then=\{\[`\$\{id\}-slides`\]\}\s*\/>/,
    );
    const again = vi.fn();
    press(SaidLine({ why: 'failed', held: false, onAgain: again, then: [] }), 'Try again');
    expect(again).toHaveBeenCalledOnce();
    // Held as Loading… while it, or another change, is on its way, its line kept.
    expect(
      buttonTag(
        render(lesson({ said: { why: 'failed', change: turnTo }, changing: turnTo })),
        'Loading…',
      ),
    ).toMatch(/aria-disabled="true" aria-busy="true"/);
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

  it('says each one Present’s size there, Try again full size', () => {
    const failed = renderToStaticMarkup(
      SaidLine({ why: 'failed', held: false, onAgain: vi.fn(), then: [], present: true }),
    );
    expect(failed).toMatch(/<p role="alert" class="text-present-line">Bali couldn&#x27;t change/);
    expect(buttonTag(failed, 'Try again')).toMatch(/\bh-10\b/);
    expect(
      renderToStaticMarkup(
        SaidLine({ why: 'over', held: false, onAgain: vi.fn(), then: [], present: true }),
      ),
    ).toMatch(/^<p role="alert" class="text-present-line ">This session has ended/);
  });

  it('names a deck’s line by its deck in Show slides’ list, where the line doesn’t say which', () => {
    expect(
      renderToStaticMarkup(
        SaidLine({ why: 'failed', held: false, onAgain: vi.fn(), then: [], describedBy: 'd1' }),
      ),
    ).toMatch(
      /<button type="button" aria-disabled="false" aria-busy="false" aria-describedby="d1"/,
    );
  });
});

describe('only the slide, never who is following', () => {
  it('names no student: its file reads none', () => {
    expect(source).not.toMatch(/displayName|studentId|Student\b|responses/);
  });
});
