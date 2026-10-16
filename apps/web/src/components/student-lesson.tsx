'use client';

import type { StudentQuestion } from '@bali/shared';
import { Check, CircleCheck, EyeOff } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useId, useRef, useState } from 'react';

import { getAccessToken } from '@/lib/auth';
import { bellTime } from '@/lib/session-controls';
import {
  type Bell,
  followLesson,
  keptBell,
  type Lesson,
  type LessonState,
  lessonView,
  type LessonView,
  picker,
  type Picks,
  type Said,
  type Sending,
  type StudentClass,
} from '@/lib/student-web';
import { useApi } from '@/lib/use-api';

import { Button, buttonClass } from './button';
import { CARD_ALONE } from './card';
import { Countdown, Ring, shareLeft, useClock } from './live-header';
import { letterClass, letterOf } from './question-card';
import { useMe } from './shell';

/** The line under every question (StudentLesson), the board's own words. */
export const PRIVACY = "Your teacher sees the class's totals, never which answer is yours.";

const EMPTY: LessonState = { presentation: null, problem: null, asOf: null };

/**
 * A student's lesson (W4; StudentLesson, StudentClosed, StudentWaiting, StudentEnded, StudentStates,
 * and StudentNoSlide and StudentCardStates, drawn first): the class `classId`'s session
 * `sessionId`, followed once the account lists it as the class's (`followLesson`, W2), its question
 * answered here. The account is the shell's one read, read again as the page opens and at the bell,
 * so minutes the teacher added move it; a class the account doesn't list isn't the student's. The
 * phone's chip and its line are W4's part 2.
 */
export function StudentLessonPage({ classId, sessionId }: { classId: string; sessionId: string }) {
  const api = useApi();
  const router = useRouter();
  const { home, me, error, load } = useMe();
  // The account as the page opened: only a read since says the class isn't the student's.
  const [opened] = useState(me);
  const asked = useRef(false);
  const [lesson, setLesson] = useState<LessonState>(EMPTY);
  const [attempt, setAttempt] = useState(0);
  const following = useRef<Lesson | null>(null);
  const [picks, setPicks] = useState<Picks>({ sending: null, said: null });
  const [pick] = useState(() => picker(setPicks));

  useEffect(() => {
    if (!getAccessToken()) {
      router.replace('/login');
      return;
    }
    asked.current = true;
    load();
  }, [load, router]);

  // A lesson is a student's: a teacher, or an account never through the 13+ check, goes home.
  useEffect(() => {
    if (home !== null && home.kind !== 'student') router.replace('/');
  }, [home, router]);

  const klass = me?.classes.find((c) => c.id === classId);
  // The session's start and bell, kept once a read lists it: a read after its end lists none.
  const [bell, setBell] = useState(() => keptBell(null, klass, sessionId));
  const kept = keptBell(bell, klass, sessionId);
  if (kept !== bell) setBell(kept);
  const endsAt = bell?.endsAt ?? null;
  // Never once the account no longer lists the class: its reads would only be refused.
  const follows = endsAt !== null && klass !== undefined;

  useEffect(() => {
    if (!follows) return;
    const followed = followLesson(api, sessionId, setLesson);
    following.current = followed;
    return () => {
      followed.stop();
      following.current = null;
    };
  }, [api, sessionId, follows, attempt]);

  // The account again at the bell, once: minutes the teacher added bring a later one.
  useEffect(() => {
    if (endsAt === null) return;
    const timer = window.setTimeout(() => load(), Math.max(0, Date.parse(endsAt) - Date.now()));
    return () => window.clearTimeout(timer);
  }, [endsAt, load]);

  if (home === null || home.kind !== 'student') return null;
  const account = me !== opened ? 'fresh' : asked.current && error !== null ? 'failed' : 'stale';
  return (
    <StudentLesson
      view={lessonView(klass, account, bell, lesson)}
      sending={picks.sending}
      said={picks.said}
      onPick={(questionId, option) => void pick(following.current, questionId, option)}
      onRetry={() => {
        setLesson(EMPTY);
        setAttempt((n) => n + 1);
        load();
      }}
    />
  );
}

/** A line said in the lesson's place, beside what to do (StudentStates' `.said`). */
const SAID = 'flex flex-wrap items-center gap-x-4 gap-y-3';

/**
 * The lesson page as its state draws it (W4): Loading… and the lesson that didn't load, with Try
 * again (StudentStates); not in this class (StudentCardStates); class over (StudentEnded, its line
 * without a time when the page can't say when, StudentCardStates); and the class's head over the
 * question card (StudentNoSlide), "Nothing shared yet" (StudentWaiting), or, a slide alone, the head
 * alone until W5 draws slides here; "Can't reach Bali" under the head while reads fail.
 */
export function StudentLesson({
  view,
  sending,
  said,
  onPick,
  onRetry,
}: {
  view: LessonView;
  sending: Sending;
  said: Said;
  onPick: (questionId: string, option: number) => void;
  onRetry: () => void;
}) {
  const over = useId();
  if (view.kind === 'loading') {
    return (
      <main>
        <p role="status" className="text-body text-text-secondary">
          Loading…
        </p>
      </main>
    );
  }
  if (view.kind === 'failed') {
    return (
      <main className={SAID}>
        <p role="alert" className="text-body">
          Bali couldn&apos;t load this lesson.
        </p>
        <Button variant="secondary" size="sm" onClick={onRetry}>
          Try again
        </Button>
      </main>
    );
  }
  if (view.kind === 'not_in_class') {
    return (
      <main className={SAID}>
        <p role="alert" className="text-body">
          This lesson is for a class you&apos;re not in.
        </p>
        <Link href="/" className={buttonClass('secondary', '', 'sm')}>
          Your classes
        </Link>
      </main>
    );
  }
  if (view.kind === 'over') {
    const at = view.at === null ? null : new Date(view.at).toISOString();
    return (
      <main className="flex flex-col gap-5.5">
        <LessonHead klass={view.klass} bell={null} />
        <section
          aria-labelledby={over}
          className={`flex max-w-160 flex-col items-start gap-3 ${CARD_ALONE}`}
        >
          <h2 id={over} className="text-h3">
            Class is over
          </h2>
          <p className="text-body text-text-secondary">
            {at === null ? (
              'This class has ended.'
            ) : (
              <>
                This class ended at <time dateTime={at}>{bellTime(at)}</time>.
              </>
            )}{' '}
            Slides and questions from it aren&apos;t available after class.
          </p>
          <Link href="/" className={buttonClass('secondary')}>
            Your classes
          </Link>
        </section>
      </main>
    );
  }
  const { klass, bell, presentation, behind } = view;
  const q = presentation.question;
  return (
    <main className="flex flex-col gap-5.5">
      <LessonHead klass={klass} bell={bell} />
      {behind ? (
        <p
          role="status"
          className="rounded-sm border border-border-default bg-surface-sunken px-4 py-3 text-body text-text-primary"
        >
          Can&apos;t reach Bali right now, so this page may be behind. It keeps trying.
        </p>
      ) : null}
      {q ? (
        // At its own width beside where a slide goes (StudentNoSlide); a column of its own under
        // 1024 px, as StudentZoom draws it.
        <div className="lg:max-w-100">
          <QuestionCard
            question={q}
            sending={sending?.questionId === q.id ? sending.option : null}
            said={said?.questionId === q.id ? said.said : null}
            onPick={(option) => onPick(q.id, option)}
          />
        </div>
      ) : presentation.slide === null ? (
        <p className="text-body text-text-secondary">
          Nothing shared yet. Slides and questions from your teacher show up here.
        </p>
      ) : null}
    </main>
  );
}

/**
 * The class's head (StudentLesson): the ring, the share of the session left, the class over "with
 * Ms. Rivera", and the time left to the server's bell on this computer's clock with the bell under
 * it; once the class is over (StudentEnded), the class and its teacher alone. The phone's chip at
 * its end is W4's part 2.
 */
function LessonHead({ klass, bell }: { klass: StudentClass; bell: Bell | null }) {
  const now = useClock(bell?.endsAt ?? null);
  const teacher = klass.teacher.displayName?.trim();
  return (
    <header className="flex flex-wrap items-center gap-x-4.5 gap-y-3.5 max-sm:gap-x-3.5">
      {bell ? (
        <Ring share={shareLeft(bell.startedAt, bell.endsAt, now)} box={44} stroke={5} />
      ) : null}
      <div className="min-w-0 max-sm:flex-1">
        <h1 className="text-page-title text-balance wrap-anywhere max-sm:text-h3">{klass.name}</h1>
        {teacher ? (
          <p className="mt-0.5 text-meta text-text-secondary wrap-anywhere">with {teacher}</p>
        ) : null}
      </div>
      {bell ? <Countdown endsAt={bell.endsAt} now={now} /> : null}
    </header>
  );
}

/**
 * An open question's answer (v2.css's `.s-opt`): white, a strong edge, 17/26; picked
 * (`aria-pressed`), the brand's fill, semibold and white, its letter white with the brand's ink, a
 * check at its end.
 */
const OPTION =
  'group flex min-h-13 w-full cursor-pointer items-center gap-3 rounded-sm border border-border-strong bg-surface-card px-4 py-3 text-left text-body-lg text-text-primary hover:bg-surface-sunken aria-pressed:border-action-primary-bg aria-pressed:bg-action-primary-bg aria-pressed:font-semibold aria-pressed:text-action-primary-fg aria-pressed:hover:bg-action-primary-bg';
/** A closed question's answer (`.s-done`); the student's own (`.mine`); the correct one (`.right`). */
const DONE = 'border border-border-default bg-surface-card px-4 py-3 text-text-secondary';
const MINE = 'border border-border-strong bg-surface-sunken px-4 py-3 text-text-primary';
const RIGHT = 'border-2 border-bar-right bg-option-right px-3.75 py-2.75 text-text-primary';
/** A closed answer's mark under its words (`.s-mark`). */
const MARK = 'inline-flex items-center gap-1 text-section-label uppercase';

/** The card's line under the answers (StudentLesson, StudentNotIn, StudentClosed; StudentCardStates). */
function caption(q: StudentQuestion, open: boolean, sending: boolean): string {
  if (!open) {
    return q.correctOption === null
      ? 'Your teacher closed this question.'
      : 'Your teacher closed it and showed the answer.';
  }
  if (sending) return 'Sending your answer…';
  return q.answer
    ? 'Your answer is in. You can change it until the question closes.'
    : 'Pick an answer. You can change it until the question closes.';
}

/**
 * The question card (StudentLesson, StudentNotIn, StudentClosed; StudentCardStates' states, drawn
 * first), the phone's card in v2's look (decision 13): a tap on an answer sends it and another
 * changes it until the close, no Submit; closed, the correct answer marked once shown, never red,
 * and the student's own as Your answer; never a count, nor anyone else's answer. `sending`: the
 * answer on its way; `said`: what the last one's request said, the line's place taken by it.
 */
function QuestionCard({
  question: q,
  sending,
  said,
  onPick,
}: {
  question: StudentQuestion;
  sending: number | null;
  said: 'too_late' | 'failed' | null;
  onPick: (option: number) => void;
}) {
  const id = useId();
  // Closed once a read says so, or once Bali said this question closed before the answer reached
  // it: too late is said on the closed card (StudentCardStates), the read saying so due within 2 s.
  const open = q.open && said !== 'too_late';
  const picked = sending ?? q.answer?.option ?? null;
  // A send that failed is no news once the question has closed: there's no picking it again.
  const alert =
    said === 'too_late'
      ? "This question closed before your answer reached Bali, so it wasn't counted."
      : said === 'failed' && open
        ? "Bali couldn't send your answer. Check your connection and pick it again."
        : null;
  return (
    <section
      aria-labelledby={id}
      className="flex flex-col gap-3.5 rounded-live border border-border-default bg-surface-card p-5.5 shadow-1"
    >
      <div>
        <p
          className={`text-section-label uppercase ${open ? 'text-text-brand' : 'text-text-tertiary'}`}
        >
          {open ? 'Question' : 'Question · closed'}
        </p>
        <h2 id={id} className="mt-2 text-h3 text-pretty wrap-break-word">
          {q.prompt}
        </h2>
      </div>
      <div className="flex flex-col gap-2">
        {q.options.map((option, i) => {
          if (open) {
            return (
              <button
                key={i}
                type="button"
                aria-pressed={picked === i}
                // The answer Bali holds sends nothing again, but while one is on its way (a send
                // that hangs never says it didn't send) or after one didn't send (Bali may have
                // taken it, its answer lost, and the line says to pick it again).
                onClick={() => {
                  if (picked !== i || sending !== null || said === 'failed') onPick(i);
                }}
                className={OPTION}
              >
                <span
                  aria-hidden="true"
                  className={`${letterClass(false)} group-aria-pressed:bg-surface-card group-aria-pressed:text-text-brand`}
                >
                  {letterOf(i)}
                </span>
                <span className="min-w-0 flex-1 wrap-break-word">{option}</span>
                {picked === i ? <Check size={20} aria-hidden="true" className="shrink-0" /> : null}
              </button>
            );
          }
          const right = q.correctOption === i;
          const mine = q.answer?.option === i;
          return (
            <div
              key={i}
              className={`flex min-h-13 items-center gap-3 rounded-sm text-body-lg ${right ? RIGHT : mine ? MINE : DONE}`}
            >
              <span aria-hidden="true" className={letterClass(right)}>
                {letterOf(i)}
              </span>
              <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span className={`wrap-break-word${right ? ' font-semibold' : ''}`}>{option}</span>
                {right || mine ? (
                  <span className="flex flex-wrap items-center gap-x-3 gap-y-0.5">
                    {right ? (
                      <span className={`${MARK} text-text-brand`}>
                        <CircleCheck size={14} aria-hidden="true" />
                        Correct answer
                      </span>
                    ) : null}
                    {mine ? (
                      <span className={`${MARK} text-state-notjoined-fg`}>Your answer</span>
                    ) : null}
                  </span>
                ) : null}
              </span>
            </div>
          );
        })}
      </div>
      {alert ? (
        <p role="alert" className="text-body">
          {alert}
        </p>
      ) : (
        <p aria-live="polite" className="text-caption text-text-tertiary">
          {caption(q, open, sending !== null)}
        </p>
      )}
      <p className="flex items-start gap-2 border-t border-border-default pt-3 text-caption text-text-tertiary">
        <EyeOff size={16} aria-hidden="true" className="mt-px shrink-0" />
        {PRIVACY}
      </p>
    </section>
  );
}
