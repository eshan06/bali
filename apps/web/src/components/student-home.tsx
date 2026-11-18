'use client';

import type { MeResponse } from '@bali/shared';
import { CircleAlert } from 'lucide-react';
import Link from 'next/link';
import { useCallback, useEffect, useId, useState } from 'react';

import { lessonsOn } from '@/lib/lessons';
import {
  followLesson,
  homeClasses,
  type InSession,
  lessonGone,
  type LessonState,
  nextBell,
  phoneChip,
  rereadEvery,
  type StudentClass,
  unreached,
} from '@/lib/student-web';
import { useApi } from '@/lib/use-api';

import { buttonClass, QUIET } from './button';
import { LEDGER, LEDGER_CELL, LEDGER_HEAD, LEDGER_LIVE } from './card';
import { OOPS, WAIT_LINE } from './classes';
import { LIVE_CARD, LiveCardHead, Ring, shareLeft, useClock } from './live-header';
import { TextLink } from './text-link';
import { TryAgain } from './try-again';
import { CantReach, YourPhone } from './your-phone';

const UNREAD: LessonState = { presentation: null, problem: null, asOf: null };

/** The class's read of its session, for its phone's chip (decision 13), told on as it changes. */
function useLesson(sessionId: string, onGone: () => void): LessonState {
  const api = useApi();
  const [lesson, setLesson] = useState(UNREAD);
  useEffect(() => {
    const followed = followLesson(api, sessionId, (state) => {
      setLesson(state);
      if (!lessonGone(state)) return;
      followed.stop();
      onGone();
    });
    return () => followed.stop();
  }, [api, sessionId, onGone]);
  return lesson;
}

/**
 * A class in session, with lessons on (StudentHome's live card, as LO1 left it): the ring, the share
 * of the session left; the name over its teacher and "in class now", right under it as the board
 * renders it; the time left on this computer's clock to the server's bell, the bell under it; then
 * Open the lesson, to its page (W4), and the student's own phone, from the lesson's own read, as the
 * lesson page reads it, never a one-time `/v1/me` (decision 13: never greener than the teacher's
 * grid), its states as StudentChipStates draws them (drawn first); while its reads fail before one
 * answers, Checking… over the lesson page's can't-reach line (StudentChipUnreached, drawn first). A
 * read saying the session is over, or refusing it, has the account read again (`onGone`), so the
 * class leaves the card at once.
 */
function LiveCard({ live, onGone }: { live: InSession; onGone: () => void }) {
  const id = useId();
  const { id: sessionId, startedAt, endsAt } = live.liveSession;
  const now = useClock(endsAt);
  const lesson = useLesson(sessionId, onGone);
  const teacher = live.teacher.displayName?.trim();

  return (
    <section aria-labelledby={id} className={LIVE_CARD}>
      <LiveCardHead
        id={id}
        name={live.name}
        line={teacher ? `${teacher} · in class now` : 'In class now'}
        startedAt={startedAt}
        endsAt={endsAt}
        now={now}
      />
      <div className="flex flex-wrap items-center gap-2.5">
        <Link href={`/lessons/${live.id}/${sessionId}`} className={buttonClass('primary')}>
          Open the lesson
        </Link>
        <YourPhone chip={phoneChip(lesson, new Date(now))} asOf={lesson.asOf} className="ml-auto" />
      </div>
      {unreached(lesson) ? <CantReach /> : null}
    </section>
  );
}

/**
 * Classes not in session, with lessons on (StudentHome's `.schedrow`s): each name over its teacher's,
 * if named, the teacher's in the row's own 15/22 line, as the board renders its inline line.
 */
function ClassRows({ classes }: { classes: StudentClass[] }) {
  return (
    <ul className="flex flex-col gap-2.5">
      {classes.map((c) => {
        const teacher = c.teacher.displayName?.trim();
        return (
          <li
            key={c.id}
            className="rounded-md border border-border-default bg-surface-card px-4.5 py-3.75 text-body"
          >
            <span className="block text-tile-name wrap-anywhere">{c.name}</span>
            {teacher ? (
              <span className="text-countdown-sub text-text-tertiary wrap-anywhere">{teacher}</span>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}

/** What each home draws from: the account, its classes now, and the shell's reads. */
interface HomeProps {
  me: MeResponse;
  classes: ReturnType<typeof homeClasses>;
  failed: boolean;
  onRead: () => void;
  onRefresh: () => Promise<void>;
}

/**
 * A student's home with lessons on, as LO1 left it (W3; StudentHome, StudentHomeEmpty; ARCHITECTURE,
 * Web portal, decision 8: on, a page shows its lesson pieces as it did): its title over the line on
 * slides and questions; each class in session on a live card, then the rest, under "Other classes"
 * only beside a live card; with none yet, the empty card and a teacher's way to the invite page
 * (decision 13). `failed`: said as StudentStates draws it, Try again reading it again.
 */
function LessonsHome({ me, classes, failed, onRead, onRefresh }: HomeProps) {
  const others = useId();
  const none = useId();
  return (
    <div className="flex flex-col gap-5.5">
      <div>
        <h1 className="text-page-title">Your classes</h1>
        <p className="mt-0.5 text-meta text-text-secondary">
          Your teacher&apos;s slides and questions show up here during class.
        </p>
      </div>

      {failed ? (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-3">
          <TryAgain onRetry={onRefresh} then={[]}>
            <p role="alert" className="text-body">
              Bali couldn&apos;t load your classes.
            </p>
          </TryAgain>
        </div>
      ) : null}

      {me.classes.length === 0 ? (
        <>
          <section
            aria-labelledby={none}
            className="flex max-w-215 flex-col items-start gap-2.5 rounded-md border border-border-default bg-surface-card p-8 shadow-1"
          >
            <Ring share={0} box={46} stroke={5} />
            <h2 id={none} className="text-entry-title">
              You&apos;re not in a class yet
            </h2>
            <p className="max-w-144 text-body text-text-secondary">
              Join one in the Bali app on your iPhone, with the class code from your teacher.
            </p>
          </section>
          <p className="text-body text-text-secondary">
            Setting up a teacher account? <TextLink href="/invite">Enter your invite code</TextLink>
          </p>
        </>
      ) : (
        <div className="flex max-w-215 flex-col gap-5">
          {classes.inSession.map((live) => (
            <LiveCard key={live.liveSession.id} live={live} onGone={onRead} />
          ))}
          {classes.others.length === 0 ? null : classes.inSession.length === 0 ? (
            <ClassRows classes={classes.others} />
          ) : (
            <section aria-labelledby={others}>
              <h2 id={others} className="mb-3 text-section-label text-text-tertiary uppercase">
                Other classes
              </h2>
              <ClassRows classes={classes.others} />
            </section>
          )}
          <p className="text-caption text-text-tertiary">
            To join a class, use the Bali app on your iPhone.
          </p>
        </div>
      )}
    </div>
  );
}

/** A class's name, and its teacher's if named (StudentWeb's first two cells), each wrapping to fit. */
function ClassCells({ c }: { c: StudentClass }) {
  return (
    <>
      <td className={LEDGER_CELL}>
        <span className="font-semibold wrap-anywhere">{c.name}</span>
      </td>
      <td className={`${LEDGER_CELL} text-text-secondary wrap-anywhere`}>
        {c.teacher.displayName?.trim()}
      </td>
    </>
  );
}

/**
 * A class in session, with lessons off, its row in the live green (StudentWeb): In class now, its
 * ring the share of the session left on this computer's clock to the server's bell; then the
 * student's own phone, today's chip and words (StudentWebStates, drawn first), from the class's own
 * read of its session about every 2 s, as the lesson page reads it, never a one-time `/v1/me`
 * (decision 13), Checking… until a read answers. Whether those reads fail before one answers is told
 * to the page (`onUnreached`), which says so under the classes. A read saying the session is over,
 * or refusing it, has the account read again (`onGone`), so the class leaves its green at once.
 */
function LiveRow({
  live,
  onGone,
  onUnreached,
}: {
  live: InSession;
  onGone: () => void;
  onUnreached: (sessionId: string, failing: boolean) => void;
}) {
  const { id: sessionId, startedAt, endsAt } = live.liveSession;
  const now = useClock(endsAt);
  const lesson = useLesson(sessionId, onGone);
  const failing = unreached(lesson);

  useEffect(() => {
    onUnreached(sessionId, failing);
    return () => onUnreached(sessionId, false);
  }, [onUnreached, sessionId, failing]);

  return (
    <tr className={LEDGER_LIVE}>
      <ClassCells c={live} />
      <td className={`${LEDGER_CELL} text-right`}>
        <div className="inline-flex flex-wrap items-center justify-end gap-x-5 gap-y-2">
          <span className="inline-flex items-center gap-2 font-medium whitespace-nowrap text-state-focused-fg">
            <Ring share={shareLeft(startedAt, endsAt, now)} box={16} stroke={2.5} />
            In class now
          </span>
          <YourPhone
            chip={phoneChip(lesson, new Date(now))}
            asOf={lesson.asOf}
            className="justify-end"
          />
        </div>
      </td>
    </tr>
  );
}

/**
 * A student's home with lessons off (StudentWeb; its other moments on StudentWebStates, drawn first;
 * LO12b), 880 px at most: Your classes over a ledger, each class in session first in the live green
 * with In class now and the student's own phone, then the rest, each part in the account's order;
 * how to join a class under it. With none yet, StudentWeb's line and a teacher's way to the invite
 * page (decision 13). No lesson piece: the board draws none. `failed`: said under the title over what
 * was read before, on HomeStates' line, Try again reading it again, held until it answers, focus then
 * on the title.
 */
function LedgerHome({ me, classes, failed, onRead, onRefresh }: HomeProps) {
  const title = useId();
  // The sessions whose reads fail before one answers (StudentChipUnreached): said once, under them.
  const [unreachable, setUnreachable] = useState<ReadonlySet<string>>(() => new Set());
  const onUnreached = useCallback((sessionId: string, failing: boolean) => {
    setUnreachable((had) => {
      if (had.has(sessionId) === failing) return had;
      const next = new Set(had);
      if (failing) next.add(sessionId);
      else next.delete(sessionId);
      return next;
    });
  }, []);

  return (
    <div className="flex max-w-220 flex-col gap-4 text-body">
      <h1 id={title} className="text-page-title max-[760px]:text-page-title-phone">
        Your classes
      </h1>

      {failed ? (
        <div className={OOPS}>
          <TryAgain onRetry={onRefresh} then={[]}>
            <p role="alert" className="flex items-center gap-3">
              <CircleAlert size={18} aria-hidden="true" className="shrink-0" />
              Bali couldn&apos;t load your classes.
            </p>
          </TryAgain>
        </div>
      ) : null}

      {me.classes.length === 0 ? (
        <>
          <p className={WAIT_LINE}>
            Join one in the Bali app on your iPhone, with the class code from your teacher.
          </p>
          <p className="text-text-secondary">
            Setting up a teacher account?{' '}
            <Link href="/invite" className={QUIET}>
              Enter your invite code
            </Link>
          </p>
        </>
      ) : (
        <>
          <div className="overflow-x-auto">
            <table aria-labelledby={title} className={LEDGER}>
              <thead>
                <tr>
                  <th scope="col" className={LEDGER_HEAD}>
                    Class
                  </th>
                  <th scope="col" className={LEDGER_HEAD}>
                    Teacher
                  </th>
                  <th scope="col" className={`${LEDGER_HEAD} text-right`}>
                    <span className="sr-only">Now</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {classes.inSession.map((live) => (
                  <LiveRow
                    key={live.liveSession.id}
                    live={live}
                    onGone={onRead}
                    onUnreached={onUnreached}
                  />
                ))}
                {classes.others.map((c) => (
                  <tr key={c.id}>
                    <ClassCells c={c} />
                    <td className={LEDGER_CELL} />
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {classes.inSession.some((c) => unreachable.has(c.liveSession.id)) ? <CantReach /> : null}
          <p className="text-text-secondary">To join a class, use the Bali app on your iPhone.</p>
        </>
      )}
    </div>
  );
}

/**
 * A student's home (W3; ARCHITECTURE, Web portal, decision 8): with lessons off, StudentWeb's
 * (`LedgerHome`, LO12b); with lessons on, today's, as LO1 left it (`LessonsHome`), since a page
 * shows its lesson pieces as it did while they are on, and only a teacher's rebuilt page is spared
 * them. Both read alike: at its bell by this computer's clock a class leaves the classes in session
 * and the page reads the account again, so added minutes bring it back; it reads it again too as its
 * tab comes back into view, and as a class's read says it is over; and while no class is in
 * session, every 30 s it is in view (`onRefresh`, one read at a time; the owner, 2026-10-16), so one
 * that starts shows within about 30 s.
 */
export function StudentHome({
  me,
  failed,
  onRead,
  onRefresh,
}: {
  me: MeResponse;
  failed: boolean;
  onRead: () => void;
  onRefresh: () => Promise<void>;
}) {
  const [now, setNow] = useState(() => Date.now());
  const classes = homeClasses(me, now);
  const bell = nextBell(me, now);

  useEffect(() => {
    if (bell === null) return;
    const timer = window.setTimeout(() => {
      setNow(Math.max(Date.now(), bell));
      onRead();
    }, bell - Date.now());
    return () => window.clearTimeout(timer);
  }, [bell, onRead]);

  useEffect(() => {
    const back = () => {
      if (document.visibilityState === 'visible') onRead();
    };
    document.addEventListener('visibilitychange', back);
    return () => document.removeEventListener('visibilitychange', back);
  }, [onRead]);

  // In class, the bell and the classes' own reads take over from the 30 s read.
  const idle = classes.inSession.length === 0;
  useEffect(() => {
    if (!idle) return;
    const reread = rereadEvery(onRefresh);
    return () => reread.stop();
  }, [idle, onRefresh]);

  const Home = lessonsOn() ? LessonsHome : LedgerHome;
  return <Home me={me} classes={classes} failed={failed} onRead={onRead} onRefresh={onRefresh} />;
}
