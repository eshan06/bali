'use client';

import type { Slide } from '@bali/shared';

import { Button } from '@/components/button';
import { holdFor, SaidLine, SlideFrame, STOP, useSlideKeys } from '@/components/slide-card';
import { turned } from '@/lib/presenter';
import type { SlideLesson } from '@/lib/use-slide';

interface Props {
  id: string;
  lesson: SlideLesson;
  /** What the session shows. */
  slide: Slide;
}

/**
 * Present's slide (M6, part 2d; PresentSlide, and its intermediate states as PresentSlideStates and
 * PresentSlidePhone draw them, drawn on the canvas first), in the live grid's place: the page the
 * session shows in a white frame the page's width, as large as fits under the header (1351 × 760 at
 * 1920 × 1080), its shape kept; under it "Factoring quadratics · 4 of 12", Previous, Next and Stop
 * showing, the class page's own, and the ← and → keys. A question shows first (the conductor's
 * call, 2026-10-16), so the page draws this only while none does. Stop showing gives the grid back,
 * focus on Present in the header.
 */
export function PresentSlide(props: Props) {
  useSlideKeys(props.lesson.turn);
  return presentSlide(props);
}

/** The slide itself, its keys aside: a function of what it shows, so a test presses its buttons. */
export function presentSlide({ id, lesson, slide }: Props) {
  const { title, deck, changing, said, turn } = lesson;
  const hold = holdFor(changing);
  const stopShowing = () =>
    void lesson.stop().then((stopped) => {
      if (stopped) {
        window.requestAnimationFrame(() => document.getElementById(`${id}-present`)?.focus());
      }
    });
  return (
    // The rest of the page, its frame as tall as the screen leaves it (`SlideFrame`'s `present`).
    <section aria-labelledby={`${id}-ps`} className="@container flex flex-1 flex-col gap-5.5">
      <SlideFrame look="present" deck={deck} slide={slide} onReload={lesson.reload} />
      <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-3">
        {/* Said as it changes, so a turn is heard before its page is drawn; a long title wraps. */}
        <p
          id={`${id}-ps`}
          aria-live="polite"
          aria-atomic="true"
          className="min-w-0 text-h3 font-normal wrap-break-word text-text-secondary tabular-nums max-sm:basis-full max-sm:text-center"
        >
          <span className={title === null ? 'text-text-tertiary' : undefined}>{title ?? '…'}</span>
          {` · ${slide.page} of ${slide.pageCount}`}
        </p>
        <Button variant="secondary" onClick={() => turn(-1)} {...hold(turned(slide, -1))}>
          Previous
        </Button>
        <Button variant="secondary" onClick={() => turn(1)} {...hold(turned(slide, 1))}>
          Next
        </Button>
        <Button variant="secondary" onClick={stopShowing} {...hold(STOP)}>
          Stop showing
        </Button>
      </div>
      {said === null ? null : (
        <SaidLine
          why={said.why}
          held={changing !== null}
          onAgain={lesson.again}
          present
          className="justify-center text-center"
        />
      )}
    </section>
  );
}
