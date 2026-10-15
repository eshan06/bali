'use client';

import {
  QUESTION_OPTION_MAX_LENGTH,
  QUESTION_OPTIONS_MAX,
  QUESTION_OPTIONS_MIN,
  QUESTION_PROMPT_MAX_LENGTH,
  type SavedQuestion,
} from '@bali/shared';
import { Check, CircleCheck, Plus, X } from 'lucide-react';

import { ACCOUNT_DELETED, TOO_MANY_TRIES } from '@/lib/errors';
import type { Failure, QuestionDraft } from '@/lib/live-question';
import { type Refusal, refusalsOf } from '@/lib/saved-questions';

import { Button } from './button';
import { CARD_ALONE } from './card';
import { Input } from './field';

/*
 * Your questions (L7b, part 1; the Questions and QuestionsEdit boards, LessonStates' lines for
 * them), drawn from what the page holds: every press is the page's (`app/questions/page.tsx`).
 */

/** The list as last read: on its way, failed, or the drafts, oldest first. */
export type Drafts = 'loading' | 'failed' | SavedQuestion[];

/** A save that didn't go through: no answer or refused, or `saveDraft`'s `not_saved` or `gone`. */
export type SaveProblem = Failure | { kind: 'not_saved' } | { kind: 'gone' };

/** The question being written: a new one (`draft` null), or a draft's edit. */
export interface Form {
  draft: SavedQuestion | null;
  words: QuestionDraft;
  /** Save found something Bali won't save: each refusal is said, and follows the typing. */
  tried: boolean;
  busy: boolean;
  problem: SaveProblem | null;
}

/** A draft's Remove, pressed: asked, on its way (`busy`), or its last try's failure. */
export interface Removal {
  busy: boolean;
  failure: Failure | null;
}

export interface QuestionsActions {
  write: () => void;
  edit: (draftId: string) => void;
  change: (words: QuestionDraft) => void;
  addAnswer: () => void;
  removeAnswer: (i: number) => void;
  save: () => void;
  cancel: () => void;
  ask: (draftId: string) => void;
  remove: (draftId: string) => void;
  keep: (draftId: string) => void;
  read: () => void;
}

/** The page's title: where focus goes when nothing nearer is left. */
export const TITLE = 'q-title';
/** The ids the page moves focus to, besides the cards' own. */
export const WRITE = 'q-write';
export const PROMPT = 'q-prompt';
export const answerId = (i: number) => `q-a${i}`;

/**
 * Where focus goes once a draft is removed: the `button` of the card after it, else of the one
 * before (the page's to fall back from).
 */
export function focusAfter(drafts: SavedQuestion[], draftId: string, button: string): string[] {
  const at = drafts.findIndex((d) => d.id === draftId);
  if (at === -1) return [];
  return [drafts[at + 1], drafts[at - 1]].flatMap((d) => (d ? [`q-${d.id}-${button}`] : []));
}

const LETTERS = 'ABCDEF';
/**
 * An answer's letter (v2.css's `.letter`): 24 px in a list, the correct one's green; 28 px in the
 * form, grey, as QuestionsEdit draws it (its Correct button says which).
 */
const letter = (right: boolean, form = false) =>
  `grid shrink-0 place-items-center rounded-full font-semibold ${form ? 'size-7 text-data' : 'size-6 text-caption'} ${right ? 'bg-letter-right text-text-brand' : 'bg-surface-sunken text-text-primary'}`;
const SAID = 'flex flex-wrap items-center gap-x-4 gap-y-3';
const CAPTION = 'text-caption text-text-tertiary';

/** A tab or a hidden character pasted in: the server refuses what no one would see. */
export const UNSHOWABLE = "This has a tab or a hidden character Bali can't show. Type it again.";

/** What Bali refuses in a field (LessonStates), in its words; "or remove it" only if it can be. */
export function refusalSaid(refusal: Refusal, field: 'prompt' | 'answer', removable = true) {
  if (refusal === 'unshowable') return UNSHOWABLE;
  if (refusal !== 'empty') {
    return `Keep each answer to ${QUESTION_OPTION_MAX_LENGTH} characters. This one has ${refusal.tooLong}.`;
  }
  if (field === 'prompt') return 'Write the question first.';
  return removable ? 'Fill in this answer or remove it.' : 'Fill in this answer.';
}

/** A save that didn't go through, in LessonStates' words where it draws them, and if a retry can help. */
export function saveSaid(problem: SaveProblem): { words: string; retry: boolean } {
  if (problem.kind === 'not_saved') {
    return {
      words:
        "This question was edited in another tab or on another computer, so Bali didn't save your changes.",
      retry: true,
    };
  }
  if (problem.kind === 'gone') {
    return { words: "This question was removed, so Bali didn't save it.", retry: true };
  }
  if (problem.kind === 'refused') {
    return problem.reason === 'account_deleted'
      ? { words: ACCOUNT_DELETED, retry: false }
      : { words: "Bali couldn't save the question.", retry: true };
  }
  return {
    words:
      problem.status === 429
        ? TOO_MANY_TRIES
        : "Bali couldn't save the question. Check your connection and try again.",
    retry: true,
  };
}

/** A removal that didn't go through: said in its card, Remove there trying again. */
export function removeSaid(failure: Failure): string {
  if (failure.kind === 'refused') return "Bali couldn't remove the question.";
  return failure.status === 429
    ? TOO_MANY_TRIES
    : "Bali couldn't remove the question. Check your connection and try again.";
}

/**
 * The page (Questions; QuestionsEdit while a question is written): the head with Write a question,
 * the question being written, then the drafts, oldest first, each with Edit and Remove; the list
 * loading, failed with Try again, or none yet.
 */
export function QuestionsView({
  drafts,
  form,
  removals,
  on,
}: {
  drafts: Drafts;
  form: Form | null;
  removals: Record<string, Removal>;
  on: QuestionsActions;
}) {
  return (
    <main className="flex flex-col gap-5.5">
      <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3">
        <div>
          <h1 id={TITLE} tabIndex={-1} className="text-page-title">
            Your questions
          </h1>
          <p className="mt-0.5 text-meta text-text-secondary">
            Write questions before class. In class, ask one with a click.
          </p>
        </div>
        {form ? null : (
          <Button id={WRITE} onClick={on.write}>
            <Plus size={16} aria-hidden="true" />
            Write a question
          </Button>
        )}
      </div>
      {form ? <QuestionForm form={form} on={on} /> : null}
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
      ) : form ? null : (
        <p className="text-body text-text-secondary">
          No questions yet. Write one now, then ask it in class with a click.
        </p>
      )}
    </main>
  );
}

/**
 * A draft (`.qcard`): its question, its answers with their letters, the correct one marked, and
 * when it was added or last edited; Edit and Remove beside it, or, once Remove is pressed, the
 * board's question across the card's foot with Remove and Keep, or its failure in that line's place.
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
    <li
      className={`grid grid-cols-[minmax(0,1fr)_auto] items-start gap-x-5 gap-y-2 text-body ${CARD_ALONE}`}
    >
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
          {/* A new element for a failure, so a screen reader says each one as it comes. */}
          <p
            key={removal.failure ? 'failed' : 'asked'}
            id={`${id}-rm`}
            role={removal.failure ? 'alert' : undefined}
            className="text-body"
          >
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
            id={`${id}-edit`}
            variant="secondary"
            size="sm"
            aria-describedby={id}
            onClick={() => on.edit(draft.id)}
          >
            Edit
          </Button>
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

/** v2.css's `.icon-btn`: an answer's Remove. */
const ICON_BUTTON =
  'grid size-9 shrink-0 cursor-pointer place-items-center rounded-item text-text-tertiary hover:bg-surface-sunken hover:text-text-primary';

/**
 * Writing a question (QuestionsEdit), new or a draft's edit: the question, 2 to 6 answers, one
 * marked correct if the teacher likes; what Bali refuses said under each field once Save is pressed;
 * a save that didn't go through above Save, with Try again, which sends it again.
 */
export function QuestionForm({ form, on }: { form: Form; on: QuestionsActions }) {
  const { words, busy } = form;
  const refused = form.tried ? refusalsOf(words) : null;
  const count = words.options.length;
  const said = form.problem ? saveSaid(form.problem) : null;
  return (
    <section aria-labelledby="q-h" className={`flex max-w-215 flex-col gap-4.5 ${CARD_ALONE}`}>
      <div className="flex flex-col gap-0.75">
        <h2 id="q-h" className="text-h3">
          Write a question
        </h2>
        <p className="text-body text-text-secondary">
          Students see it only when you ask it in class.
        </p>
      </div>
      {/* noValidate: what Bali refuses is said in its own words, under each field. */}
      <form
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          on.save();
        }}
        className="flex flex-col gap-5"
      >
        <div>
          <label htmlFor={PROMPT} className="block text-body font-medium">
            Question
          </label>
          <textarea
            id={PROMPT}
            rows={3}
            maxLength={QUESTION_PROMPT_MAX_LENGTH}
            autoComplete="off"
            value={words.prompt}
            onChange={(e) => on.change({ ...words, prompt: e.target.value })}
            aria-invalid={refused?.prompt ? true : undefined}
            aria-describedby={`${refused?.prompt ? `${PROMPT}-said ` : ''}${PROMPT}-count`}
            className="mt-2 block min-h-22 w-full resize-y rounded-sm border border-border-input bg-surface-card px-3 py-2 text-input text-text-primary aria-[invalid=true]:border-text-primary"
          />
          {refused?.prompt ? (
            <p id={`${PROMPT}-said`} className="text-body">
              {refusalSaid(refused.prompt, 'prompt')}
            </p>
          ) : null}
          <p id={`${PROMPT}-count`} className={`text-right ${CAPTION}`}>
            {words.prompt.length} / {QUESTION_PROMPT_MAX_LENGTH}
          </p>
        </div>
        <fieldset>
          <legend className="text-body font-medium">Answers</legend>
          <div className="mt-2.5 flex flex-col gap-2.5">
            {words.options.map((option, i) => {
              const right = words.correctOption === i;
              const refusal = refused?.options[i] ?? null;
              return (
                <div
                  key={i}
                  className="grid grid-cols-[28px_minmax(0,1fr)_auto_36px] items-center gap-2.5"
                >
                  <span aria-hidden="true" className={letter(false, true)}>
                    {LETTERS[i]}
                  </span>
                  <Input
                    id={answerId(i)}
                    type="text"
                    autoComplete="off"
                    aria-label={`Answer ${LETTERS[i]}`}
                    value={option}
                    onChange={(e) =>
                      on.change({
                        ...words,
                        options: words.options.map((o, j) => (j === i ? e.target.value : o)),
                      })
                    }
                    aria-invalid={refusal ? true : undefined}
                    aria-describedby={refusal ? `${answerId(i)}-said` : undefined}
                  />
                  <Button
                    variant="secondary"
                    size="sm"
                    aria-pressed={right}
                    onClick={() => on.change({ ...words, correctOption: right ? null : i })}
                  >
                    {right ? <Check size={16} aria-hidden="true" /> : null}
                    {right ? 'Correct' : 'Mark correct'}
                  </Button>
                  {/* Never under the two answers a question needs. */}
                  {count > QUESTION_OPTIONS_MIN ? (
                    <button
                      type="button"
                      aria-label={`Remove answer ${LETTERS[i]}`}
                      onClick={() => on.removeAnswer(i)}
                      className={ICON_BUTTON}
                    >
                      <X size={16} aria-hidden="true" />
                    </button>
                  ) : null}
                  {refusal ? (
                    <p id={`${answerId(i)}-said`} className="col-[2/-1] text-body">
                      {refusalSaid(refusal, 'answer', count > QUESTION_OPTIONS_MIN)}
                    </p>
                  ) : null}
                </div>
              );
            })}
          </div>
          {count < QUESTION_OPTIONS_MAX ? (
            <button
              type="button"
              onClick={on.addAnswer}
              className="mt-1 inline-flex h-9 cursor-pointer items-center gap-2 rounded-xs text-body font-semibold text-text-brand"
            >
              <Plus size={16} aria-hidden="true" />
              Add an answer
            </button>
          ) : null}
          <p className={`mt-0.5 ${CAPTION}`}>
            Marking a correct answer is optional. When you close the question, you choose whether
            students see it.
          </p>
        </fieldset>
        {/* Right above the button that sends it again (DESIGN.md §4). */}
        {said ? (
          <div className={SAID}>
            <p role="alert" className="text-body">
              {said.words}
            </p>
            {said.retry ? (
              <Button variant="secondary" size="sm" type="submit" aria-disabled={busy}>
                Try again
              </Button>
            ) : null}
          </div>
        ) : null}
        <div className="flex flex-wrap items-center gap-2.5 border-t border-border-default pt-4.5">
          <Button type="submit" aria-disabled={busy} aria-busy={busy}>
            Save
          </Button>
          <Button variant="secondary" onClick={on.cancel}>
            Cancel
          </Button>
        </div>
      </form>
    </section>
  );
}
