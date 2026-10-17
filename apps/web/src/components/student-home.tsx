'use client';

import type { MeResponse } from '@bali/shared';
import Link from 'next/link';
import { useEffect, useId, useState } from 'react';

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

import { buttonClass } from './button';
import { LIVE_CARD, LiveCardHead, Ring, useClock } from './live-header';
import { TextLink } from './text-link';
import { TryAgain } from './try-again';
import { CantReach, YourPhone } from './your-phone';

const UNREAD: LessonState = { presentation: null, problem: null, asOf: null };

/**
 * A class in session (StudentHome's live card): the ring, the share of the session left; the name
 * over its teacher and "in class now", right under it as the board renders it; the time left on
 * this computer's clock to the server's bell, the bell under it; then Open the lesson, to its page
 * (W4), and the student's own phone, from the lesson's own read, as the lesson page reads it, never
 * a one-time `/v1/me` (decision 13: never greener than the teacher's grid), its states as
 * StudentChipStates draws them (drawn first); while its reads fail before one answers, Checking…
 * over the lesson page's can't-reach line (StudentChipUnreached, drawn first). A read saying the
 * session is over, or refusing it, has the account read again (`onGone`), so the class leaves the
 * card at once.
 */
function LiveCard({ live, onGone }: { live: InSession; onGone: () => void }) {
  const api = useApi();
  const id = useId();
  const { id: sessionId, startedAt, endsAt } = live.liveSession;
  const now = useClock(endsAt);
  const [lesson, setLesson] = useState(UNREAD);
  const teacher = live.teacher.displayName?.trim();

  useEffect(() => {
    const followed = followLesson(api, sessionId, (state) => {
      setLesson(state);
      if (!lessonGone(state)) return;
      followed.stop();
      onGone();
    });
    return () => followed.stop();
  }, [api, sessionId, onGone]);

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
 * Classes not in session (StudentHome's `.schedrow`s): each name over its teacher's, if named, the
 * teacher's in the row's own 15/22 line, as the board renders its inline line.
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

/**
 * A student's home (W3; StudentHome, StudentHomeEmpty): each class in session on a live card, then
 * the rest, under "Other classes" only beside a live card; with none yet, the empty card and a
 * teacher's way to the invite page (decision 13). `failed`: the account's last read failed, said as
 * StudentStates draws it, Try again reading it again (`onRefresh`). At its bell by this computer's
 * clock a class leaves its card and the page reads the account again: added minutes bring it back.
 * It reads it again too as its tab comes back into view, so a class that started while it was away
 * shows with its way into the lesson (W4), and as a live card's lesson says it is over; and while
 * no class is in session, every 30 s it is in view (`onRefresh`, one read at a time; the owner,
 * 2026-10-16), so one that starts shows with Open the lesson within about 30 s.
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
  const others = useId();
  const none = useId();
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

  // In class, the bell and the lesson's reads take over from the 30 s read.
  const idle = classes.inSession.length === 0;
  useEffect(() => {
    if (!idle) return;
    const reread = rereadEvery(onRefresh);
    return () => reread.stop();
  }, [idle, onRefresh]);

  return (
    <main className="flex flex-col gap-5.5">
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
    </main>
  );
}
