'use client';

import {
  QUESTION_OPTION_MAX_LENGTH,
  QUESTION_OPTIONS_MAX,
  QUESTION_OPTIONS_MIN,
  QUESTION_PROMPT_MAX_LENGTH,
} from '@bali/shared';
import { Check, Plus, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

import { Button } from '@/components/button';
import { Input } from '@/components/field';
import { letterClass, letterOf } from '@/components/question-card';
import { TOO_MANY_TRIES } from '@/lib/errors';
import type { Failure, OpenAnswer, QuestionDraft } from '@/lib/live-question';

/** A question as it is being written; kept by the page until it is asked or cancelled. */
export interface Draft {
  prompt: string;
  options: string[];
  /** The option marked correct, or null: marking one is optional. */
  correct: number | null;
}
/** A fresh one: no words yet, and the two answers a question needs at least. */
export const NEW_DRAFT: Draft = { prompt: '', options: ['', ''], correct: null };

/** What Bali refuses before it asks (LessonStates), null where nothing: as the server counts. */
export function refusals(draft: Draft): { prompt: string | null; options: (string | null)[] } {
  return {
    prompt: draft.prompt.trim() === '' ? 'Write the question first.' : null,
    options: draft.options.map((option) => {
      const n = [...option.trim()].length;
      if (n === 0) return 'Fill in this answer or remove it.';
      return n > QUESTION_OPTION_MAX_LENGTH
        ? `Keep each answer to ${QUESTION_OPTION_MAX_LENGTH} characters. This one has ${n}.`
        : null;
    }),
  };
}

/**
 * An ask that didn't go through, in LessonStates' words, and whether Try again can help: never once
 * the session ended first; a `429` in the portal's words for it.
 */
export function askSaid(failure: Failure): { words: string; retry: boolean } {
  if (failure.kind === 'refused' && failure.reason === 'session_not_running') {
    return { words: "This session has ended, so Bali didn't ask the question.", retry: false };
  }
  return {
    words:
      failure.status === 429
        ? TOO_MANY_TRIES
        : "Bali couldn't ask the question. Check your connection and try again.",
    retry: true,
  };
}

/** The panel's Close and an answer's Remove: v2.css's `.icon-btn`. */
const ICON_BUTTON =
  'grid size-9 shrink-0 cursor-pointer place-items-center rounded-item text-text-tertiary hover:bg-surface-sunken hover:text-text-primary';
const CAPTION = 'text-caption text-text-tertiary';

/**
 * Ask a question in the side panel (L7; LessonWrite, LessonStates' lines), where a student's panel
 * shows, 460 px from the right, so the grid stays in view; "Write a new question" only (the drafts
 * are L7b's). The question and 2 to 6 answers, one marked correct if the teacher likes; what Bali
 * refuses said under each, the first focused; a failed ask above Ask the class, Try again sending
 * it again under its id (L6). Cancel drops what was written; Close and Escape keep it for later.
 */
export function AskPanel({
  id,
  draft,
  onDraft,
  openNow,
  onAsk,
  onAsked,
  onCancel,
  onClose,
}: {
  id: string;
  draft: Draft;
  onDraft: (draft: Draft) => void;
  /** A question is open: asking this one closes it. */
  openNow: boolean;
  onAsk: (question: QuestionDraft) => Promise<OpenAnswer>;
  onAsked: () => void;
  onCancel: () => void;
  onClose: () => void;
}) {
  const [tried, setTried] = useState(false);
  const [busy, setBusy] = useState(false);
  const [said, setSaid] = useState<Failure | null>(null);
  const sending = useRef(false);
  const added = useRef(false);
  const refused = tried ? refusals(draft) : null;
  const set = (change: Partial<Draft>) => onDraft({ ...draft, ...change });

  // Focus into the panel as it opens, at the question.
  useEffect(() => document.getElementById(`${id}-prompt`)?.focus(), [id]);
  // And to an answer just added.
  const count = draft.options.length;
  useEffect(() => {
    if (added.current) document.getElementById(`${id}-a${count - 1}`)?.focus();
    added.current = false;
  }, [id, count]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (sending.current) return;
    const found = refusals(draft);
    const first = found.prompt ? 'prompt' : found.options.findIndex((r) => r !== null);
    if (first !== -1) {
      setTried(true);
      document.getElementById(`${id}-${first === 'prompt' ? 'prompt' : `a${first}`}`)?.focus();
      return;
    }
    sending.current = true;
    setBusy(true);
    setSaid(null);
    const answer = await onAsk({
      prompt: draft.prompt.trim(),
      options: draft.options.map((option) => option.trim()),
      correctOption: draft.correct,
    });
    sending.current = false;
    setBusy(false);
    if (answer.kind === 'opened') onAsked();
    else setSaid(answer);
  }

  const failed = said ? askSaid(said) : null;
  return (
    <aside
      id={id}
      aria-labelledby={`${id}-h`}
      onKeyDown={(e) => {
        if (e.key === 'Escape') onClose();
      }}
      className="fixed inset-y-0 right-0 z-5 flex w-115 max-w-full flex-col overflow-y-auto border-l border-border-default bg-surface-card shadow-3"
    >
      <div className="flex items-start gap-3 border-b border-border-default pt-5 pr-3.5 pb-4 pl-5">
        <div className="min-w-0 flex-1">
          <h2 id={`${id}-h`} className="text-h3">
            Ask a question
          </h2>
          <p className={CAPTION}>Phones in this class show it within a few seconds.</p>
        </div>
        <button type="button" aria-label="Close" onClick={onClose} className={ICON_BUTTON}>
          <X size={16} aria-hidden="true" />
        </button>
      </div>
      {/* noValidate: what Bali refuses is said in its words under each field. */}
      <form
        onSubmit={(e) => void submit(e)}
        noValidate
        className="flex flex-col gap-5 px-5 pt-4.5 pb-6"
      >
        <div>
          <label htmlFor={`${id}-prompt`} className="block text-body font-medium">
            Question
          </label>
          <textarea
            id={`${id}-prompt`}
            rows={3}
            maxLength={QUESTION_PROMPT_MAX_LENGTH}
            value={draft.prompt}
            onChange={(e) => set({ prompt: e.target.value })}
            aria-invalid={refused?.prompt ? true : undefined}
            aria-describedby={`${refused?.prompt ? `${id}-prompt-said ` : ''}${id}-count`}
            className="mt-2 block min-h-22 w-full resize-y rounded-sm border border-border-input bg-surface-card px-3 py-2 text-input text-text-primary aria-[invalid=true]:border-text-primary"
          />
          {/* Right under it, as the boards render them: `.app p`'s margin 0 outranks theirs. */}
          {refused?.prompt ? (
            <p id={`${id}-prompt-said`} className="text-body">
              {refused.prompt}
            </p>
          ) : null}
          <p id={`${id}-count`} className={`text-right tabular-nums ${CAPTION}`}>
            {draft.prompt.length} / {QUESTION_PROMPT_MAX_LENGTH}
          </p>
        </div>
        <fieldset>
          <legend className="text-body font-medium">Answers</legend>
          <div className="mt-2.5 flex flex-col gap-2.5">
            {draft.options.map((option, i) => {
              const right = draft.correct === i;
              const refusal = refused?.options[i] ?? null;
              return (
                <div
                  key={i}
                  className="grid grid-cols-[28px_minmax(0,1fr)_auto_36px] items-center gap-2.5"
                >
                  <span aria-hidden="true" className={letterClass(right)}>
                    {letterOf(i)}
                  </span>
                  <Input
                    id={`${id}-a${i}`}
                    type="text"
                    aria-label={`Answer ${letterOf(i)}`}
                    value={option}
                    onChange={(e) =>
                      set({ options: draft.options.map((o, j) => (j === i ? e.target.value : o)) })
                    }
                    aria-invalid={refusal ? true : undefined}
                    aria-describedby={refusal ? `${id}-a${i}-said` : undefined}
                  />
                  <Button
                    variant="secondary"
                    size="sm"
                    aria-pressed={right}
                    onClick={() => set({ correct: right ? null : i })}
                  >
                    {right ? <Check size={16} aria-hidden="true" /> : null}
                    {right ? 'Correct' : 'Mark correct'}
                  </Button>
                  {/* Never under the two answers a question needs. */}
                  {count > QUESTION_OPTIONS_MIN ? (
                    <button
                      type="button"
                      aria-label={`Remove answer ${letterOf(i)}`}
                      onClick={() =>
                        set({
                          options: draft.options.filter((_, j) => j !== i),
                          correct:
                            draft.correct === null || draft.correct < i
                              ? draft.correct
                              : draft.correct === i
                                ? null
                                : draft.correct - 1,
                        })
                      }
                      className={ICON_BUTTON}
                    >
                      <X size={16} aria-hidden="true" />
                    </button>
                  ) : null}
                  {refusal ? (
                    <p id={`${id}-a${i}-said`} className="col-[2/-1] text-body">
                      {refusal}
                    </p>
                  ) : null}
                </div>
              );
            })}
          </div>
          {count < QUESTION_OPTIONS_MAX ? (
            <button
              type="button"
              onClick={() => {
                added.current = true;
                set({ options: [...draft.options, ''] });
              }}
              className="mt-1 inline-flex h-9 cursor-pointer items-center gap-2 rounded-xs font-semibold text-text-brand"
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
        {failed ? (
          <div className="flex flex-wrap items-center gap-x-4 gap-y-3">
            <p role="alert" className="text-body">
              {failed.words}
            </p>
            {failed.retry ? (
              <Button variant="secondary" size="sm" type="submit" aria-disabled={busy}>
                Try again
              </Button>
            ) : null}
          </div>
        ) : null}
        <div className="flex flex-wrap items-center gap-2.5 border-t border-border-default pt-4.5">
          <Button type="submit" aria-disabled={busy} aria-busy={busy}>
            Ask the class
          </Button>
          <Button variant="secondary" onClick={onCancel}>
            Cancel
          </Button>
        </div>
        <div className="-mt-2.5 flex flex-col gap-1">
          <p className={CAPTION}>
            You&apos;ll see how many picked each answer once 3 have answered.
          </p>
          {openNow ? <p className={CAPTION}>Asking this closes the open question.</p> : null}
        </div>
      </form>
    </aside>
  );
}
