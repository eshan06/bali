import { CircleCheck } from 'lucide-react';

import { BEHIND, isOpen, letterOf, type LiveQuestion } from '@/components/question-card';

/**
 * v2.css's `.p-card`: 20 px corners, 36 × 44 px in, its parts 28 px apart, the card "Class is
 * over" sits on after the bell.
 */
const CARD =
  'flex flex-col gap-7 rounded-lg border border-border-default bg-surface-card px-11 py-9 shadow-1';

/**
 * An answer (`.p-opt`): its 48 px letter, its words, then its count over a bar once the room may
 * see them; at least 108 px tall, 22 × 24 px in. The correct one, once shown, on green-50 in a
 * 2 px green edge, 1 px less in, so it keeps its size (`.p-opt.right`).
 */
const ANSWER =
  'grid min-h-27 grid-cols-[48px_minmax(0,1fr)_auto] items-center gap-x-5 gap-y-3.5 rounded-md';
const PLAIN = 'border border-border-default bg-surface-card px-6 py-5.5';
const RIGHT = 'border-2 border-bar-right bg-option-right px-5.75 py-5.25';

/**
 * The live question on the projector, in the live grid's place (L7, part 2; PresentQuestion,
 * PresentAnswer, and their intermediate states drawn on the canvas first, PresentQuestionStates
 * and PresentQuestionPhone). The room sees totals only, and never anything about one student:
 * "18 of 28 answered" while it is open, and each answer's count only once it is closed and Bali's
 * last read after the close is in (L6's `final`), so no one watches a count move as a classmate
 * answers (ARCHITECTURE, Live lesson, decision 11); under 3 answers no count at all, the server's
 * guard (`counts` null), never one of the portal's own. The correct answer only once students are
 * shown it. Under 1024 px the count goes under the question and the answers one to a row.
 */
export function PresentQuestion({ id, lesson }: { id: string; lesson: LiveQuestion }) {
  const { question: q, results: r } = lesson;
  if (q === null) return null;
  const open = isOpen(lesson);
  const totals = r?.results ?? null;
  const last = !open && r?.final === true;
  // The server's guarded count: null under 3 answers (decision 3).
  const counts = last ? (totals?.counts ?? null) : null;
  const tooFew = last && totals?.counts === null;
  const shown = !open && (q.revealed || totals?.revealed === true);
  return (
    <section aria-labelledby={`${id}-pq`} className={CARD}>
      <div className="flex items-start justify-between gap-x-12 gap-y-4 max-lg:flex-col">
        <div className="min-w-0">
          <p
            className={`text-present-kicker uppercase ${open ? 'text-text-brand' : 'text-text-tertiary'}`}
          >
            {open ? 'Question' : 'Question · closed'}
          </p>
          {/* Right under it, as the boards render: `.app h2`'s margin 0 outranks `.p-prompt`'s. */}
          <h2
            id={`${id}-pq`}
            className="max-w-256 text-present-question text-pretty wrap-break-word"
          >
            {q.prompt}
          </h2>
          {tooFew ? (
            <p className="mt-2 text-present-line text-text-secondary">
              Too few answers to show a breakdown.
            </p>
          ) : null}
        </div>
        {/* Once Bali's first read is in. */}
        {totals ? (
          <p aria-live="polite" className="flex items-baseline gap-2.5 whitespace-nowrap">
            <span className="font-num text-present-countdown tabular-nums">{totals.answered}</span>
            <span className="text-present-line text-text-secondary">
              of {totals.eligible} answered
            </span>
          </p>
        ) : null}
      </div>
      {r?.problem && !r.final ? (
        <p
          role="status"
          className="rounded-sm border border-border-default bg-surface-sunken px-4 py-3 text-present-caption text-text-primary"
        >
          {BEHIND}
        </p>
      ) : null}
      <ul className="grid gap-4 lg:grid-cols-2">
        {q.options.map((option, i) => {
          const right = shown && q.correctOption === i;
          const n = counts?.[i];
          return (
            <li key={i} className={`${ANSWER} ${right ? RIGHT : PLAIN}`}>
              <span
                aria-hidden="true"
                className={`grid size-12 shrink-0 place-items-center rounded-full text-h2 ${right ? 'bg-letter-right text-text-brand' : 'bg-surface-sunken text-text-primary'}`}
              >
                {letterOf(i)}
              </span>
              <span className="flex min-w-0 flex-wrap items-center gap-x-4 gap-y-1 text-h2">
                <span className="min-w-0 wrap-break-word">{option}</span>
                {right ? (
                  <span className="inline-flex items-center gap-1 text-present-tag text-text-brand uppercase">
                    <CircleCheck size={14} aria-hidden="true" />
                    Correct answer
                  </span>
                ) : null}
              </span>
              {n === undefined || totals === null ? null : (
                <>
                  <span className="font-num text-data-lg tabular-nums">{n}</span>
                  <span
                    aria-hidden="true"
                    className={`col-[2/-1] h-3 rounded-full ${right ? 'bg-bar-right' : 'bg-bar'}`}
                    style={{ width: `${Math.round((n / totals.answered) * 100)}%` }}
                  />
                </>
              )}
            </li>
          );
        })}
      </ul>
      <p className="text-present-line text-text-secondary">
        {open
          ? 'Answer in Bali on your phone.'
          : 'Bali shows only these totals, never who picked what.'}
      </p>
    </section>
  );
}
