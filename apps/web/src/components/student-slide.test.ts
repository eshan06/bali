import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import type { Slide } from '@bali/shared';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import type { OpenDeck } from '../lib/deck-pdf';
import type { DeckState, DeckUnopened } from '../lib/use-slide';
import { SlideFull, StudentSlide } from './student-slide';

/*
 * The slide on the student's lesson page and in full screen (W5; StudentLesson, StudentSlideFull,
 * and StudentSlideAlone, StudentSlideStates and StudentSlidePhone, drawn first), rendered as each
 * first draws in each state the deck's hook gives it. The page drawn on its canvas needs a browser
 * (slide-card.test.ts reads that part, the presenter's own), and so do the dialog's effects: those
 * are read from the source.
 */
const source = readFileSync(fileURLToPath(new URL('./student-slide.tsx', import.meta.url)), 'utf8');

const slide = (page = 4, pageCount = 12): Slide => ({
  deckId: '0199b000-0000-7000-8000-0000000000d1',
  sha256: 'a'.repeat(64),
  page,
  pageCount,
});
const open: DeckState = { kind: 'open', deck: { pdf: {}, close: vi.fn() } as unknown as OpenDeck };
const onPage = (deck: DeckState = { kind: 'loading' }, s = slide()) =>
  renderToStaticMarkup(
    createElement(StudentSlide, {
      slide: s,
      deck,
      onReload: vi.fn(),
      onFull: vi.fn(),
      fullId: 'L-full',
    }),
  );
const full = (deck: DeckState = { kind: 'loading' }, behind = false) =>
  renderToStaticMarkup(
    createElement(SlideFull, { slide: slide(), deck, behind, onReload: vi.fn(), onLeave: vi.fn() }),
  );
/** Markup as read: each tag a space, each run of spaces one. */
const text = (html: string) =>
  html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&#x27;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
/** The figure's classes: the slide's white frame. */
const frame = (html: string) => /<figure class="([^"]*)">/.exec(html)?.[1]?.split(' ') ?? [];

describe('the slide on the lesson page (StudentLesson)', () => {
  const html = onPage(open);

  it('says which slide over the page, said again as the teacher turns, and Full screen beside it', () => {
    // Its page not drawn yet as it first draws: Loading… in its place.
    expect(text(html)).toBe('Slide 4 of 12 Full screen Loading…');
    expect(html).toMatch(
      /^<section aria-labelledby="([^"]+)" class="min-w-0"><div class="mb-3 flex flex-wrap items-center justify-between gap-2\.5"><h2 id="\1" aria-live="polite" aria-atomic="true" class="text-section-label text-text-brand uppercase">Slide 4 of 12<\/h2>/,
    );
    expect(text(onPage(open, slide(12, 12)))).toBe('Slide 12 of 12 Full screen Loading…');
  });

  it('has Full screen as a small secondary button with its corners, opening a dialog, focus back to it by its id', () => {
    const button = /<button type="button" id="L-full"[^>]*>([^]*?)<\/button>/.exec(html);
    expect(button?.[0]).toMatch(/aria-haspopup="dialog"/);
    expect(button?.[0]).toMatch(/\bh-8\.5\b/);
    expect(button?.[0]).toMatch(/border-border-strong/);
    expect(button?.[1]).toMatch(/lucide-maximize/);
    expect(source).toMatch(/aria-haspopup="dialog" onClick=\{onFull\}/);
  });

  it('draws the page in v2’s white frame, 16:9 at the width it is given, its text the slide’s label', () => {
    expect(frame(html)).toEqual(
      expect.arrayContaining(['aspect-video', 'w-full', 'rounded-frame', 'bg-surface-card']),
    );
    expect(frame(html)).not.toContain('flex-[0_1_420px]');
    expect(html).toMatch(/<canvas role="img" class="[^"]*\binvisible\b/);
    // The label is the presenter's (slide-card.test.ts): which slide it is, then the page's text.
    expect(source).toMatch(
      /<SlideFrame look="student" deck=\{deck\} slide=\{slide\} onReload=\{onReload\} \/>/,
    );
  });

  it('turns no page: a student never has Previous, Next or the arrow keys', () => {
    expect(text(html)).not.toMatch(/Previous|Next|keys/);
    expect(source).not.toMatch(/useSlideKeys|turn\(/);
  });

  it('says Loading… until the page is drawn', () => {
    expect(onPage()).toContain(
      '<p role="status" class="text-body text-text-secondary">Loading…</p>',
    );
  });

  it('says in a student’s words a deck that didn’t load, changed or didn’t open, each with Try again (StudentStates, StudentSlideStates)', () => {
    const lines: [DeckUnopened, string][] = [
      ['unloaded', "Bali couldn't load the slides."],
      [
        'mismatch',
        "These slides don't match the PDF your teacher uploaded, so Bali won't show them.",
      ],
      ['unopened', "Bali couldn't open the slides. Try again, or reload this page."],
    ];
    for (const [why, words] of lines) {
      const said = onPage({ kind: 'failed', why });
      expect(text(said)).toBe(`Slide 4 of 12 Full screen ${words} Try again`);
      expect(said).toMatch(/<p role="alert" class="text-body">/);
      // Never the teacher's: a student uploaded nothing.
      expect(said).not.toMatch(/you uploaded|Upload it again/);
    }
  });
});

describe('the slide in full screen (StudentSlideFull, StudentSlideStates)', () => {
  const html = full(open);

  it('is a native modal over the whole window, 22 px in, on the page’s stone, labelled by which slide it is', () => {
    const dialog = /^<dialog aria-labelledby="([^"]+)" class="([^"]*)">/.exec(html);
    expect(dialog?.[2]?.split(' ')).toEqual(
      expect.arrayContaining([
        'm-0',
        'size-full',
        'max-h-none',
        'max-w-none',
        'bg-surface-page',
        'p-5.5',
        'gap-4.5',
        'open:flex',
        'flex-col',
        'overflow-y-auto',
      ]),
    );
    expect(html).toMatch(
      new RegExp(
        `<p id="${dialog?.[1] ?? '-'}" aria-live="polite" aria-atomic="true" class="text-section-label text-text-brand uppercase">Slide 4 of 12</p>`,
      ),
    );
  });

  it('shows only the slide, then which slide and Exit full screen under it', () => {
    expect(text(html)).toBe('Loading… Slide 4 of 12 Exit full screen');
    const exit = /<button type="button" class="([^"]*)">([^]*?)Exit full screen<\/button>/.exec(
      html,
    );
    expect(exit?.[1]).toMatch(/\bh-8\.5\b/);
    expect(exit?.[2]).toMatch(/lucide-minimize/);
    expect(frame(html)).toEqual(
      expect.arrayContaining(['aspect-video', 'w-full', 'rounded-frame']),
    );
  });

  it('fits the slide and its row in the window, 16:9 and as large as fits over the row, in the middle', () => {
    // The row is a small button's 34 px and the gap 18 over it: 52 px under the slide.
    expect(html).toMatch(
      /<div class="min-h-0 flex-1 \[container-type:size\]"><div class="mx-auto flex w-\[min\(100cqw,calc\(\(100cqh-52px\)\*16\/9\)\)\] flex-col gap-4\.5"><figure/,
    );
  });

  it('says a line in the slide’s place as on the page, in a student’s words', () => {
    expect(text(full({ kind: 'failed', why: 'unloaded' }))).toBe(
      "Bali couldn't load the slides. Try again Slide 4 of 12 Exit full screen",
    );
  });

  it('says Bali can’t be reached over the slide while this page can’t, as over the lesson', () => {
    const behind = full(open, true);
    expect(text(behind)).toBe(
      "Can't reach Bali right now, so this page may be behind. It keeps trying. Loading… Slide 4 of 12 Exit full screen",
    );
    expect(behind).toMatch(
      /^<dialog [^>]*><p role="status" class="[^"]*bg-surface-sunken[^"]*">Can/,
    );
    expect(html).not.toMatch(/Can.t reach/);
  });

  it('opens as a modal, focus on Exit full screen, and leaves on Exit full screen, Esc, or the browser leaving full screen', () => {
    expect(source).toMatch(
      /if \(dialog\.current && !dialog\.current\.open\) dialog\.current\.showModal\(\);\s*exit\.current\?\.focus\(\);/,
    );
    // Esc, where the browser isn't full screen: the dialog's own, closed by the page.
    expect(source).toMatch(
      /onCancel=\{\(e\) => \{[^}]*e\.preventDefault\(\);\s*onLeave\(\);\s*\}\}/,
    );
    // Esc where it is: the browser leaves full screen, and so does the slide.
    expect(source).toMatch(
      /const left = \(\) => \{\s*if \(!document\.fullscreenElement\) leave\.current\(\);\s*\};\s*document\.addEventListener\('fullscreenchange', left\);\s*return \(\) => document\.removeEventListener\('fullscreenchange', left\);/,
    );
    expect(source).toMatch(
      /<Button ref=\{exit\} variant="secondary" size="sm" onClick=\{onLeave\}>/,
    );
    // The page goes full screen on Full screen's own press, never here (a browser allows it only on
    // a press), and leaves it as the page closes this (student-lesson.test.ts).
    expect(source).not.toMatch(/requestFullscreen|exitFullscreen/);
  });
});
