'use client';

import type { Deck } from '@bali/shared';
import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';

import { Panel } from '@/components/ask-panel';
import { Button } from '@/components/button';
import { SaidLine } from '@/components/slide-card';
import { CANT_LOAD_SLIDES, type Decks, showLine } from '@/components/slides';
import { QUIET_LINK } from '@/components/text-link';
import { TryAgain } from '@/components/try-again';
import { readDecks } from '@/lib/decks';
import { readyDecks, type SlideChange } from '@/lib/presenter';
import { useApi } from '@/lib/use-api';
import type { SlideLesson } from '@/lib/use-slide';

/** A deck's own Show: the change to its first page. */
const showOf = (deck: Deck, change: SlideChange | null | undefined) =>
  change?.deckId === deck.id && change.page === 1;

/**
 * Show slides in the side panel (M6, part 2c; LessonDecks, and its intermediate states as
 * LessonDecksStates draws them, drawn on the canvas first): "Pick a deck." over the teacher's ready
 * decks, newest first, each with its pages, the day it was added and Show; the list loading, failed
 * with Try again, or none ready; then the way to Your slides. Its line leaves out "Every phone in
 * this class shows the page you're on, and so does Present." until W5 and M8 make it true (the
 * conductor's call, 2026-10-16). A Show is the slide's own change (`useSlide`'s `show`), one at a
 * time: every Show held meanwhile, its own busy, and what it left to say under its deck, Try again
 * showing it again. The list's Try again keeps its line, held, until Bali answers, then focus on
 * the panel's title (LessonRetryStates). Never in Present.
 */
export function DecksView({
  id,
  decks,
  lesson,
  onRead,
  onShow,
  onClose,
}: {
  id: string;
  decks: Decks;
  lesson: Pick<SlideLesson, 'changing' | 'said'>;
  /** The list read again, its failure said until it answers. */
  onRead: () => Promise<void>;
  /** `again`: its line's Try again, the line kept until Bali answers. */
  onShow: (deck: Deck, again?: boolean) => void;
  onClose: () => void;
}) {
  const { changing, said } = lesson;
  const ready = Array.isArray(decks) ? readyDecks(decks) : [];
  return (
    <Panel id={id} title="Show slides" line="Pick a deck." onClose={onClose}>
      {/* `.panel-body`, its words at the body's 15/22 as `.app` sets them. */}
      <div className="flex flex-col gap-5.5 px-5 pt-4.5 pb-6 text-body">
        {decks === 'loading' ? (
          <p role="status" className="text-text-secondary">
            Loading…
          </p>
        ) : decks === 'failed' ? (
          <div className="flex flex-wrap items-center gap-x-4 gap-y-3">
            <TryAgain onRetry={onRead} then={[`${id}-h`]}>
              <p role="alert">{CANT_LOAD_SLIDES}</p>
            </TryAgain>
          </div>
        ) : ready.length === 0 ? (
          <p>You have no slides ready yet.</p>
        ) : (
          <ul>
            {ready.map((deck) => {
              const name = `${id}-${deck.id}`;
              return (
                <li
                  key={deck.id}
                  className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3.5 gap-y-1 border-t border-border-default py-3 last:border-b"
                >
                  <div className="min-w-0">
                    <p id={name} className="font-semibold wrap-anywhere">
                      {deck.title}
                    </p>
                    <p className="text-caption text-text-tertiary">{showLine(deck)}</p>
                  </div>
                  {/* Held, not disabled, while a change is on its way: focus stays where it is. */}
                  <Button
                    variant="secondary"
                    size="sm"
                    aria-describedby={name}
                    aria-disabled={changing !== null}
                    aria-busy={showOf(deck, changing)}
                    onClick={() => onShow(deck)}
                  >
                    Show
                  </Button>
                  {/* Under its deck, where it happened (LessonDecksStates); a line said in its
                      place, focus on the deck's name (LessonRetryStates). */}
                  {said !== null && showOf(deck, said.change) ? (
                    <SaidLine
                      why={said.why}
                      held={changing !== null}
                      onAgain={() => onShow(deck, true)}
                      then={[name]}
                      describedBy={name}
                      className="col-span-full mt-1.5"
                    />
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
        <Link href="/slides" className={QUIET_LINK}>
          Upload a PDF in Your slides
        </Link>
      </div>
    </Panel>
  );
}

/**
 * The panel as Show slides opens it (LessonDecks): the teacher's decks read from Bali each time it
 * opens, focus coming to its title, and again by Try again, its failure said until the answer. A
 * deck shown while the panel is still open closes it, the slide card in the question card's place
 * (`onShown`).
 */
export function DecksPanel({
  id,
  lesson,
  onShown,
  onClose,
}: {
  id: string;
  lesson: Pick<SlideLesson, 'changing' | 'said' | 'show'>;
  onShown: () => void;
  onClose: () => void;
}) {
  const api = useApi();
  const [decks, setDecks] = useState<Decks>('loading');
  const read = useCallback(async () => {
    const answer = await readDecks(api);
    setDecks(answer.kind === 'read' ? answer.decks : 'failed');
  }, [api]);
  useEffect(() => {
    void read();
  }, [read]);
  // Focus into the panel as it opens, at its title.
  useEffect(() => document.getElementById(`${id}-h`)?.focus(), [id]);
  // Open still: a Show that lands after the panel was closed, or another opened, moves nothing.
  const open = useRef(false);
  useEffect(() => {
    open.current = true;
    return () => {
      open.current = false;
    };
  }, []);
  const show = (deck: Deck, again = false) =>
    void lesson.show(deck.id, again).then((shown) => {
      if (shown && open.current) onShown();
    });
  return (
    <DecksView
      id={id}
      decks={decks}
      lesson={lesson}
      onRead={read}
      onShow={show}
      onClose={onClose}
    />
  );
}
