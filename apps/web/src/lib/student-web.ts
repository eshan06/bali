import type {
  AgeCheckResponse,
  AnswerRequest,
  AnswerResponse,
  MeResponse,
  Presentation,
  StudentAnswer,
  StudentQuestion,
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

/** A student's class as `/v1/me` lists it. */
export type StudentClass = MeResponse['classes'][number];
/** One in session: its session's id, start and bell. */
export type InSession = StudentClass & { liveSession: NonNullable<StudentClass['liveSession']> };

/**
 * A student's classes as their home shows them at `now`, by this computer's clock (W3): those in
 * session, each by the last read of `/v1/me` (running by the server's clock then) until its bell,
 * as the app's Home counts it; then the rest. Each part in `/v1/me`'s order (PV3b).
 */
export function homeClasses(
  me: MeResponse,
  now: number,
): { inSession: InSession[]; others: StudentClass[] } {
  const live = (c: StudentClass): c is InSession =>
    c.liveSession !== null && Date.parse(c.liveSession.endsAt) > now;
  return { inSession: me.classes.filter(live), others: me.classes.filter((c) => !live(c)) };
}

/**
 * The first bell still to ring among the classes in session at `now` (ms), or null: when the home
 * reads the account again, so a class leaves the live card at its bell, or stays with the later
 * bell its teacher's added minutes gave it.
 */
export function nextBell(me: MeResponse, now: number): number | null {
  const bells = homeClasses(me, now).inSession.map((c) => Date.parse(c.liveSession.endsAt));
  return bells.length > 0 ? Math.min(...bells) : null;
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
  /**
   * Once a read said the session is over (W4): `by`, when that read answered, and `after`, when the
   * last read before it that said it ran did, by this computer's clock (ms); null when no read here
   * saw it run. The session ended between the two (`endedAt`). Absent while it runs.
   */
  ended?: { after: number | null; by: number };
}

/**
 * How long an answer's send waits for its whole answer before it says it didn't send (#407's
 * review), about what a poll waits (`POLL_TIMEOUT_MS`, #334): a half-open connection never fails
 * by itself, so the card said "Sending your answer…" until the browser gave up, minutes later.
 */
export const ANSWER_TIMEOUT_MS = 10_000;

/**
 * An answer's one request: the answer Bali holds now, this one or a later one, or why not, with the
 * id it went under (none when nothing went), so a read since can say whether Bali took it after all.
 */
export type AnswerResult =
  { kind: 'answered'; answer: StudentAnswer } | (Failure & { eventId?: string });

/** A lesson the page follows. */
export interface Lesson {
  /**
   * Send the student's pick (`POST /v1/questions/{id}/answers`) in one request (decision 5), under
   * an id minted after the answer held and after the last minted here, so it counts however far
   * behind this computer's clock stands. Refused by `reason`: `question_closed` (it closed, or the
   * bell rang, first), `invalid_option`, `event_id_conflict`, `account_deleted`; with no whole
   * answer in `ANSWER_TIMEOUT_MS`, failed as no answer; either with the id it went under. A pick
   * again sends a new one, minted after this one, so this one landing late never wins over it.
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
      const ran = state.presentation?.running === true ? readAt : null;
      readAt = Date.now();
      let presentation = read.body ?? state.presentation;
      const shown = state.presentation?.question;
      if (read.body && shown) presentation = keepLater(read.body, shown.id, shown.answer);
      const over = presentation?.running === false;
      set({
        presentation,
        problem: null,
        asOf: null,
        ...(over ? { ended: { after: ran, by: readAt } } : {}),
      });
      return !over;
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
        const path = `/v1/questions/${questionId}/answers`;
        const res = await api.post<AnswerResponse>(path, body, ANSWER_TIMEOUT_MS);
        set({ ...state, presentation: keepLater(state.presentation, questionId, res.answer) });
        return { kind: 'answered', answer: res.answer };
      } catch (e) {
        return { ...failureOf(e), eventId };
      }
    },
    stop() {
      done = true;
      poll.stop();
    },
  };
}

/** How close the last read saying the session ran must come before the one saying it ended. */
export const ENDED_WITHIN_MS = 30_000;
/** How far this computer's clock may stand from the server's when the bell is weighed. */
export const CLOCK_SKEW_MS = 10_000;

/**
 * When the session ended, as this page can vouch for it (ms), or null when it can't: only when a
 * read that saw it run came within `ENDED_WITHIN_MS` of the one that saw it over, the end between
 * them; then the bell, the server's own time, when it fell between them, give or take
 * `CLOCK_SKEW_MS`, else that read's time: an End before the bell, or a bell moved later that this
 * page didn't hear of (it saw the class run past it). A page opened after the end, or away when it
 * came, can't say.
 */
export function endedAt(ended: LessonState['ended'], bell: string | null): number | null {
  if (!ended || ended.after === null || ended.by - ended.after > ENDED_WITHIN_MS) return null;
  const at = bell === null ? NaN : Date.parse(bell);
  const between = at >= ended.after - CLOCK_SKEW_MS && at <= ended.by + CLOCK_SKEW_MS;
  return between ? at : ended.by;
}

/**
 * What an answer's card says of its request (W4): nothing once Bali holds it; too late when the
 * question closed (or the bell rang) before it reached Bali (`question_closed`), which nothing here
 * can change; else that it didn't send, for the student to pick again.
 */
export function answerSaid(result: AnswerResult): 'too_late' | 'failed' | null {
  if (result.kind === 'answered') return null;
  return result.kind === 'refused' && result.reason === 'question_closed' ? 'too_late' : 'failed';
}

/** An answer on its way to Bali (W4): its question and the option picked. */
export type Sending = { questionId: string; option: number } | null;
/** What the last answer's request said (`answerSaid`), for its question, and the id it went under. */
export type Said = { questionId: string; said: 'too_late' | 'failed'; eventId?: string } | null;
/** The question card's picks as they go: the answer on its way, and what the last one said. */
export interface Picks {
  sending: Sending;
  said: Said;
}

/**
 * The question card's picks (W4): each sent through the lesson's one request (`Lesson.answer`),
 * shown on its way until Bali answers, then what its request said (`answerSaid`), each change handed
 * to `onChange`. Of picks whose answers cross, the last one's is the one said, an earlier one's
 * never. With no lesson to send through, it didn't send.
 */
export function picker(
  onChange: (picks: Picks) => void,
): (lesson: Pick<Lesson, 'answer'> | null, questionId: string, option: number) => Promise<void> {
  let last = 0;
  return async (lesson, questionId, option) => {
    const mine = (last += 1);
    onChange({ sending: { questionId, option }, said: null });
    const result: AnswerResult = lesson
      ? await lesson.answer(questionId, option)
      : { kind: 'failed', status: undefined, retryAfter: undefined };
    if (last !== mine) return;
    const said = answerSaid(result);
    const eventId = result.kind === 'answered' ? undefined : result.eventId;
    onChange({ sending: null, said: said === null ? null : { questionId, said, eventId } });
  };
}

/**
 * What the question card says of the last pick's request, by the read since (W4's follow-up): only
 * for its own question; and a send that said it didn't send says nothing once a read shows Bali
 * holding its answer, or one taken after it (an id that sorts at or after the one it went under,
 * decision 4): its reply was lost or came after `ANSWER_TIMEOUT_MS`, or a pick on another device
 * since stands. The card then says the answer is in, as for any answer Bali holds.
 */
export function saidNow(
  said: Said,
  question: Pick<StudentQuestion, 'id' | 'answer'>,
): 'too_late' | 'failed' | null {
  if (said?.questionId !== question.id) return null;
  const held = question.answer?.eventId;
  const landed = said.eventId !== undefined && held !== undefined && held >= said.eventId;
  return said.said === 'failed' && landed ? null : said.said;
}

/** A session's start and bell, as `/v1/me` lists them (W3). */
export type Bell = InSession['liveSession'];

/**
 * The session's start and bell as the lesson page keeps them (W4): as the account's last read lists
 * them for the class, a later bell once the teacher added minutes; else, once a read lists the
 * class with no such session (it ended, or another began), the last ones listed, kept (`kept`).
 */
export function keptBell(
  kept: Bell | null,
  klass: StudentClass | undefined,
  sessionId: string,
): Bell | null {
  const listed = klass?.liveSession;
  if (listed?.id !== sessionId) return kept;
  return listed.endsAt === kept?.endsAt && listed.startedAt === kept.startedAt ? kept : listed;
}

/** What the lesson page shows (W4), as kinds: its words are the page's. */
export type LessonView =
  | { kind: 'loading' }
  /** No read to show: the lesson's first, or the account's, failed, or Bali refused the lesson. */
  | { kind: 'failed' }
  | { kind: 'not_in_class' }
  /** `at`: when it ended, when this page can say (`endedAt`). */
  | { kind: 'over'; klass: StudentClass; at: number | null }
  /** `behind`: the last read failed, so what shows is the last good one's, as of `asOf`. */
  | {
      kind: 'live';
      klass: StudentClass;
      bell: Bell;
      presentation: Presentation;
      behind: boolean;
      asOf: number | null;
    };

/**
 * The lesson page's state (W4), from the account (`/v1/me`, as last read: `klass`, the page's class
 * in it, if listed; `account`, whether a read answered since the page opened, failed, or is still
 * to come), the session's start and bell once a read listed it as the class's session (the page
 * follows it from then, never before), and the lesson's own reads. A class the account doesn't
 * list is never the student's to follow; a session no read listed is over (or not this class's).
 */
export function lessonView(
  klass: StudentClass | undefined,
  account: 'stale' | 'fresh' | 'failed',
  bell: Bell | null,
  lesson: LessonState,
): LessonView {
  if (!klass || !bell) {
    if (account !== 'fresh') return { kind: account === 'failed' ? 'failed' : 'loading' };
    return klass ? { kind: 'over', klass, at: null } : { kind: 'not_in_class' };
  }
  const { presentation, problem, asOf } = lesson;
  if (presentation?.running === false) {
    return { kind: 'over', klass, at: endedAt(lesson.ended, bell.endsAt) };
  }
  if (presentation === null || problem?.kind === 'refused') {
    return { kind: problem ? 'failed' : 'loading' };
  }
  return { kind: 'live', klass, bell, presentation, behind: problem !== null, asOf };
}

/**
 * The chip beside the class's name (decision 13): the app's (DESIGN.md §2), Silent with the whole
 * minutes since Bali last heard from the phone (`since`), as the grid counts them. Any chip but
 * `focused` and `unknown` takes its line under the head; the words, the canvas's, are the lesson
 * page's (W4). `unknown`: a state this page has no chip for (a newer server), never a calm guess.
 */
export type PhoneChip =
  | { kind: 'focused' | 'not_in' | 'unlocked' | 'protection_off' | 'unknown' }
  | { kind: 'silent'; minutes: number; since: string };

/**
 * The student's own phone in the lesson, from the read's `phone` (W1): the state the teacher's grid
 * shows, derived by the server at its clock, so never greener than that; not in while the student
 * has no live participation here. Null before the first good read (the page is checking) and once
 * the session is over. While a read fails, its state is the last good read's, as of `state.asOf`,
 * and so are Silent's minutes, which stop at that time beside its "as of" (W4; #333's review);
 * otherwise they count on to `now`, as the grid's do. A Silent with no time, which W1 never sends,
 * is `unknown`.
 */
export function phoneChip(
  state: Pick<LessonState, 'presentation' | 'asOf'>,
  now: Date = new Date(),
): PhoneChip | null {
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
      if (since === null) return { kind: 'unknown' };
      const at = state.asOf === null ? now : new Date(state.asOf);
      const minutes = minutesSinceContact({ lastSeenAt: new Date(since), joinedAt: null }, at);
      return { kind: 'silent', minutes, since };
    }
    default:
      return { kind: 'unknown' };
  }
}

/**
 * Whether the home should read the account again for a class's lesson (W4): a read said its session
 * is over, or Bali refused it (the student left or was removed from the class since, or the session
 * isn't the class's), so the account now lists the class without it. A `401` has signed out.
 */
export function lessonGone(state: LessonState): boolean {
  const { presentation, problem } = state;
  return presentation?.running === false || (problem?.kind === 'refused' && problem.status !== 401);
}

/**
 * Whether the home's live card says it can't reach Bali (W4's follow-up; StudentChipUnreached,
 * drawn first): its lesson's reads fail and none has answered, so there's no read to keep the chip
 * "as of" and Checking… alone would hide the failure; they're read again every 2 s, as ever. Never
 * for a refusal, which has the account read again (`lessonGone`), nor a `401`, which signed out.
 */
export function unreached(state: LessonState): boolean {
  return state.presentation === null && state.problem?.kind === 'failed';
}
