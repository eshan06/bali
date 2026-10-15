'use client';

import type { SavedQuestion } from '@bali/shared';
import { CircleCheck } from 'lucide-react';

import { TOO_MANY_TRIES } from '@/lib/errors';
import type { Failure } from '@/lib/live-question';

import { Button } from './button';
import { CARD_ALONE } from './card';

/*
 * Your questions (L7b, part 1; the Questions board, LessonStates' lines for it), drawn from what
 * the page holds: every press is the page's (`app/questions/page.tsx`).
 */

/** The list as last read: on its way, failed, or the drafts, oldest first. */
export type Drafts = 'loading' | 'failed' | SavedQuestion[];

/** A draft's Remove, pressed: asked, on its way (`busy`), or its last try's failure. */
export interface Removal {
  busy: boolean;
  failure: Failure | null;
}

export interface QuestionsActions {
  ask: (draftId: string) => void;
  remove: (draftId: string) => void;
  keep: (draftId: string) => void;
  read: () => void;
}

const LETTERS = 'ABCDEF';
/** An answer's letter (v2.css's `.mini-opts .letter`), 24 px; the correct one's green. */
const letter = (right: boolean) =>
  `grid size-6 shrink-0 place-items-center rounded-full text-caption font-semibold ${right ? 'bg-letter-right text-text-brand' : 'bg-surface-sunken text-text-primary'}`;
const SAID = 'flex flex-wrap items-center gap-x-4 gap-y-3';
const CAPTION = 'text-caption text-text-tertiary';

/** A removal that didn't go through: said in its card, Remove there trying again. */
export function removeSaid(failure: Failure): string {
  if (failure.kind === 'refused') return "Bali couldn't remove the question.";
  return failure.status === 429
    ? TOO_MANY_TRIES
    : "Bali couldn't remove the question. Check your connection and try again.";
}

/**
 * The page (Questions): its head, then the drafts, oldest first, each with Remove; the list
 * loading, failed with Try again, or none yet.
 */
export function QuestionsView({
  drafts,
  removals,
  on,
}: {
  drafts: Drafts;
  removals: Record<string, Removal>;
  on: QuestionsActions;
}) {
  return (
    <main className="flex flex-col gap-5.5">
      <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3">
        <div>
          <h1 className="text-page-title">Your questions</h1>
          <p className="mt-0.5 text-meta text-text-secondary">
            Write questions before class. In class, ask one with a click.
          </p>
        </div>
      </div>
      {drafts === 'loading' ? (
        <p role="status" className="text-body text-text-secondary">
          Loading…
        </p>
      ) : drafts === 'failed' ? (
        <div className={SAID}>
          <p role="alert" className="text-body">
            Bali couldn&apos;t load your questions.
          </p>
          <Button variant="secondary" size="sm" onClick={on.read}>
            Try again
          </Button>
        </div>
      ) : drafts.length > 0 ? (
        <ul className="flex max-w-215 flex-col gap-2.5">
          {drafts.map((draft) => (
            <DraftCard key={draft.id} draft={draft} removal={removals[draft.id]} on={on} />
          ))}
        </ul>
      ) : (
        <p className="text-body text-text-secondary">
          No questions yet. Write one now, then ask it in class with a click.
        </p>
      )}
    </main>
  );
}

/**
 * A draft (`.qcard`): its question, its answers with their letters, the correct one marked, and
 * when it was added or last edited; Remove beside it, or, once pressed, the board's question
 * across the card's foot with Remove and Keep, or its failure in that line's place.
 */
export function DraftCard({
  draft,
  removal,
  on,
}: {
  draft: SavedQuestion;
  removal: Removal | undefined;
  on: QuestionsActions;
}) {
  const id = `q-${draft.id}`;
  const edited = Date.parse(draft.updatedAt) > Date.parse(draft.createdAt);
  const day = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' }).format(
    new Date(edited ? draft.updatedAt : draft.createdAt),
  );
  return (
    <li className={`grid grid-cols-[minmax(0,1fr)_auto] items-start gap-x-5 gap-y-2 ${CARD_ALONE}`}>
      <div className="min-w-0">
        <p id={id} className="font-semibold whitespace-pre-line wrap-anywhere">
          {draft.prompt}
        </p>
        <ul className="flex flex-wrap gap-x-4.5 gap-y-1.5">
          {draft.options.map((option, i) => (
            // On a narrow card the tag goes under the answer, which keeps its letter beside it.
            <li key={i} className="inline-flex min-w-0 flex-wrap items-center gap-2">
              <span className="inline-flex min-w-0 items-center gap-2">
                <span aria-hidden="true" className={letter(i === draft.correctOption)}>
                  {LETTERS[i]}
                </span>
                <span className="min-w-0 wrap-anywhere">{option}</span>
              </span>
              {i === draft.correctOption ? (
                <span className="inline-flex items-center gap-1 text-section-label text-text-brand uppercase">
                  <CircleCheck size={14} aria-hidden="true" />
                  Correct
                </span>
              ) : null}
            </li>
          ))}
        </ul>
        <p className={`mt-2 ${CAPTION}`}>
          {edited ? 'Edited' : 'Added'} {day}
        </p>
      </div>
      {removal ? (
        <div
          role="group"
          aria-labelledby={`${id}-rm`}
          className={`col-span-full border-t border-border-default pt-3 ${SAID}`}
        >
          <p id={`${id}-rm`} role={removal.failure ? 'alert' : undefined} className="text-body">
            {removal.failure
              ? removeSaid(removal.failure)
              : 'Remove this question? Questions you already asked keep their results.'}
          </p>
          <div className="flex flex-wrap items-center gap-2.5">
            {/* Held, not disabled, while it is sent: focus stays where it is. */}
            <Button
              variant="secondary"
              size="sm"
              aria-disabled={removal.busy}
              onClick={() => {
                if (!removal.busy) on.remove(draft.id);
              }}
            >
              Remove
            </Button>
            <Button
              id={`${id}-keep`}
              variant="secondary"
              size="sm"
              aria-disabled={removal.busy}
              onClick={() => {
                if (!removal.busy) on.keep(draft.id);
              }}
            >
              Keep
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-2.5">
          <Button
            id={`${id}-remove`}
            variant="secondary"
            size="sm"
            aria-describedby={id}
            onClick={() => on.ask(draft.id)}
          >
            Remove
          </Button>
        </div>
      )}
    </li>
  );
}
