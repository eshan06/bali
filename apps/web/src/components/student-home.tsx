'use client';

import type { MeResponse } from '@bali/shared';
import { CircleAlert } from 'lucide-react';
import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';

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

import { QUIET } from './button';
import { LEDGER, LEDGER_CELL, LEDGER_HEAD, LEDGER_LIVE } from './card';
import { OOPS, WAIT_LINE } from './classes';
import { Ring, shareLeft, useClock } from './live-header';
import { TryAgain } from './try-again';
import { CantReach, YourPhone } from './your-phone';

const UNREAD: LessonState = { presentation: null, problem: null, asOf: null };

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
 * A class in session, its row in the live green (StudentWeb): In class now, its ring the share of the
 * session left on this computer's clock to the server's bell; then the student's own phone, today's
 * chip and words (StudentWebStates, drawn first), from the class's own read of its session about
 * every 2 s, as the lesson page reads it, never a one-time `/v1/me` (decision 13: never greener than
 * the teacher's grid), Checking… until a read answers. Whether those reads fail before one answers
 * is told to the page (`onUnreached`), which says so under the classes. A read saying the session is
 * over, or refusing it, has the account read again (`onGone`), so the class leaves its green at once.
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
  const api = useApi();
  const { id: sessionId, startedAt, endsAt } = live.liveSession;
  const now = useClock(endsAt);
  const [lesson, setLesson] = useState(UNREAD);
  const failing = unreached(lesson);

  useEffect(() => {
    const followed = followLesson(api, sessionId, (state) => {
      setLesson(state);
      if (!lessonGone(state)) return;
      followed.stop();
      onGone();
    });
    return () => followed.stop();
  }, [api, sessionId, onGone]);

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
 * A student's home (StudentWeb; its other moments on StudentWebStates, drawn first; LO12b), in the
 * shell's frame, 880 px at most: Your classes over a ledger, each class in session first in the
 * live green with In class now and the student's own phone, then the rest, each part in the
 * account's order; how to join a class under it. With none yet, StudentWeb's line and a teacher's
 * way to the invite page (decision 13). No lesson piece whichever way the lessons switch is set: the
 * board draws none (ARCHITECTURE, Web portal, decision 8). `failed`: the account's last read failed,
 * said under the title over what was read before, Try again reading it again (`onRefresh`), held
 * until it answers, focus then on the title. At its bell by this computer's clock a class leaves the
 * green and the page reads the account again: added minutes bring it back. It reads it again too as
 * its tab comes back into view, and as a class's read says it is over; and while no class is in
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
  // The sessions whose reads fail before one answers (StudentChipUnreached): said once, under them.
  const [unreachable, setUnreachable] = useState<ReadonlySet<string>>(() => new Set());
  const classes = homeClasses(me, now);
  const bell = nextBell(me, now);

  const onUnreached = useCallback((sessionId: string, failing: boolean) => {
    setUnreachable((had) => {
      if (had.has(sessionId) === failing) return had;
      const next = new Set(had);
      if (failing) next.add(sessionId);
      else next.delete(sessionId);
      return next;
    });
  }, []);

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

  return (
    <div className="flex max-w-220 flex-col gap-4 text-body">
      <h1 className="text-page-title max-[760px]:text-page-title-phone">Your classes</h1>

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
            <table className={LEDGER}>
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
