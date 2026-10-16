'use client';

import type { Slide } from '@bali/shared';
import { Maximize, Minimize } from 'lucide-react';
import { useEffect, useId, useRef } from 'react';

import type { DeckState } from '@/lib/use-slide';

import { Button } from './button';
import { SlideFrame } from './slide-card';
import { CantReach } from './your-phone';

/** "Slide 4 of 12" over the slide and under it in full screen (StudentLesson, StudentSlideFull). */
const KICKER = 'text-section-label text-text-brand uppercase';

/**
 * The slide the teacher shows, on the student's lesson page (W5; StudentLesson, StudentNotIn,
 * StudentClosed, StudentZoom, and StudentSlideAlone, StudentSlideStates and StudentSlidePhone, drawn
 * first): "Slide 4 of 12", said again as the teacher turns, and Full screen over the page, drawn by
 * PDF.js as the presenter's is (`SlideFrame`), the page's text its label for a screen reader
 * (decision 8). A student never turns a page.
 */
export function StudentSlide({
  slide,
  deck,
  onReload,
  onFull,
  fullId,
}: {
  slide: Slide;
  deck: DeckState;
  onReload: () => void;
  onFull: () => void;
  /** Full screen's id: focus comes back to it once the student leaves full screen. */
  fullId: string;
}) {
  const id = useId();
  return (
    <section aria-labelledby={id} className="min-w-0">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2.5">
        {/* Said as the teacher turns, before the page is drawn. */}
        <h2 id={id} aria-live="polite" aria-atomic="true" className={KICKER}>
          Slide {slide.page} of {slide.pageCount}
        </h2>
        <Button id={fullId} variant="secondary" size="sm" aria-haspopup="dialog" onClick={onFull}>
          <Maximize size={16} aria-hidden="true" />
          Full screen
        </Button>
      </div>
      <SlideFrame look="student" deck={deck} slide={slide} onReload={onReload} />
    </section>
  );
}

/**
 * Full screen's view (StudentSlideFull, StudentSlideStates): the window, 22 px in, in the page's
 * stone, a native modal so the page behind it is inert. While this page can't reach Bali,
 * StudentStates' line over the slide, as over the lesson.
 */
const FULL =
  'm-0 size-full max-h-none max-w-none flex-col gap-4.5 overflow-y-auto overscroll-contain bg-surface-page p-5.5 text-text-primary open:flex';

/**
 * The slide in full screen (W5; StudentSlideFull, and StudentSlideStates' full-screen states, drawn
 * first): only the slide the teacher shows, turning with theirs, as large as fits over its row, its
 * shape kept, in the middle; under it "Slide 4 of 12" and Exit full screen. The page itself goes full
 * screen where the browser allows it, on Full screen's press (`enterFullscreen`). Exit full screen
 * and Esc leave it (`onLeave`), whether the dialog or the browser takes the Esc; the page closes it
 * by itself once a question is asked, the slides stop or the class is over (`fullEnds`, PV1).
 */
export function SlideFull({
  slide,
  deck,
  behind,
  onReload,
  onLeave,
}: {
  slide: Slide;
  deck: DeckState;
  behind: boolean;
  onReload: () => void;
  onLeave: () => void;
}) {
  const id = useId();
  const dialog = useRef<HTMLDialogElement>(null);
  const exit = useRef<HTMLButtonElement>(null);
  const leave = useRef(onLeave);
  useEffect(() => {
    leave.current = onLeave;
  }, [onLeave]);

  useEffect(() => {
    if (dialog.current && !dialog.current.open) dialog.current.showModal();
    exit.current?.focus();
    // The browser left full screen (its Esc, or its own control): so does the slide.
    const left = () => {
      if (!document.fullscreenElement) leave.current();
    };
    document.addEventListener('fullscreenchange', left);
    return () => document.removeEventListener('fullscreenchange', left);
  }, []);

  return (
    <dialog
      ref={dialog}
      aria-labelledby={id}
      onCancel={(e) => {
        // Esc, where the browser isn't full screen: the page closes it, as Exit full screen does.
        e.preventDefault();
        onLeave();
      }}
      className={FULL}
    >
      {behind ? <CantReach /> : null}
      {/* The slide and its row as large as fit, 16:9, over the row's 34 px and the gap's 18. */}
      <div className="min-h-0 flex-1 [container-type:size]">
        <div className="mx-auto flex w-[min(100cqw,calc((100cqh-52px)*16/9))] flex-col gap-4.5">
          <SlideFrame look="student" deck={deck} slide={slide} onReload={onReload} />
          <div className="flex flex-wrap items-center justify-between gap-2.5">
            {/* Said as the teacher turns: the page behind, inert, says nothing meanwhile. */}
            <p id={id} aria-live="polite" aria-atomic="true" className={KICKER}>
              Slide {slide.page} of {slide.pageCount}
            </p>
            <Button ref={exit} variant="secondary" size="sm" onClick={onLeave}>
              <Minimize size={16} aria-hidden="true" />
              Exit full screen
            </Button>
          </div>
        </div>
      </div>
    </dialog>
  );
}
