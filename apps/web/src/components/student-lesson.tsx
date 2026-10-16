'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useId, useRef, useState } from 'react';

import { getAccessToken } from '@/lib/auth';
import { bellTime } from '@/lib/session-controls';
import {
  type Bell,
  followLesson,
  type LessonState,
  lessonView,
  type LessonView,
  type StudentClass,
} from '@/lib/student-web';
import { useApi } from '@/lib/use-api';

import { Button, buttonClass } from './button';
import { CARD_ALONE } from './card';
import { Countdown, Ring, shareLeft, useClock } from './live-header';
import { useMe } from './shell';

const EMPTY: LessonState = { presentation: null, problem: null, asOf: null };

/**
 * A student's lesson (W4; StudentLesson, StudentWaiting, StudentEnded, StudentStates, and
 * StudentCardStates, drawn first): the class `classId`'s session `sessionId`, followed once the
 * account lists it as the class's (`followLesson`, W2). The account is the shell's one read, read
 * again as the page opens and at the bell, so minutes the teacher added move it; a class the account
 * doesn't list isn't the student's. The question card is W4's part 1b; the phone's chip and its
 * line, part 2's.
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
  const listed = klass?.liveSession?.id === sessionId ? klass.liveSession : null;
  // The session's start and bell, kept once a read lists it: a read after its end lists none.
  const [bell, setBell] = useState<Bell | null>(listed);
  if (listed && (listed.endsAt !== bell?.endsAt || listed.startedAt !== bell?.startedAt)) {
    setBell(listed);
  }
  const endsAt = bell?.endsAt ?? null;
  const follows = endsAt !== null;

  useEffect(() => {
    if (!follows) return;
    const followed = followLesson(api, sessionId, setLesson);
    return () => followed.stop();
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
 * without a time when the page can't say when, StudentCardStates); and the class's head over
 * "Nothing shared yet" (StudentWaiting), or alone while a question or a slide shows that this page
 * doesn't draw yet (the question card is part 1b's, slides W5's; StudentCardStates); "Can't reach
 * Bali" under the head while reads fail.
 */
export function StudentLesson({ view, onRetry }: { view: LessonView; onRetry: () => void }) {
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
      {presentation.question === null && presentation.slide === null ? (
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
