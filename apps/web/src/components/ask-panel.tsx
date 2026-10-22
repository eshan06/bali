'use client';

import {
  QUESTION_OPTIONS_MAX,
  QUESTION_OPTIONS_MIN,
  QUESTION_PROMPT_MAX_LENGTH,
  type SavedQuestion,
} from '@bali/shared';
import { Check, Plus, X } from 'lucide-react';
import Link from 'next/link';
import { type ReactNode, useCallback, useEffect, useRef, useState } from 'react';

import { Button } from '@/components/button';
import { Input } from '@/components/field';
import { letterClass, letterOf, type Opening } from '@/components/question-card';
import { CANT_LOAD_QUESTIONS, type Drafts, refusalSaid } from '@/components/saved-questions';
import { QUIET_LINK } from '@/components/text-link';
import { TryAgain } from '@/components/try-again';
import { TOO_MANY_TRIES } from '@/lib/errors';
import type { Failure, OpenAnswer, QuestionDraft } from '@/lib/live-question';
import { readDrafts, refusalsOf, trimmed, withoutAnswer } from '@/lib/saved-questions';
import { useApi } from '@/lib/use-api';

/** A fresh question: no words yet, and the two answers a question needs at least. */
export const NEW_DRAFT: QuestionDraft = { prompt: '', options: ['', ''], correctOption: null };

/**
 * The live question's own ask (`useLiveQuestion`), one at a time; `from` the teacher's question it
 * asks, by its id, or none for the words written. Null: one is on its way already, so this one
 * wasn't sent.
 */
type Ask = (question: QuestionDraft, from?: string | null) => Promise<OpenAnswer | null>;

/**
 * An ask that didn't go through, in LessonStates' words, and whether Try again can help: never once
 * the session ended first; a `429` in the portal's words for it; a refusal of another kind (a spent
 * id, or a check this panel didn't make) never blamed on the connection.
 */
export function askSaid(failure: Failure): { words: string; retry: boolean } {
  if (failure.kind === 'refused' && failure.reason === 'session_not_running') {
    return { words: "This session has ended, so Bali didn't ask the question.", retry: false };
  }
  if (failure.status === 429) return { words: TOO_MANY_TRIES, retry: true };
  return {
    words:
      failure.kind === 'refused'
        ? "Bali couldn't ask the question."
        : "Bali couldn't ask the question. Check your connection and try again.",
    retry: true,
  };
}

/** The panel's Close and an answer's Remove: v2.css's `.icon-btn`. */
const ICON_BUTTON =
  'grid size-9 shrink-0 cursor-pointer place-items-center rounded-item text-text-tertiary hover:bg-surface-sunken hover:text-text-primary';
/**
 * v2.css's `.link-btn` at the body's 15/22: Add an answer, Write a new question; held as a button
 * is (`aria-disabled`), dimmed to 55 %.
 */
const LINK_BUTTON =
  'inline-flex h-9 cursor-pointer items-center gap-2 rounded-xs text-body font-semibold text-text-brand aria-disabled:cursor-default aria-disabled:opacity-55';
const CAPTION = 'text-caption text-text-tertiary';
/** A line said with its retry beside it, wrapping under it where there's no room. */
const SAID = 'flex flex-wrap items-center gap-x-4 gap-y-3';
/** What went wrong, said where it happened. */
const saidLine = (words: string) => (
  <p role="alert" className="text-body">
    {words}
  </p>
);

/**
 * Write a new question in the side panel (L7; LessonWrite, LessonStates' lines), 460 px wide. The
 * question and 2 to 6 answers, one marked correct if the teacher likes; what Bali refuses said
 * under each, in Your questions' words through its checks (`refusalsOf`, `refusalSaid`: the
 * portal's one copy), the first focused; a failed ask above Ask the class, Try again sending it
 * again under its id (L6), its line kept and Try again held until Bali answers; asked, the page
 * moves focus to the question; the session ended first, its line alone, focus on the panel's title
 * (LessonRetryStates). The ask itself, on its way or failed, is the live question's (`opening`),
 * so a panel opened again shows it. Cancel drops what was written; Close and Escape keep it for
 * later.
 */
export function AskPanel({
  id,
  draft,
  onDraft,
  openNow,
  opening,
  onAsk,
  onAsked,
  onCancel,
  onClose,
}: {
  id: string;
  draft: QuestionDraft;
  onDraft: (draft: QuestionDraft) => void;
  /** A question is open: asking this one closes it. */
  openNow: boolean;
  /** The ask on its way, or the last one's failure (`useLiveQuestion`). */
  opening: Opening;
  onAsk: Ask;
  onAsked: () => void;
  onCancel: () => void;
  onClose: () => void;
}) {
  const [tried, setTried] = useState(false);
  const { busy } = opening;
  // Only an ask of what is written is said here; one of the teacher's questions, in their list.
  const failure = opening.from === null ? opening.failure : null;
  const added = useRef(false);
  const refused = tried ? refusalsOf(draft) : null;
  const set = (change: Partial<QuestionDraft>) => onDraft({ ...draft, ...change });

  // Focus into the panel as it opens, at the question.
  useEffect(() => document.getElementById(`${id}-prompt`)?.focus(), [id]);
  // And to an answer just added.
  const count = draft.options.length;
  useEffect(() => {
    if (added.current) document.getElementById(`${id}-a${count - 1}`)?.focus();
    added.current = false;
  }, [id, count]);

  // Ask the class's press, and Try again's: what Bali refuses said first, and nothing sent, so only
  // an ask on its way holds Try again (santa's review).
  function send() {
    if (busy) return;
    const found = refusalsOf(draft);
    const first = found.prompt ? 'prompt' : found.options.findIndex((r) => r !== null);
    if (first !== -1) {
      setTried(true);
      document.getElementById(`${id}-${first === 'prompt' ? 'prompt' : `a${first}`}`)?.focus();
      return;
    }
    return onAsk(trimmed(draft)).then((answer) => {
      if (answer?.kind === 'opened') onAsked();
    });
  }

  // A line with no Try again goes while it is asked again, and is said anew with its answer: only a
  // Try again keeps its place (santa's review).
  const said = failure ? askSaid(failure) : null;
  const failed = said && (said.retry || !busy) ? said : null;
  return (
    <Panel
      id={id}
      title="Ask a question"
      line="Phones in this class show it within a few seconds."
      wide
      onClose={onClose}
    >
      {/* noValidate: what Bali refuses is said in its words under each field. */}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void send();
        }}
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
            autoComplete="off"
            value={draft.prompt}
            onChange={(e) => set({ prompt: e.target.value })}
            aria-invalid={refused?.prompt ? true : undefined}
            aria-describedby={`${refused?.prompt ? `${id}-prompt-said ` : ''}${id}-count`}
            className="mt-2 block min-h-22 w-full resize-y rounded-sm border border-border-input bg-surface-card px-3 py-2 text-input text-text-primary aria-[invalid=true]:border-text-primary"
          />
          {/* Right under it, as the boards render them: `.app p`'s margin 0 outranks theirs. */}
          {refused?.prompt ? (
            <p id={`${id}-prompt-said`} className="text-body">
              {refusalSaid(refused.prompt, 'prompt')}
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
              const right = draft.correctOption === i;
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
                    autoComplete="off"
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
                    onClick={() => set({ correctOption: right ? null : i })}
                  >
                    {right ? <Check size={16} aria-hidden="true" /> : null}
                    {right ? 'Correct' : 'Mark correct'}
                  </Button>
                  {/* Never under the two answers a question needs. */}
                  {count > QUESTION_OPTIONS_MIN ? (
                    <button
                      type="button"
                      aria-label={`Remove answer ${letterOf(i)}`}
                      onClick={() => {
                        onDraft(withoutAnswer(draft, i));
                        // Its button goes with it: on to the answer now in its place.
                        window.requestAnimationFrame(() =>
                          document.getElementById(`${id}-a${Math.min(i, count - 2)}`)?.focus(),
                        );
                      }}
                      className={ICON_BUTTON}
                    >
                      <X size={16} aria-hidden="true" />
                    </button>
                  ) : null}
                  {refusal ? (
                    <p id={`${id}-a${i}-said`} className="col-[2/-1] text-body">
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
              onClick={() => {
                added.current = true;
                set({ options: [...draft.options, ''] });
              }}
              className={`mt-1 ${LINK_BUTTON}`}
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
          <div className={SAID}>
            {failed.retry ? (
              <TryAgain onRetry={send} held={busy} then={[`${id}-h`]}>
                {saidLine(failed.words)}
              </TryAgain>
            ) : (
              saidLine(failed.words)
            )}
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
    </Panel>
  );
}

/**
 * The side panel (v2.css's `.panel`), where a student's panel shows, from the right, so the grid
 * stays in view: its title ("Ask a question", "Show slides") over its line, Close, and Escape
 * closing it from inside. 372 px, as LessonAsk and LessonDecks draw it; 460 to write a question in
 * (`wide`), as LessonWrite does.
 */
export function Panel({
  id,
  title,
  line,
  wide = false,
  onClose,
  children,
}: {
  id: string;
  title: string;
  line: string;
  wide?: boolean;
  onClose: () => void;
  children: ReactNode;
}) {
  return (
    <aside
      id={id}
      aria-labelledby={`${id}-h`}
      onKeyDown={(e) => {
        if (e.key === 'Escape') onClose();
      }}
      className={`fixed inset-y-0 right-0 z-5 flex ${wide ? 'w-115' : 'w-93'} max-w-full flex-col overflow-y-auto overscroll-contain border-l border-border-default bg-surface-card shadow-3`}
    >
      <div className="flex items-start gap-3 border-b border-border-default pt-5 pr-3.5 pb-4 pl-5">
        <div className="min-w-0 flex-1">
          <h2 id={`${id}-h`} tabIndex={-1} className="text-h3">
            {title}
          </h2>
          <p className={CAPTION}>{line}</p>
        </div>
        <button type="button" aria-label="Close" onClick={onClose} className={ICON_BUTTON}>
          <X size={16} aria-hidden="true" />
        </button>
      </div>
      {children}
    </aside>
  );
}

/** "4 answers · B marked correct" (LessonAsk): its answers, and which one is correct, if one is. */
export const pickLine = ({ options, correctOption }: QuestionDraft) =>
  `${options.length} answers${correctOption === null ? '' : ` · ${letterOf(correctOption)} marked correct`}`;

/**
 * Asking one of the teacher's questions (L7b, part 2; LessonAsk, and LessonAskStates drawn first):
 * Written ahead, oldest first, each with its answers counted, the correct one named, and Ask; the
 * list loading, failed with Try again, or none yet; then Write a new question and Your questions.
 * Each Ask holds while any ask is on its way, and an ask that didn't go through is said under its
 * question with Try again. Each Try again keeps its line, held, until Bali answers: read, focus on
 * Written ahead; the session ended first, on the question's words (LessonRetryStates). It names
 * the correct answers, so the page never draws it in Present.
 */
export function PickView({
  id,
  drafts,
  openNow,
  opening,
  onRead,
  onPick,
  onWrite,
  onClose,
}: {
  id: string;
  drafts: Drafts;
  /** A question is open: asking one closes it. */
  openNow: boolean;
  /** The ask on its way, or the last one's failure, and what it asked (`useLiveQuestion`). */
  opening: Opening;
  /** The list read again, its failure said until it answers. */
  onRead: () => Promise<void>;
  onPick: (draft: SavedQuestion) => void;
  onWrite: () => void;
  onClose: () => void;
}) {
  const { busy, failure, from } = opening;
  // Held, not disabled, while an ask is on its way: focus stays where it is.
  const pick = (draft: SavedQuestion) => () => {
    if (!busy) onPick(draft);
  };
  return (
    <Panel
      id={id}
      title="Ask a question"
      line="Pick one you wrote ahead, or write a new one."
      onClose={onClose}
    >
      {/* `.panel-body`, its words at the body's 15/22 as `.app` sets them. */}
      <div className="flex flex-col gap-5.5 px-5 pt-4.5 pb-6 text-body">
        <section aria-labelledby={`${id}-ahead`}>
          <h3 id={`${id}-ahead`} className="mb-3 text-label text-text-tertiary uppercase">
            Written ahead
          </h3>
          {drafts === 'loading' ? (
            <p role="status" className="text-body text-text-secondary">
              Loading…
            </p>
          ) : drafts === 'failed' ? (
            <div className={SAID}>
              <TryAgain onRetry={onRead} then={[`${id}-ahead`]}>
                {saidLine(CANT_LOAD_QUESTIONS)}
              </TryAgain>
            </div>
          ) : drafts.length === 0 ? (
            <p className="text-body">No saved questions yet.</p>
          ) : (
            <ul>
              {drafts.map((draft) => {
                const q = `${id}-${draft.id}`;
                const asked = failure && from === draft.id ? askSaid(failure) : null;
                // A line with no Try again goes while it is asked again, said anew with its answer.
                const said = asked && (asked.retry || !busy) ? asked : null;
                return (
                  <li
                    key={draft.id}
                    className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3.5 gap-y-1 border-t border-border-default py-3 last:border-b"
                  >
                    <div className="min-w-0">
                      <p id={q} className="font-semibold whitespace-pre-line wrap-anywhere">
                        {draft.prompt}
                      </p>
                      <p className={CAPTION}>{pickLine(draft)}</p>
                    </div>
                    <Button
                      variant="secondary"
                      size="sm"
                      aria-describedby={q}
                      aria-disabled={busy}
                      aria-busy={busy && from === draft.id}
                      onClick={pick(draft)}
                    >
                      Ask
                    </Button>
                    {/* Under its question, where it happened (LessonAskStates). */}
                    {said ? (
                      <div className={`col-span-full mt-1.5 ${SAID}`}>
                        {said.retry ? (
                          <TryAgain onRetry={pick(draft)} held={busy} then={[q]} describedBy={q}>
                            {saidLine(said.words)}
                          </TryAgain>
                        ) : (
                          saidLine(said.words)
                        )}
                      </div>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          )}
        </section>
        <div className="flex flex-wrap items-center justify-between gap-2.5">
          {/* Held with the Asks: an ask that fails is said under its question, which the form
              can't show (LessonAskStates). */}
          <button
            type="button"
            aria-disabled={busy}
            onClick={() => {
              if (!busy) onWrite();
            }}
            className={LINK_BUTTON}
          >
            <Plus size={16} aria-hidden="true" />
            Write a new question
          </button>
          <Link href="/questions" className={QUIET_LINK}>
            Your questions
          </Link>
        </div>
        {openNow ? <p className={CAPTION}>Asking this closes the open question.</p> : null}
      </div>
    </Panel>
  );
}

/**
 * The panel as Ask a question opens it (LessonAsk): the teacher's questions read from Bali each time
 * it opens, focus coming to its title, and again by Try again, its failure said until the answer.
 * An Ask sends the question's words through the live question's own ask, as Ask the class sends
 * what is written (#390): one at a time, the same words again under the same id while their answer
 * never came (L6).
 */
export function PickPanel({
  id,
  openNow,
  opening,
  onAsk,
  onAsked,
  onWrite,
  onClose,
}: {
  id: string;
  openNow: boolean;
  opening: Opening;
  onAsk: Ask;
  onAsked: () => void;
  onWrite: () => void;
  onClose: () => void;
}) {
  const api = useApi();
  const [drafts, setDrafts] = useState<Drafts>('loading');
  const read = useCallback(async () => {
    const answer = await readDrafts(api);
    setDrafts(answer.kind === 'read' ? answer.drafts : 'failed');
  }, [api]);
  useEffect(() => {
    void read();
  }, [read]);
  // Focus into the panel as it opens, at its title.
  useEffect(() => document.getElementById(`${id}-h`)?.focus(), [id]);

  async function pick(draft: SavedQuestion) {
    const answer = await onAsk(trimmed(draft), draft.id);
    if (answer?.kind === 'opened') onAsked();
  }

  return (
    <PickView
      id={id}
      drafts={drafts}
      openNow={openNow}
      opening={opening}
      onRead={read}
      onPick={(draft) => void pick(draft)}
      onWrite={onWrite}
      onClose={onClose}
    />
  );
}
