'use client';

import type { FeedEvent, SessionSnapshot, TeacherQuestion } from '@bali/shared';
import { CircleCheck, MessageCircleQuestionMark } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';

import { Button } from '@/components/button';
import { CARD_ALONE } from '@/components/card';
import {
  closeAttemptFor,
  type CloseAttempt,
  closeQuestion,
  type DoneChannel,
  doneChannel,
  type Failure,
  failureOf,
  heardDone,
  type OpenAnswer,
  type OpenAttempt,
  openAttemptFor,
  openQuestion,
  POLL_EVERY_MS,
  pollResults,
  type QuestionDraft,
  questionAfter,
  type ResultsPoll,
  type ResultsState,
} from '@/lib/live-question';
import { keepUnanswered } from '@/lib/session-controls';
import { useApi } from '@/lib/use-api';

/** "A" to "F", an option's letter. */
export const letterOf = (i: number) => String.fromCharCode(65 + i);
/** Results that can't refresh (LessonStates), said on the class page's card and in Present's. */
export const BEHIND = "These totals may be behind. Bali can't reach the server and keeps trying.";
/** An option's letter in its 28 px circle (v2.css's `.letter`), the correct one's green. */
export const letterClass = (right: boolean) =>
  `grid size-7 shrink-0 place-items-center rounded-full text-data font-semibold ${right ? 'bg-letter-right text-text-brand' : 'bg-surface-sunken text-text-primary'}`;

/*
 * A question's results as its teacher sees them, the class page's card and a session's report alike
 * (L7, L7c): v2.css's `.results`, the options beside "N of M answered", under them on a narrow card.
 */
export const RESULTS = 'flex flex-wrap items-start gap-x-10 gap-y-5';
export const OPTIONS_COLUMN = 'min-w-0 flex-[999_1_440px]';
export const ANSWERED_COLUMN =
  'flex flex-[1_1_160px] flex-col gap-1 border-l border-border-default pl-6';

/**
 * A question's options (v2.css's `.opts`): each with its letter, the correct one marked, "Correct
 * answer" once students were shown it; and from the server's breakdown (`counts`, null until 3 have
 * answered: the guard is the server's, never the portal's) each one's count and its bar, out of
 * those who answered. Only totals: never who picked what.
 */
export function Options({
  question,
  counts,
  answered,
  shown,
}: {
  question: Pick<TeacherQuestion, 'options' | 'correctOption'>;
  counts: readonly number[] | null;
  answered: number;
  /** Students were shown the correct answer: its tag says so. */
  shown: boolean;
}) {
  return (
    // Under the question as the boards render it: `.app ul`'s margin 0 outranks `.opts`'s.
    <ul className="flex flex-col gap-3.5">
      {question.options.map((option, i) => {
        const right = question.correctOption === i;
        const n = counts?.[i];
        return (
          <li
            key={i}
            className="grid grid-cols-[28px_minmax(0,1fr)_3rem] items-center gap-x-3 gap-y-1.5"
          >
            <span aria-hidden="true" className={letterClass(right)}>
              {letterOf(i)}
            </span>
            <span className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
              <span className="min-w-0 wrap-break-word">{option}</span>
              {right ? (
                <span className="inline-flex items-center gap-1 text-section-label text-text-brand uppercase">
                  <CircleCheck size={14} aria-hidden="true" />
                  {shown ? 'Correct answer' : 'Correct'}
                </span>
              ) : null}
            </span>
            <span className="text-right text-data tabular-nums">{n ?? ''}</span>
            {n === undefined ? null : (
              <span
                aria-hidden="true"
                className={`col-start-2 h-2 rounded-full ${right ? 'bg-bar-right' : 'bg-bar'}`}
                style={{ width: `${Math.round((n / answered) * 100)}%` }}
              />
            )}
          </li>
        );
      })}
    </ul>
  );
}

/** "21 of 28 answered" (v2.css's `.answered .line`): who answered, of everyone who could. */
export const answeredLine = (answered: number, eligible: number) => (
  <p className="flex items-baseline gap-2">
    <span className="font-num text-data-lg tabular-nums">{answered}</span>
    <span className="text-text-secondary">of {eligible} answered</span>
  </p>
);

/** The class page's live question (L6's logic), held for one session. */
export interface LiveQuestion {
  /** What the card shows: the open question, or a closed one until Done or the next; else none. */
  question: TeacherQuestion | null;
  /** Its results as last read, and when the read came: a close found past the bell is the bell's. */
  results: (ResultsState & { at: number }) | null;
  /** A close on its way: both close buttons hold. */
  closing: boolean;
  /** A close that didn't go through, with the choice Try again sends again. */
  closeFailed: { reveal: boolean } | null;
  close: (reveal: boolean) => void;
  /** Put it away (Done), here and in every Bali window of this browser. */
  done: () => void;
}

/**
 * Open by the server's clock, as last heard: this tab's close or the stream's, or a read of its
 * results saying so first (the bell's close reaches the stream only once the sweep ends it all).
 */
export const isOpen = ({ question, results }: Pick<LiveQuestion, 'question' | 'results'>) =>
  question?.open === true && results?.results?.open !== false;

type Held = { session: string | null; question: TeacherQuestion | null };

/** An ask as the side panel shows it (L7-1b): on its way, or how the last one failed. */
export interface Opening {
  busy: boolean;
  failure: Failure | null;
  /**
   * What it asked: one of the teacher's questions, by its id (L7b, part 2), or null, the words
   * written in the panel.
   */
  from: string | null;
}
const IDLE: Opening = { busy: false, failure: null, from: null };

/**
 * The live question of `sessionId` (null: none running). Its words come from the session's read,
 * at the start and whenever the stream names a question this tab doesn't hold (`questionAfter`'s
 * `'unknown'`), and from this tab's own open; its results from `pollResults`. A read only ever
 * brings a newer question (ids are UUIDv7, so a later one sorts after), so a slow read never puts
 * back one closed or asked over meanwhile.
 */
export function useLiveQuestion(sessionId: string | null) {
  const api = useApi();
  const [held, setHeld] = useState<Held>({ session: null, question: null });
  const now = useRef<Held>(held);
  // The newest question this session has shown, and the poll reading the one shown.
  const newest = useRef('');
  const poll = useRef<{ id: string; poll: ResultsPoll } | null>(null);
  const [results, setResults] = useState<{ id: string; state: ResultsState; at: number } | null>(
    null,
  );
  const [closing, setClosing] = useState(false);
  const [closeFailed, setCloseFailed] = useState<{ id: string; reveal: boolean } | null>(null);
  const sending = useRef(false);
  const unansweredOpen = useRef<OpenAttempt | null>(null);
  const unansweredClose = useRef<CloseAttempt | null>(null);
  const retry = useRef<number | undefined>(undefined);
  const reading = useRef<{ session: string; again: boolean } | null>(null);
  // An ask on its way, held here, not by the panel, which a Close or a tile can unmount meanwhile:
  // a panel opened again shows it busy, so no second press sends the words under a second id.
  const [opening, setOpening] = useState<Opening>(IDLE);
  const askingNow = useRef(false);
  // Cancel forgets the last ask's failure, and one still on its way, of the words written alone:
  // what the last ask asked (`Opening.from`), null for them.
  const asks = useRef(0);
  const askedFrom = useRef<string | null>(null);
  // The session's last read, for the slide's hook, which takes what the session shows from it (M6,
  // part 2b): one read of the session for both cards.
  const [snapshot, setSnapshot] = useState<{ session: string; snap: SessionSnapshot } | null>(null);

  const put = useCallback((session: string | null, question: TeacherQuestion | null) => {
    const before = now.current.question;
    if (now.current.session !== session) return;
    if (question && question.id > newest.current) newest.current = question.id;
    // Closed now: its poll reads once more for the final counts (L6).
    if (before?.open && question?.id === before.id && !question.open) {
      if (poll.current?.id === question.id) poll.current.poll.closed();
    }
    now.current = { session, question };
    setHeld(now.current);
  }, []);

  const read = useCallback(
    async (session: string): Promise<void> => {
      // One read at a time: any asked for meanwhile (the stream's overlap as it starts) are one more.
      if (reading.current?.session === session) {
        reading.current.again = true;
        return;
      }
      reading.current = { session, again: false };
      window.clearTimeout(retry.current);
      let failed = false;
      try {
        const snap = await api.get<SessionSnapshot>(`/v1/sessions/${session}`);
        if (now.current.session === session) setSnapshot({ session, snap });
        const q = snap.question ?? null;
        if (q && q.id > newest.current) put(session, q);
      } catch (e) {
        failed = failureOf(e).kind === 'failed';
      }
      const again = reading.current?.session === session && reading.current.again;
      if (reading.current?.session === session) reading.current = null;
      // Gone, nothing more; else read again shortly, the grid saying meanwhile whether Bali is reached.
      if (now.current.session !== session) return;
      if (again) void read(session);
      else if (failed) retry.current = window.setTimeout(() => void read(session), POLL_EVERY_MS);
    },
    [api, put],
  );

  // A new session starts with nothing shown, then reads what it has open; none once it is gone.
  useEffect(() => {
    now.current = { session: sessionId, question: null };
    newest.current = '';
    setHeld(now.current);
    askingNow.current = false;
    setOpening(IDLE);
    askedFrom.current = null;
    if (sessionId !== null) void read(sessionId);
    return () => {
      window.clearTimeout(retry.current);
      now.current = { session: null, question: null };
    };
  }, [sessionId, read]);

  // Done reaches every Bali window of this browser (L7, part 3): one pressed here puts the question
  // away in the others too, so Present in a second window goes back to its grid, and theirs here.
  const told = useRef<DoneChannel | null>(null);
  useEffect(() => {
    const channel = doneChannel((news) => {
      const { session, question } = now.current;
      const heard = heardDone(news, session, question, newest.current);
      newest.current = heard.newest;
      if (heard.putAway) put(session, null);
    });
    told.current = channel;
    return () => {
      channel.close();
      told.current = null;
    };
  }, [put]);

  const id = held.session === sessionId ? (held.question?.id ?? null) : null;
  useEffect(() => {
    if (id === null) return;
    const p = pollResults(api, id, (state) =>
      setResults((prev) => ({
        id,
        state,
        // When it was first found closed: a close heard just before the bell is no bell's.
        at: prev?.id === id && prev.state.results?.open === false ? prev.at : Date.now(),
      })),
    );
    poll.current = { id, poll: p };
    return () => p.stop();
  }, [api, id]);

  // The session read again, for the slide's hook: a slide change its stream can't name, or a deck
  // gone meanwhile (M6, part 2b). One read at a time, as ever.
  const reread = useCallback(() => {
    const session = now.current.session;
    if (session !== null) void read(session);
  }, [read]);

  const onEvent = useCallback(
    (e: FeedEvent) => {
      if (e.type !== 'question_opened' && e.type !== 'question_closed') return;
      const { session, question } = now.current;
      if (session === null) return;
      const next = questionAfter(question, e);
      if (next === 'unknown') void read(session);
      else if (next !== question) put(session, next);
    },
    [put, read],
  );

  const ask = useCallback(
    async (draft: QuestionDraft, from: string | null = null): Promise<OpenAnswer | null> => {
      const session = now.current.session;
      if (session === null || askingNow.current) return null;
      askingNow.current = true;
      const mine = (asks.current += 1);
      askedFrom.current = from;
      setOpening({ busy: true, failure: null, from });
      const attempt = openAttemptFor(unansweredOpen.current, session, draft);
      const answer = await openQuestion(api, attempt);
      // A session gone meanwhile is the next one's no more: its own ask and attempt stand.
      if (now.current.session !== session) return null;
      unansweredOpen.current = keepUnanswered(attempt, answer);
      askingNow.current = false;
      const cancelled = asks.current !== mine;
      setOpening({
        busy: false,
        failure: answer.kind === 'opened' || cancelled ? null : answer,
        from,
      });
      // Its replay too, closed since perhaps; never over a question asked after it.
      if (answer.kind === 'opened' && answer.question.id >= newest.current) {
        put(session, answer.question);
      }
      // Cancelled on its way: the card shows what it asked, and no panel opened since is closed.
      return cancelled ? null : answer;
    },
    [api, put],
  );
  // The write form's Cancel: never an ask of one of the teacher's questions, whose failure waits
  // under it in their list however the panel was left meanwhile (santa's review, round 2).
  const forgetAsk = useCallback(() => {
    if (askedFrom.current !== null) return;
    asks.current += 1;
    setOpening((cur) => ({ ...cur, failure: null }));
  }, []);

  const close = useCallback(
    async (reveal: boolean) => {
      const { session, question } = now.current;
      if (sending.current || question === null) return;
      sending.current = true;
      setClosing(true);
      setCloseFailed(null);
      const attempt = closeAttemptFor(unansweredClose.current, question.id, reveal);
      const answer = await closeQuestion(api, attempt);
      unansweredClose.current = keepUnanswered(attempt, answer);
      sending.current = false;
      setClosing(false);
      if (now.current.question?.id !== question.id) return;
      if (answer.kind === 'closed') put(session, answer.question);
      else setCloseFailed({ id: question.id, reveal });
    },
    [api, put],
  );

  const question = held.session === sessionId ? held.question : null;
  const lesson: LiveQuestion = {
    question,
    results: question && results?.id === question.id ? { ...results.state, at: results.at } : null,
    closing,
    closeFailed: question && closeFailed?.id === question.id ? closeFailed : null,
    close: (reveal) => void close(reveal),
    done: () => {
      const { session, question: held } = now.current;
      // Only the question this Done was drawn for: one held since, not yet redrawn, stays.
      if (session === null || question === null || held?.id !== question.id) return;
      put(session, null);
      told.current?.tell({ sessionId: session, questionId: question.id });
    },
  };
  return { lesson, onEvent, ask, opening, forgetAsk, snapshot, reread };
}

/** v2.css's `.lesson` head: the title or the kicker, then its buttons. */
export const HEAD = 'flex flex-wrap items-center justify-between gap-x-6 gap-y-3';
/** v2.css's `.row`: a card's buttons, 10 px apart. */
export const ROW = 'flex flex-wrap items-center gap-2.5';

/*
 * A question's own buttons, the class page's card and Present's alike (L7; LessonLive, LessonClosed,
 * LessonStates; PresentQuestionControls, PresentAnswerControls, PresentControlsStates), in the class
 * page's words and through the hook's one close and one Done.
 */

/**
 * While it is open: Close, and Close and show answer when it has a correct one, both held while a
 * close is on its way.
 */
export const closeButtons = ({ question, closing, close }: LiveQuestion) => (
  <>
    <Button variant="secondary" onClick={() => close(false)} aria-disabled={closing}>
      Close
    </Button>
    {question === null || question.correctOption === null ? null : (
      <Button variant="secondary" onClick={() => close(true)} aria-disabled={closing}>
        Close and show answer
      </Button>
    )}
  </>
);

/**
 * A close that didn't go through, said while the question is still open, Try again sending the same
 * choice again: on the class page under the card's head; in Present at its size, under the buttons
 * and at their right, Try again a full-size button (PresentControlsStates).
 */
export function closeFailedLine(lesson: LiveQuestion, present = false) {
  const { closeFailed: failed, closing, close } = lesson;
  if (failed === null || !isOpen(lesson)) return null;
  return (
    <div className={`flex flex-wrap items-center gap-x-4 gap-y-3${present ? ' justify-end' : ''}`}>
      <p role="alert" className={present ? 'text-present-line' : 'text-body'}>
        Bali couldn&apos;t close the question.
      </p>
      <Button
        variant="secondary"
        size={present ? 'md' : 'sm'}
        onClick={() => close(failed.reveal)}
        aria-disabled={closing}
      >
        Try again
      </Button>
    </div>
  );
}

/**
 * Once it is closed: Done, which puts it away here and in every Bali window of this browser (the
 * hook's `done`), focus going on to `then`, what is left in its place.
 */
export const doneButton = ({ done }: LiveQuestion, then: string) => (
  <Button
    variant="secondary"
    onClick={() => {
      done();
      window.requestAnimationFrame(() => document.getElementById(then)?.focus());
    }}
  >
    Done
  </Button>
);

/**
 * Ask a question, or Ask another question, which opens the side panel (L7-1b): the question card's
 * and the slide card's (M6, part 2b-2) alike, `${id}-ask` on whichever card shows, so focus comes
 * back to it. `asking`: the panel is open, which it controls.
 */
export const askButton = (
  id: string,
  words: string,
  variant: 'primary' | 'secondary',
  asking: boolean,
  onAsk: () => void,
) => (
  <Button
    id={`${id}-ask`}
    variant={variant}
    onClick={onAsk}
    aria-expanded={asking}
    aria-controls={asking ? `${id}-panel` : undefined}
  >
    <MessageCircleQuestionMark size={16} aria-hidden="true" />
    {words}
  </Button>
);

/**
 * The class page's "Questions and slides" card (L7; LessonClass, LessonWaiting, LessonLive,
 * LessonClosed, LessonStates' lines), between the counts and the grid, never in Present. At rest,
 * Ask a question (Show slides is M6's). A question open: Close, and Close and show answer when it
 * has a correct one; closed: Ask another question and Done. Its options, and "N of M answered":
 * only totals, the count per option and its bar once the server's guard gives them (3 answers),
 * never who answered. `asking`: the side panel is open, which Ask a question controls (L7-1b).
 */
export function QuestionCard({
  id,
  lesson,
  endsAt,
  asking,
  onAsk,
}: {
  id: string;
  lesson: LiveQuestion;
  endsAt: string | null;
  asking: boolean;
  onAsk: () => void;
}) {
  const { question: q, results: r } = lesson;
  const ask = (words: string, variant: 'primary' | 'secondary') =>
    askButton(id, words, variant, asking, onAsk);
  if (q === null) {
    return (
      <section aria-labelledby={`${id}-lesson`} className={`flex flex-col gap-4 ${CARD_ALONE}`}>
        <div className={HEAD}>
          <h2 id={`${id}-lesson`} className="text-h3">
            Questions and slides
          </h2>
          <div className={ROW}>{ask('Ask a question', 'primary')}</div>
        </div>
      </section>
    );
  }
  const totals = r?.results ?? null;
  const open = isOpen(lesson);
  // Found closed with no close heard, past the bell: the bell's (A17), until the sweep ends it all.
  const bell = !open && q.open && endsAt !== null && (r?.at ?? 0) >= Date.parse(endsAt);
  const revealed = q.revealed || totals?.revealed === true;
  const counts = totals?.counts ?? null;
  const caption = (words: string) => (
    <p className="mt-3.5 text-caption text-text-tertiary">{words}</p>
  );
  return (
    <section aria-labelledby={`${id}-q`} className={`flex flex-col gap-4 ${CARD_ALONE}`}>
      <div className={HEAD}>
        <p
          className={`text-section-label uppercase ${open ? 'text-text-brand' : 'text-text-tertiary'}`}
        >
          {open ? 'Question · open' : 'Question · closed'}
        </p>
        <div className={ROW}>
          {open ? (
            closeButtons(lesson)
          ) : (
            <>
              {ask('Ask another question', 'secondary')}
              {/* Its place goes with it: on to the card's own Ask a question. */}
              {doneButton(lesson, `${id}-ask`)}
            </>
          )}
        </div>
      </div>
      {closeFailedLine(lesson)}
      {r?.problem && !r.final ? (
        <p
          role="status"
          className="rounded-sm border border-border-default bg-surface-sunken px-4 py-3 text-body text-text-primary"
        >
          {BEHIND}
        </p>
      ) : null}
      <div className={RESULTS}>
        <div className={OPTIONS_COLUMN}>
          {/* Focus comes here once it is asked, so a screen reader starts at the question. */}
          <h2 id={`${id}-q`} tabIndex={-1} className="text-h3 text-pretty wrap-break-word">
            {q.prompt}
          </h2>
          <Options
            question={q}
            counts={counts}
            answered={totals?.answered ?? 0}
            shown={!open && revealed}
          />
          {open ? null : bell ? (
            <p className="mt-3.5 text-body">The bell closed this question.</p>
          ) : q.correctOption === null ? null : (
            caption(
              revealed
                ? 'Students see the correct answer on their phones.'
                : "Students don't see which answer was correct.",
            )
          )}
        </div>
        {totals ? (
          <div aria-live="polite" className={ANSWERED_COLUMN}>
            {answeredLine(totals.answered, totals.eligible)}
            {r?.final ? <p className="text-caption text-text-tertiary">Final count</p> : null}
          </div>
        ) : null}
      </div>
    </section>
  );
}
