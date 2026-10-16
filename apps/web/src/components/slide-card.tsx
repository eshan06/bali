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

/** A line in the slide's place with its Try again, centred in the white frame. */
export function UnshownLine({ why, onAgain }: { why: Unshown; onAgain: () => void }) {
  return (
    <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-3">
      <p role="alert" className="text-body">
        {UNSHOWN[why]}
      </p>
      <Button variant="secondary" size="sm" onClick={onAgain}>
        Try again
      </Button>
    </div>
  );
}

/**
 * The slide: v2.css's `.slide`, a white 16:9 frame 420 px wide at most, its page drawn on a canvas
 * as large as fits (2a's `drawPage`, given the frame's size as the browser lays it out), its shape
 * kept, the canvas filling the frame and its picture fitted in it. Its label is "Slide 4 of 12."
 * and the page's text (decision 8). A turn keeps the page before it until the next is drawn.
 */
function SlideFrame({
  deck,
  slide,
  onReload,
}: {
  deck: DeckState;
  slide: Slide;
  onReload: () => void;
}) {
  const frame = useRef<HTMLElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [box, setBox] = useState<Box | null>(null);
  const [drawn, setDrawn] = useState<{ deck: OpenDeck; page: number; text: string } | null>(null);
  const [undrawn, setUndrawn] = useState<{ deck: OpenDeck; page: number } | null>(null);
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
      setUndrawn(end.kind === 'undrawn' ? { deck: open, page } : null);
    });
    return () => stop.abort();
  }, [open, page, box, redraws]);

  const held = open !== null && drawn?.deck === open ? drawn : null;
  const place = placeOf(
    deck,
    held !== null,
    open !== null && undrawn?.deck === open && undrawn.page === page,
  );
  return (
    <figure
      ref={frame}
      className="relative aspect-video w-full min-w-0 flex-[0_1_420px] overflow-hidden rounded-frame border border-border-default bg-surface-card shadow-1"
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
        <div className="absolute inset-0 grid place-items-center p-5 text-center">
          {place === 'loading' ? (
            <p role="status" className="text-body text-text-secondary">
              Loading…
            </p>
          ) : (
            <UnshownLine
              why={place}
              onAgain={place === 'undrawn' ? () => setRedraws((n) => n + 1) : onReload}
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

/** What a change that ended the session first, or found its deck gone, says (LessonSlideStates). */
const SAID: Record<Exclude<ChangeSaid, 'failed'>, string> = {
  over: "This session has ended, so Bali didn't change the slide.",
  gone: "These slides aren't in Your slides anymore, so Bali can't show them.",
};

/** Stop showing's change: nothing shown. */
const STOP: SlideChange = { deckId: null, page: null };

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
  const { turn } = props.lesson;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const by = e.key === 'ArrowLeft' ? -1 : e.key === 'ArrowRight' ? 1 : 0;
      if (by === 0 || e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) {
        return;
      }
      if (typesText(e.target)) return;
      e.preventDefault();
      turn(by);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [turn]);
  return slideCard(props);
}

/** The card itself, its keys aside: a function of what it shows, so a test presses its buttons. */
export function slideCard({ id, lesson, slide, asking, onAsk }: CardProps) {
  const { title, deck, changing, said, turn } = lesson;
  const held = changing !== null;
  // A slide control's change (none past either end): held while one is on its way, its own button
  // busy (LessonSlideStates).
  const hold = (to: SlideChange | null) => ({
    'aria-disabled': held || to === null,
    'aria-busy': to !== null && changing?.deckId === to.deckId && changing.page === to.page,
  });
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
          <h2
            id={`${id}-slides`}
            className={`text-h3 wrap-break-word${title === null ? ' text-text-tertiary' : ''}`}
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
      {said === 'failed' ? (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-3">
          <p role="alert" className="text-body">
            Bali couldn&apos;t change the slide.
          </p>
          <Button variant="secondary" size="sm" onClick={lesson.again} aria-disabled={held}>
            Try again
          </Button>
        </div>
      ) : said === null ? null : (
        <p role="alert" className="text-body">
          {SAID[said]}
        </p>
      )}
      <div className="flex flex-wrap items-start gap-x-7 gap-y-5">
        <SlideFrame deck={deck} slide={slide} onReload={lesson.reload} />
        <div className="flex min-w-0 flex-[1_1_260px] flex-col gap-3">
          <p className="flex items-baseline gap-2">
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
