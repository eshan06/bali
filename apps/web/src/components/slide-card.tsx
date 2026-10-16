'use client';

import type { Slide } from '@bali/shared';
import { useEffect, useRef, useState } from 'react';

import { Button } from '@/components/button';
import { CARD_ALONE } from '@/components/card';
import { askButton, HEAD, ROW } from '@/components/question-card';
import type { OpenDeck } from '@/lib/deck-pdf';
import { type Box, drawPage, type SlideChange, turned } from '@/lib/presenter';
import type { ChangeSaid, DeckState, DeckUnopened, SlideLesson } from '@/lib/use-slide';

/** Why the slide's place says a line in its page's stead (LessonStates, LessonSlideStates). */
export type Unshown = DeckUnopened | 'undrawn';

/**
 * What the slide's place shows (LessonSlideStates): the page drawn on its canvas; Loading… until
 * the deck's first page is drawn; or a line, for a deck that didn't load or open, or a page Bali
 * couldn't draw, never the page before it.
 */
export function placeOf(
  deck: DeckState,
  drawn: boolean,
  undrawn: boolean,
): 'page' | 'loading' | Unshown {
  if (deck.kind === 'failed') return deck.why;
  if (deck.kind === 'loading') return 'loading';
  if (undrawn) return 'undrawn';
  return drawn ? 'page' : 'loading';
}

/** Each line in the slide's place, LessonStates' and LessonSlideStates' words. */
const UNSHOWN: Record<Unshown, string> = {
  unloaded: "Bali couldn't load these slides.",
  mismatch:
    "These slides don't match the PDF you uploaded, so Bali won't show them. Upload it again.",
  unopened: "Bali couldn't open these slides. Try again, or reload this page.",
  undrawn: "Bali couldn't draw this page.",
};

/**
 * A line in the slide's place with its Try again, centred in the white frame; in Present one size
 * up.
 */
export function UnshownLine({
  why,
  onAgain,
  present = false,
}: {
  why: Unshown;
  onAgain: () => void;
  present?: boolean;
}) {
  return (
    <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-3">
      <p role="alert" className={present ? 'text-present-line' : 'text-body'}>
        {UNSHOWN[why]}
      </p>
      <Button variant="secondary" size={present ? 'md' : 'sm'} onClick={onAgain}>
        Try again
      </Button>
    </div>
  );
}

/**
 * The slide's frame: the class page's card's (v2.css's `.slide`), 420 px wide at most beside its
 * controls; or Present's (`.p-slide`), as large as fits the screen with Present's header, its row
 * and the page's own padding and gaps in sight (232 px at 1920 × 1080), 1351 × 760 at most, as
 * PresentSlide draws it, and 16 rem wide at least where the page is wider.
 */
const FRAME = {
  card: 'w-full min-w-0 flex-[0_1_420px] rounded-frame',
  present:
    'mx-auto w-[min(100%,max(16rem,calc((100dvh_-_232px)*16/9)),1351px)] shrink-0 rounded-md',
};

/**
 * The slide: a white 16:9 frame (`FRAME`), its page drawn on a canvas as large as fits (2a's
 * `drawPage`, given the frame's size as the browser lays it out), its shape kept, the canvas
 * filling the frame and its picture fitted in it. Its label is "Slide 4 of 12." and the page's text
 * (decision 8). A turn keeps the page before it until the next is drawn. A page Bali couldn't draw
 * is drawn again by Try again, or, PDF.js having given no answer, the deck is opened again.
 */
export function SlideFrame({
  deck,
  slide,
  onReload,
  look = 'card',
}: {
  deck: DeckState;
  slide: Slide;
  onReload: () => void;
  look?: keyof typeof FRAME;
}) {
  const frame = useRef<HTMLElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [box, setBox] = useState<Box | null>(null);
  const [drawn, setDrawn] = useState<{ deck: OpenDeck; page: number; text: string } | null>(null);
  const [undrawn, setUndrawn] = useState<{
    deck: OpenDeck;
    page: number;
    unanswered: boolean;
  } | null>(null);
  const [redraws, setRedraws] = useState(0);
  const open = deck.kind === 'open' ? deck.deck : null;

  useEffect(() => {
    const el = frame.current;
    if (el === null) return;
    const watch = new ResizeObserver(([entry]) => {
      if (!entry) return;
      const { width, height } = entry.contentRect;
      setBox((cur) => (cur?.width === width && cur.height === height ? cur : { width, height }));
    });
    watch.observe(el);
    return () => watch.disconnect();
  }, []);

  const { page } = slide;
  useEffect(() => {
    const target = canvas.current;
    if (open === null || target === null || box === null || box.width < 1 || box.height < 1) return;
    const stop = new AbortController();
    void drawPage(open.pdf, page, target, box, stop.signal).then((end) => {
      if (stop.signal.aborted || end.kind === 'cancelled') return;
      if (end.kind === 'drawn') setDrawn({ deck: open, page, text: end.text });
      setUndrawn(
        end.kind === 'undrawn' ? { deck: open, page, unanswered: end.unanswered === true } : null,
      );
    });
    return () => stop.abort();
  }, [open, page, box, redraws]);

  const held = open !== null && drawn?.deck === open ? drawn : null;
  const failed = open !== null && undrawn?.deck === open && undrawn.page === page ? undrawn : null;
  const place = placeOf(deck, held !== null, failed !== null);
  const present = look === 'present';
  return (
    <figure
      ref={frame}
      className={`relative aspect-video overflow-hidden border border-border-default bg-surface-card shadow-1 ${FRAME[look]}`}
    >
      <canvas
        ref={canvas}
        role="img"
        aria-label={
          held
            ? `Slide ${held.page} of ${slide.pageCount}.${held.text ? ` ${held.text}` : ''}`
            : undefined
        }
        className={`absolute inset-0 size-full object-contain ${place === 'page' ? '' : 'invisible'}`}
      />
      {place === 'page' ? null : (
        // Scrolls where a narrow frame can't hold a line and its Try again (a phone under 390 px).
        <div className="absolute inset-0 grid place-items-center overflow-y-auto p-5 text-center">
          {place === 'loading' ? (
            <p
              role="status"
              className={`${present ? 'text-present-line' : 'text-body'} text-text-secondary`}
            >
              Loading…
            </p>
          ) : (
            <UnshownLine
              why={place}
              present={present}
              onAgain={
                place === 'undrawn' && !failed?.unanswered
                  ? () => setRedraws((n) => n + 1)
                  : onReload
              }
            />
          )}
        </div>
      )}
    </figure>
  );
}

/** Whether a key goes to what is being typed in (a field, a list, an editor), not to the slide. */
export const typesText = (target: EventTarget | null) => {
  const el = target as { tagName?: unknown; isContentEditable?: unknown } | null;
  return (
    el?.isContentEditable === true || ['INPUT', 'TEXTAREA', 'SELECT'].includes(String(el?.tagName))
  );
};

/** A key pressed on the page, as `keyTurn` reads it. */
export type Key = Pick<
  KeyboardEvent,
  'key' | 'target' | 'defaultPrevented' | 'altKey' | 'ctrlKey' | 'metaKey' | 'shiftKey'
>;

/**
 * Whether focus is in an open side panel (an `aside`: a question being written or picked, a
 * student's moments, a deck being picked), whose keys are its own.
 */
const inPanel = (target: EventTarget | null) =>
  ((target as { closest?: (selector: string) => unknown } | null)?.closest?.('aside') ?? null) !==
  null;

/**
 * The way a key turns the slide: ← back a page, → on one; none for any other key, one with a
 * modifier held, one a control has taken, one that goes to what is being typed in, or one pressed
 * in an open side panel (#416's review).
 */
export function keyTurn(e: Key): -1 | 1 | null {
  const by = e.key === 'ArrowLeft' ? -1 : e.key === 'ArrowRight' ? 1 : null;
  if (by === null || e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) {
    return null;
  }
  return typesText(e.target) || inPanel(e.target) ? null : by;
}

/** The ← and → keys turn the slide (`keyTurn`), the class page's card and Present's alike. */
export function useSlideKeys(turn: (by: -1 | 1) => void) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const by = keyTurn(e);
      if (by === null) return;
      e.preventDefault();
      turn(by);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [turn]);
}

/**
 * What a slide change left to say (LessonStates, LessonSlideStates): it didn't go through, the
 * session ended first, or its deck is gone.
 */
const SAID: Record<ChangeSaid, string> = {
  failed: "Bali couldn't change the slide.",
  over: "This session has ended, so Bali didn't change the slide.",
  gone: "These slides aren't in Your slides anymore, so Bali can't show them.",
};

/**
 * What a slide change left to say, where it was made (the card, Present one size up, a deck in the
 * side panel); one that didn't go through with Try again, held while another is on its way, and
 * named by what it is about (`describedBy`: a deck in the panel's list).
 */
export function SaidLine({
  why,
  held,
  onAgain,
  describedBy,
  present = false,
  className = '',
}: {
  why: ChangeSaid;
  held: boolean;
  onAgain: () => void;
  describedBy?: string;
  present?: boolean;
  className?: string;
}) {
  const type = present ? 'text-present-line' : 'text-body';
  return why === 'failed' ? (
    <div className={`flex flex-wrap items-center gap-x-4 gap-y-3 ${className}`}>
      <p role="alert" className={type}>
        {SAID.failed}
      </p>
      <Button
        variant="secondary"
        size={present ? 'md' : 'sm'}
        onClick={onAgain}
        aria-disabled={held}
        aria-describedby={describedBy}
      >
        Try again
      </Button>
    </div>
  ) : (
    <p role="alert" className={`${type} ${className}`}>
      {SAID[why]}
    </p>
  );
}

/** Stop showing's change: nothing shown. */
export const STOP: SlideChange = { deckId: null, page: null };

/**
 * A slide control's change (none past either end): held while one is on its way, its own button
 * busy (LessonSlideStates, PresentSlideStates).
 */
export const holdFor = (changing: SlideChange | null) => (to: SlideChange | null) => ({
  'aria-disabled': changing !== null || to === null,
  'aria-busy': to !== null && changing?.deckId === to.deckId && changing.page === to.page,
});

interface CardProps {
  id: string;
  lesson: SlideLesson;
  /** What the session shows: the card shows only while a slide does. */
  slide: Slide;
  /** The side panel is open, which Ask a question controls (L7-1b). */
  asking: boolean;
  onAsk: () => void;
}

/**
 * The class page's slide card (M6, part 2b-2; LessonSlide, LessonStates' slide lines, and its
 * intermediate states as LessonSlideStates draws them, drawn on the canvas first): "Slides ·
 * showing", the deck's title ("…" until Your slides are read), Ask a question and Stop showing; the
 * slide beside "4 of 12", Previous and Next, which the ← and → keys press too, but in a field. In
 * the question card's place while no question shows (the conductor's call, 2026-10-16: a question
 * first, this card back after Done), never in Present. A change on its way holds every slide
 * control, its own button busy; what didn't go through is said under the head. Its state is 2b-1's
 * `useSlide`.
 */
export function SlideCard(props: CardProps) {
  useSlideKeys(props.lesson.turn);
  return slideCard(props);
}

/** The card itself, its keys aside: a function of what it shows, so a test presses its buttons. */
export function slideCard({ id, lesson, slide, asking, onAsk }: CardProps) {
  const { title, deck, changing, said, turn } = lesson;
  const hold = holdFor(changing);
  // Stopped: the card at rest takes this one's place, focus on its Ask a question.
  const stopShowing = () =>
    void lesson.stop().then((stopped) => {
      if (stopped) {
        window.requestAnimationFrame(() => document.getElementById(`${id}-ask`)?.focus());
      }
    });
  return (
    <section aria-labelledby={`${id}-slides`} className={`flex flex-col gap-4 ${CARD_ALONE}`}>
      <div className={HEAD}>
        <div className="flex min-w-0 flex-col gap-0.75">
          <p className="text-section-label text-text-brand uppercase">Slides · showing</p>
          {/* Focus comes here once a deck is shown from the side panel (LessonDecksStates). */}
          <h2
            id={`${id}-slides`}
            tabIndex={-1}
            className={`text-h3 text-pretty wrap-break-word${title === null ? ' text-text-tertiary' : ''}`}
          >
            {title ?? '…'}
          </h2>
        </div>
        <div className={ROW}>
          {askButton(id, 'Ask a question', 'secondary', asking, onAsk)}
          <Button variant="secondary" onClick={stopShowing} {...hold(STOP)}>
            Stop showing
          </Button>
        </div>
      </div>
      {said === null ? null : (
        <SaidLine why={said.why} held={changing !== null} onAgain={lesson.again} />
      )}
      <div className="flex flex-wrap items-start gap-x-7 gap-y-5">
        <SlideFrame deck={deck} slide={slide} onReload={lesson.reload} />
        <div className="flex min-w-0 flex-[1_1_260px] flex-col gap-3">
          {/* Said as it changes, so a turn is heard before its page is drawn. */}
          <p aria-live="polite" aria-atomic="true" className="flex items-baseline gap-2">
            <span className="font-num text-data-lg tabular-nums">{slide.page}</span>
            <span className="text-text-secondary">of {slide.pageCount}</span>
          </p>
          <div className={ROW}>
            <Button variant="secondary" onClick={() => turn(-1)} {...hold(turned(slide, -1))}>
              Previous
            </Button>
            <Button onClick={() => turn(1)} {...hold(turned(slide, 1))}>
              Next
            </Button>
          </div>
          <p className="text-caption text-text-tertiary">The ← and → keys turn pages too.</p>
        </div>
      </div>
    </section>
  );
}
