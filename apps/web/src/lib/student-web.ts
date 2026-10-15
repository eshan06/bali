import type {
  AgeCheckResponse,
  AnswerRequest,
  AnswerResponse,
  MeResponse,
  Presentation,
  StudentAnswer,
} from '@bali/shared';

import type { ApiClient } from './api-client';
import { eventIdAfter } from './event-id';
import { minutesSinceContact } from './grid-state';
import { type Failure, failureOf, type PageVisibility, pollTagged } from './live-question';

/*
 * The portal's student side (Phase 7, W2; ARCHITECTURE, "Live lesson", decisions 4, 6 and 13),
 * tested and holding no words: W3 and W4 say each answer as the approved portal canvas does. Where
 * the home sends an account, a running session's lesson, polled, the student's answer, and the
 * chip of their own phone.
 */

/** Where the portal's home sends an account (decision 13). */
export type Home =
  /** A teacher to their classes; a student whose account said 13+ in the app to theirs. */
  | { kind: 'teacher' | 'student'; me: MeResponse }
  /** Anyone else: the invite-code page, with its line for students. */
  | { kind: 'invite' };

/**
 * Where the home sends this account, read in the app's order: the age check first, a read that
 * creates nothing (C7), so a sign-in that never set up the app goes to the invite page with no
 * account made for it (the invite's redeem makes one); then `/v1/me`, whose role tells a teacher
 * (whose check always passed) from a student. The shell's one read of the account (PV15), so every
 * page reads it so, a class page's link too. A read that fails throws its error, as the client's
 * reads do, for the page to say in its words with a Try again, never a guess; only a `401` has
 * signed out, as the client does on one.
 */
export async function homeFor(api: Pick<ApiClient, 'get'>): Promise<Home> {
  const { passed } = await api.get<AgeCheckResponse>('/v1/me/age-check');
  if (!passed) return { kind: 'invite' };
  const me = await api.get<MeResponse>('/v1/me');
  return { kind: me.user.role === 'teacher' ? 'teacher' : 'student', me };
}

/** What the lesson page knows of a running session's lesson. */
export interface LessonState {
  /**
   * What the last good read said, null before the first; a `304` keeps it. The student's answer in
   * it is the one whose id sorts last, a read's or this page's (decision 4). `running` false: the
   * session is over, and the reads have stopped.
   */
  presentation: Presentation | null;
  /** The last read's failure, null once a read works: what is kept may be behind meanwhile. */
  problem: Failure | null;
  /**
   * While `problem` is set, when the last good read answered, by this computer's clock (ms): what
   * the kept state, the phone's chip with it, is "as of". Null before any, and while reads work.
   */
  asOf: number | null;
}

/** An answer's one request: the answer Bali holds now, this one or a later one, or why not. */
export type AnswerResult = { kind: 'answered'; answer: StudentAnswer } | Failure;

/** A lesson the page follows. */
export interface Lesson {
  /**
   * Send the student's pick (`POST /v1/questions/{id}/answers`) in one request (decision 5), under
   * an id minted after the answer held and after the last minted here, so it counts however far
   * behind this computer's clock stands. Refused by `reason`: `question_closed` (it closed, or the
   * bell rang, first), `invalid_option`, `event_id_conflict`, `account_deleted`. A pick again sends
   * a new one.
   */
  answer(questionId: string, option: number): Promise<AnswerResult>;
  /** No more reads, and nothing more handed on: the page is done with the lesson. */
  stop(): void;
}

/** Of two answers to one question, the one Bali took last: the id that sorts last (decision 4). */
function later(held: StudentAnswer | null, other: StudentAnswer | null): StudentAnswer | null {
  if (held === null || other === null) return held ?? other;
  return other.eventId > held.eventId ? other : held;
}

/** `lesson` with `answer` to `questionId` in it, where that sorts after the answer it holds. */
function keepLater(
  lesson: Presentation | null,
  questionId: string,
  answer: StudentAnswer | null,
): Presentation | null {
  const question = lesson?.question;
  if (!lesson || !question || question.id !== questionId) return lesson;
  const kept = later(question.answer, answer);
  return kept === question.answer ? lesson : { ...lesson, question: { ...question, answer: kept } };
}

/**
 * Follow `sessionId`'s lesson (`GET /v1/sessions/{id}/presentation`) as the phone does (L5), through
 * `pollTagged`: about every 2 s while the page is visible, each change handed to `onChange`. A
 * failure is the `problem`, read again in 2 s (a `429` once its `Retry-After` is over; a `401` stops
 * the reads). A read made before an answer landed never takes it back. The reads stop for good at
 * the first saying the session isn't running.
 */
export function followLesson(
  api: Pick<ApiClient, 'getTagged' | 'post'>,
  sessionId: string,
  onChange: (state: LessonState) => void,
  doc: PageVisibility = document,
): Lesson {
  let state: LessonState = { presentation: null, problem: null, asOf: null };
  let readAt: number | null = null;
  /** The last answer minted here, and its question: the next is minted after it too. */
  let minted: { questionId: string; eventId: string } | null = null;
  let done = false;

  const set = (next: LessonState) => {
    const changed = next.presentation !== state.presentation || next.problem !== state.problem;
    state = next;
    if (changed && !done) onChange(state);
  };

  const poll = pollTagged<Presentation>(
    api,
    `/v1/sessions/${sessionId}/presentation`,
    (read) => {
      if ('problem' in read) {
        set({ ...state, problem: read.problem, asOf: readAt });
        return true;
      }
      readAt = Date.now();
      let presentation = read.body ?? state.presentation;
      const shown = state.presentation?.question;
      if (read.body && shown) presentation = keepLater(read.body, shown.id, shown.answer);
      set({ presentation, problem: null, asOf: null });
      return presentation?.running !== false;
    },
    doc,
  );

  return {
    async answer(questionId, option) {
      const shown = state.presentation?.question;
      const held = [
        shown?.id === questionId ? shown.answer?.eventId : undefined,
        minted?.questionId === questionId ? minted.eventId : undefined,
      ].filter((id) => id !== undefined);
      const eventId = eventIdAfter(held.sort().at(-1) ?? null);
      minted = { questionId, eventId };
      try {
        const body: AnswerRequest = { eventId, option };
        const res = await api.post<AnswerResponse>(`/v1/questions/${questionId}/answers`, body);
        set({ ...state, presentation: keepLater(state.presentation, questionId, res.answer) });
        return { kind: 'answered', answer: res.answer };
      } catch (e) {
        return failureOf(e);
      }
    },
    stop() {
      done = true;
      poll.stop();
    },
  };
}

/**
 * The chip beside the class's name (decision 13): the app's (DESIGN.md §2), Silent with the whole
 * minutes since Bali last heard from the phone (`since`), as the grid counts them. Any chip but
 * `focused` takes its line under the head; the words, the canvas's, are the lesson page's (W4).
 * `unknown`: a state this page has no chip for (a newer server), never a calm guess.
 */
export type PhoneChip =
  | { kind: 'focused' | 'not_in' | 'unlocked' | 'protection_off' | 'unknown' }
  | { kind: 'silent'; minutes: number; since: string | null };

/**
 * The student's own phone in the lesson, from the read's `phone` (W1): the state the teacher's grid
 * shows, derived by the server at its clock, so never greener than that; not in while the student
 * has no live participation here. Null before the first good read (the page is checking) and once
 * the session is over. While a read fails, its state is the last good read's, as of `state.asOf`,
 * and Silent's minutes count on to `now`, as the grid's do.
 */
export function phoneChip(state: LessonState, now: Date = new Date()): PhoneChip | null {
  if (!state.presentation?.running) return null;
  const phone = state.presentation.phone;
  if (!phone) return { kind: 'not_in' };
  switch (phone.state) {
    case 'focused':
    case 'unlocked':
    case 'protection_off':
      return { kind: phone.state };
    case 'silent': {
      const since = phone.lastSeenAt;
      const lastSeenAt = since === null ? null : new Date(since);
      const minutes = minutesSinceContact({ lastSeenAt, joinedAt: null }, now);
      return { kind: 'silent', minutes, since };
    }
    default:
      return { kind: 'unknown' };
  }
}
