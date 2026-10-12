import type { FeedEvent, QuestionResponse, QuestionResults, TeacherQuestion } from '@bali/shared';

import { type ApiClient, ApiError } from './api-client';
import { newEventId } from './event-id';

/*
 * The class page's live question (Phase 7, L6; ARCHITECTURE, "Live lesson", decisions 3, 6, 7 and
 * 11), tested and holding no words: L7 says each answer as the approved portal canvas does. Asking
 * it and closing it, what the stream says of it, and its results, polled.
 */

/** Why a call didn't go through, typed for the screen to say; never thrown. */
export type Failure =
  /** Refused (a `4xx` but `408` and `429`): nothing changed. Keyed on `reason`, never the message. */
  | { kind: 'refused'; status: number; reason: string | undefined }
  /**
   * No answer to go by: unreachable (no `status`), a timeout, a `5xx`, a body that isn't JSON, or
   * over the API's budget (`429`, `retryAfter` its wait in seconds when sent). A write may have
   * landed, so Try again resends it under its id (`keepUnanswered`).
   */
  | { kind: 'failed'; status: number | undefined; retryAfter: number | undefined };

/** The failure `e` was, read as the portal's other calls read theirs (`extendSession`). */
export function failureOf(e: unknown): Failure {
  if (!(e instanceof ApiError)) return { kind: 'failed', status: undefined, retryAfter: undefined };
  if (e.status < 500 && e.status !== 408 && e.status !== 429) {
    return { kind: 'refused', status: e.status, reason: e.reason };
  }
  return { kind: 'failed', status: e.status, retryAfter: e.retryAfter };
}

/** A question as the teacher wrote it, to ask: decision 3's single choice. */
export interface QuestionDraft {
  prompt: string;
  /** 2–6, each answered by its index. */
  options: string[];
  /** The correct option's index, or null for none. */
  correctOption: number | null;
}

/** One open: the draft, the session it is asked in, and the `eventId` it is sent under. */
export interface OpenAttempt extends QuestionDraft {
  sessionId: string;
  eventId: string;
}

/**
 * The attempt to ask `draft` in `sessionId` as. `unanswered` is the last one sent whose answer
 * never came: it may have landed, so asking the same words again resends it, answered by its
 * replay with the question it opened, never a second question. Other words, or none unanswered,
 * are a fresh attempt with a new `eventId`.
 */
export function openAttemptFor(
  unanswered: OpenAttempt | null,
  sessionId: string,
  draft: QuestionDraft,
  mint = newEventId,
): OpenAttempt {
  const same =
    unanswered?.sessionId === sessionId &&
    unanswered.prompt === draft.prompt &&
    unanswered.correctOption === draft.correctOption &&
    unanswered.options.length === draft.options.length &&
    unanswered.options.every((option, i) => option === draft.options[i]);
  if (same) return unanswered;
  const { prompt, options, correctOption } = draft;
  return { sessionId, prompt, options: [...options], correctOption, eventId: mint() };
}

/** One close: the question, whether students are shown its correct option, and the `eventId`. */
export interface CloseAttempt {
  questionId: string;
  reveal: boolean;
  eventId: string;
}

/**
 * The attempt to close `questionId` as: the unanswered one again for the same question and the
 * same choice, else a fresh one. A close of a question closed already changes nothing, so a Close
 * and show answer after a Close that landed reveals nothing; its answer's `revealed` says so.
 */
export function closeAttemptFor(
  unanswered: CloseAttempt | null,
  questionId: string,
  reveal: boolean,
  mint = newEventId,
): CloseAttempt {
  return unanswered?.questionId === questionId && unanswered.reveal === reveal
    ? unanswered
    : { questionId, reveal, eventId: mint() };
}

/**
 * An open's answer: the question it asked (its replay's too, whose `open` says whether it still
 * is), or why not. Refused: `session_not_running` (the session ended first, so nothing was asked),
 * `event_id_conflict` (a spent id: a new attempt), or a `400` for words the route refuses.
 */
export type OpenAnswer = { kind: 'opened'; question: TeacherQuestion } | Failure;

/** Ask `attempt` (`POST /v1/sessions/{id}/questions`), closing the one open there. */
export async function openQuestion(
  api: Pick<ApiClient, 'post'>,
  attempt: OpenAttempt,
): Promise<OpenAnswer> {
  const { sessionId, ...body } = attempt;
  try {
    const res = await api.post<QuestionResponse>(`/v1/sessions/${sessionId}/questions`, body);
    return { kind: 'opened', question: res.question };
  } catch (e) {
    return failureOf(e);
  }
}

/**
 * A close's answer: the question now, closed, by this close or before it (another tab, a newer
 * question, the bell), its `revealed` saying whether students see the correct option; or why not.
 */
export type CloseAnswer = { kind: 'closed'; question: TeacherQuestion } | Failure;

/** Close `attempt.questionId` (`POST /v1/questions/{id}/close`), revealing it when asked. */
export async function closeQuestion(
  api: Pick<ApiClient, 'post'>,
  attempt: CloseAttempt,
): Promise<CloseAnswer> {
  const { questionId, ...body } = attempt;
  try {
    const res = await api.post<QuestionResponse>(`/v1/questions/${questionId}/close`, body);
    return { kind: 'closed', question: res.question };
  } catch (e) {
    return failureOf(e);
  }
}

/**
 * The question the class page holds after a streamed event (decision 5's lifecycle events, which
 * carry its id, never its words): closed once the stream says so, revealed as its close was;
 * `'unknown'` once another question opened, or one the event doesn't name, whose words only the
 * session's snapshot carries (`GET /v1/sessions/{id}`, its `question`), so the page reads it again;
 * else as it was.
 */
export function questionAfter(
  current: TeacherQuestion | null,
  e: Pick<FeedEvent, 'type' | 'payload'>,
): TeacherQuestion | null | 'unknown' {
  const { question_id: id, revealed } = (e.payload ?? {}) as Record<string, unknown>;
  if (e.type === 'question_opened') {
    return typeof id === 'string' && current?.id === id ? current : 'unknown';
  }
  if (e.type === 'question_closed' && current?.open === true && current.id === id) {
    return { ...current, open: false, revealed: revealed === true };
  }
  return current;
}

/** A results poll as the card shows it. */
export interface ResultsState {
  /**
   * The results as last read, null before the first; a `304` keeps them. `open` false is the
   * question closed by the server's clock: the bell's close too, which the stream carries only
   * once the sweep marks it.
   */
  results: QuestionResults | null;
  /**
   * The reads stopped: the question closed, and a read begun after that was known said so, so
   * these are its final counts (#314's review: a read at the bell can be one answer short).
   */
  final: boolean;
  /** The last read's failure, null once a read works: the counts may be behind meanwhile. */
  problem: Failure | null;
}

/** Where a page's visibility is read: `document` in a browser. */
export type PageVisibility = Pick<
  Document,
  'visibilityState' | 'addEventListener' | 'removeEventListener'
>;

export interface ResultsPoll {
  /**
   * The question closed: the stream's `question_closed` for it (`questionAfter`), or this tab's
   * close answered. The first good read begun after this that says so is the last.
   */
  closed(): void;
  /** No more reads: the page is done with this question. */
  stop(): void;
}

/** How often a poll reads (decisions 6, 7: about every 2 s), 30 of the account's 120 a minute. */
export const POLL_EVERY_MS = 2_000;
/** The longest a `429` holds a poll, its `Retry-After` none or a date too: L5's minute. */
export const LONGEST_WAIT_MS = 60_000;

/**
 * One read's answer: `n`, its place among the reads begun, and its body (null for a `304`: the last
 * body still stands) or its failure.
 */
export type PollRead<T> = { n: number } & ({ body: T | null } | { problem: Failure });

/** A poll under way. */
export interface Poll {
  /** How many reads have begun. */
  begun(): number;
  /** No more reads, and an answer on its way is handed to no one. */
  stop(): void;
}

/**
 * Read `path` about every 2 s while the page is visible (decision 6), one read at a time, each with
 * the ETag the last body came with (`getTagged`), handing each answer to `onRead`, which says
 * whether to read on. Hidden, it reads nothing, and back in view it reads once the wait since the
 * last answer is over. A `429` waits its `Retry-After`, from 2 s to a minute (L5's rule). A
 * definitive `401` stops it, as the stream closes on one (`sse-client.ts`): the client has signed
 * out already, and another read would only sign out again (#332's review).
 */
export function pollTagged<T>(
  api: Pick<ApiClient, 'getTagged'>,
  path: string,
  onRead: (read: PollRead<T>) => boolean,
  doc: PageVisibility,
): Poll {
  let etag: string | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let reading = false;
  let stopped = false;
  let reads = 0;
  /** When the next read may begin: 2 s after the last answer, or a `429`'s wait. */
  let nextAt = 0;

  const schedule = () => {
    if (stopped || reading || timer !== undefined || doc.visibilityState === 'hidden') return;
    timer = setTimeout(() => void read(), Math.max(0, nextAt - Date.now()));
  };
  const onVisibility = () => {
    if (doc.visibilityState !== 'hidden') return schedule();
    clearTimeout(timer);
    timer = undefined;
  };
  const stop = () => {
    stopped = true;
    clearTimeout(timer);
    doc.removeEventListener('visibilitychange', onVisibility);
  };

  async function read(): Promise<void> {
    timer = undefined;
    reading = true;
    const n = (reads += 1);
    let wait = POLL_EVERY_MS;
    let answer: PollRead<T>;
    try {
      const got = await api.getTagged<T>(path, etag);
      if (got) etag = got.etag;
      answer = { n, body: got?.body ?? null };
    } catch (e) {
      const problem = failureOf(e);
      if (problem.kind === 'failed' && problem.status === 429) {
        const asked = (problem.retryAfter ?? Infinity) * 1000;
        wait = Math.min(Math.max(asked, POLL_EVERY_MS), LONGEST_WAIT_MS);
      }
      answer = { n, problem };
    }
    reading = false;
    if (stopped) return;
    nextAt = Date.now() + wait;
    const signedOut = 'problem' in answer && answer.problem.status === 401;
    if (!onRead(answer) || signedOut) stop();
    else schedule();
  }

  doc.addEventListener('visibilitychange', onVisibility);
  schedule();
  return { begun: () => reads, stop };
}

/**
 * Read `questionId`'s results (`GET /v1/questions/{id}/results`) through `pollTagged`, handing each
 * change to `onChange`: a failure is the `problem`, read again in 2 s. It stops once the question
 * is closed: after the read that sees it closed, or the stream's `question_closed` (`closed()`),
 * one more good read.
 */
export function pollResults(
  api: Pick<ApiClient, 'getTagged'>,
  questionId: string,
  onChange: (state: ResultsState) => void,
  doc: PageVisibility = document,
): ResultsPoll {
  let state: ResultsState = { results: null, final: false, problem: null };
  /** How many reads had begun once the question was known closed. */
  let closedAt: number | undefined;
  const poll = pollTagged<QuestionResults>(
    api,
    `/v1/questions/${questionId}/results`,
    (read) => {
      let next: ResultsState;
      if ('problem' in read) next = { ...state, problem: read.problem };
      else {
        const results = read.body ?? state.results;
        const closed = results?.open === false;
        if (closed) closedAt ??= read.n;
        // A failed read is never the last, nor one begun before the close was known.
        next = { results, problem: null, final: closed && read.n > (closedAt ?? Infinity) };
      }
      const changed =
        next.results !== state.results || next.problem !== state.problem || next.final;
      state = next;
      if (changed) onChange(state);
      return !state.final;
    },
    doc,
  );
  return {
    closed: () => {
      closedAt ??= poll.begun();
    },
    stop: () => poll.stop(),
  };
}
