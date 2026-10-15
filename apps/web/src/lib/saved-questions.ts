import {
  QUESTION_OPTION_MAX_LENGTH,
  type SavedQuestion,
  type SavedQuestionResponse,
  type SavedQuestionsResponse,
} from '@bali/shared';

import { type ApiClient, ApiError } from './api-client';
import { eventIdAfter, newEventId } from './event-id';
import { type Failure, failureOf, type QuestionDraft } from './live-question';

/*
 * A teacher's saved questions, the Questions page's logic (Phase 7, L7b; ARCHITECTURE, "Live
 * lesson", decisions 3 and 12), tested and holding no words: the page says each answer as the
 * approved canvas does.
 */

const PATH = '/v1/saved-questions';

/** Oldest first, as the canvas lists them (the API answers newest first): by first write, then id. */
export const oldestFirst = (drafts: readonly SavedQuestion[]): SavedQuestion[] =>
  [...drafts].sort(
    (a, b) =>
      Date.parse(a.createdAt) - Date.parse(b.createdAt) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
  );

/** The teacher's drafts (`GET /v1/saved-questions`), oldest first, or why not. */
export async function readDrafts(
  api: Pick<ApiClient, 'get'>,
): Promise<{ kind: 'read'; drafts: SavedQuestion[] } | Failure> {
  try {
    return {
      kind: 'read',
      drafts: oldestFirst((await api.get<SavedQuestionsResponse>(PATH)).savedQuestions),
    };
  } catch (e) {
    return failureOf(e);
  }
}

/**
 * The server's own checks of a question's words (`Text`, `apps/api/src/routes/questions.ts`, with
 * `display-name.ts`'s patterns, pinned to them by the test): nothing anyone could see (`INVISIBLE`),
 * or a character that can't be shown (`UNPRINTABLE`: a tab, a control or format character pasted in;
 * the question's own line breaks allowed).
 */
const UNPRINTABLE = /[\p{Cc}\p{Cs}\p{Zl}\p{Zp}]|(?![\u200c\u200d])\p{Cf}/u;
const INVISIBLE = /^[\p{White_Space}\p{Default_Ignorable_Code_Point}\u2800\u{1D159}]*$/u;

/** Why Bali won't save a field yet: blank, a character it can't show, or an answer too long. */
export type Refusal = 'empty' | 'unshowable' | { tooLong: number };

/**
 * What Bali refuses before it saves, as the server checks it: the words trimmed, an answer's length
 * in code points. The question's length is its field's to hold (`maxLength`), as the canvas draws
 * a count and no refusal for it.
 */
export function refusalsOf(words: QuestionDraft): {
  prompt: Refusal | null;
  options: (Refusal | null)[];
} {
  const check = (typed: string, lines: boolean): Refusal | null => {
    const text = typed.trim();
    if (INVISIBLE.test(text)) return 'empty';
    return UNPRINTABLE.test(lines ? text.replaceAll('\n', '') : text) ? 'unshowable' : null;
  };
  return {
    prompt: check(words.prompt, true),
    options: words.options.map((typed) => {
      const n = [...typed.trim()].length;
      return check(typed, false) ?? (n > QUESTION_OPTION_MAX_LENGTH ? { tooLong: n } : null);
    }),
  };
}

/** The words without answer `i`, the one marked correct still marked (none, if it was `i`). */
export function withoutAnswer(words: QuestionDraft, i: number): QuestionDraft {
  const right = words.correctOption;
  return {
    ...words,
    options: words.options.filter((_, j) => j !== i),
    correctOption: right === null || right < i ? right : right === i ? null : right - 1,
  };
}

/** The words as Bali keeps them, each trimmed. */
export const trimmed = ({ prompt, options, correctOption }: QuestionDraft): QuestionDraft => ({
  prompt: prompt.trim(),
  options: options.map((option) => option.trim()),
  correctOption,
});

/** Whether two sets of words are the same, word for word. */
export const sameWords = (a: QuestionDraft, b: QuestionDraft): boolean =>
  a.prompt === b.prompt &&
  a.correctOption === b.correctOption &&
  a.options.length === b.options.length &&
  a.options.every((option, i) => option === b.options[i]);

/** One save: the draft it replaces (null: a new one), its words, trimmed, and its `eventId`. */
export interface SaveAttempt extends QuestionDraft {
  draftId: string | null;
  eventId: string;
}

/**
 * The attempt to save `words` as. The last one sent whose answer never came may have landed, so the
 * same words for the same draft resend it, under its id. Else a fresh one, its id minted after the
 * draft's own and that last one's, however far behind this computer's clock stands: a save replaces
 * a draft only when its id sorts after the one the draft holds (decision 12).
 */
export function saveAttemptFor(
  unanswered: SaveAttempt | null,
  draft: Pick<SavedQuestion, 'id' | 'eventId'> | null,
  words: QuestionDraft,
  now = Date.now(),
): SaveAttempt {
  const draftId = draft?.id ?? null;
  const sent = trimmed(words);
  const mine = unanswered?.draftId === draftId ? unanswered : null;
  if (mine && sameWords(mine, sent)) return mine;
  // UUIDv7s sort as Postgres orders them by their hex, lower-cased (#319).
  const held = [draft?.eventId, mine?.eventId]
    .flatMap((id) => (id ? [id.toLowerCase()] : []))
    .sort()
    .at(-1);
  return { ...sent, draftId, eventId: eventIdAfter(held ?? null, now) };
}

/**
 * A save's answer. `not_saved`: answered under another `eventId` (#318), so a later save, made in
 * another tab or on another computer, holds the draft and this one changed nothing; `draft` is the
 * draft now. `gone`: the draft was removed meanwhile, so nothing was saved.
 */
export type SaveAnswer =
  | { kind: 'saved'; draft: SavedQuestion }
  | { kind: 'not_saved'; draft: SavedQuestion }
  | { kind: 'gone' }
  | Failure;

const gone = (e: unknown) => e instanceof ApiError && e.reason === 'saved_question_not_found';

/** Save `attempt`: a new draft (`POST`), or one replaced whole (`PUT`). */
export async function saveDraft(
  api: Pick<ApiClient, 'post' | 'put'>,
  attempt: SaveAttempt,
): Promise<SaveAnswer> {
  const { draftId, ...body } = attempt;
  try {
    const { savedQuestion: draft } =
      draftId === null
        ? await api.post<SavedQuestionResponse>(PATH, body)
        : await api.put<SavedQuestionResponse>(`${PATH}/${draftId}`, body);
    const mine = draft.eventId.toLowerCase() === body.eventId.toLowerCase();
    return { kind: mine ? 'saved' : 'not_saved', draft };
  } catch (e) {
    return gone(e) ? { kind: 'gone' } : failureOf(e);
  }
}

/** One removal: the draft, and the `eventId` it is sent under. */
export interface RemoveAttempt {
  draftId: string;
  eventId: string;
}

/** The unanswered removal of `draftId` again, under its id; else a fresh one (a removal is unordered). */
export const removeAttemptFor = (
  unanswered: RemoveAttempt | undefined,
  draftId: string,
  mint = newEventId,
): RemoveAttempt => (unanswered?.draftId === draftId ? unanswered : { draftId, eventId: mint() });

/** Remove it (`DELETE`). One already gone, removed in another tab, is as good as removed. */
export async function removeDraft(
  api: Pick<ApiClient, 'del'>,
  attempt: RemoveAttempt,
): Promise<{ kind: 'removed' } | Failure> {
  try {
    await api.del<SavedQuestionResponse>(`${PATH}/${attempt.draftId}`, {
      eventId: attempt.eventId,
    });
    return { kind: 'removed' };
  } catch (e) {
    return gone(e) ? { kind: 'removed' } : failureOf(e);
  }
}
