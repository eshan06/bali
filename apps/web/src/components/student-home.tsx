'use client';

import type { MeResponse } from '@bali/shared';
import { useEffect, useId, useState } from 'react';

import { bellTime } from '@/lib/session-controls';
import { homeClasses, type InSession, nextBell, type StudentClass } from '@/lib/student-web';

import { Button } from './button';
import { Ring, shareLeft, timeLeft, useClock } from './live-header';
import { TextLink } from './text-link';

/**
 * A class in session (StudentHome's live card): the ring, the share of the session left; the name
 * over its teacher and "in class now", right under it as the board renders it; the time left on
 * this computer's clock to the server's bell, the bell under it. Its last row, Open the lesson and
 * the phone's chip, is W4's, with the lesson page and its read.
 */
function LiveCard({ live }: { live: InSession }) {
  const id = useId();
  const { startedAt, endsAt } = live.liveSession;
  const now = useClock(endsAt);
  const teacher = live.teacher.displayName?.trim();
  return (
    <section
      aria-labelledby={id}
      className="flex items-center gap-3.5 rounded-live border border-live-edge bg-surface-card p-5.5 shadow-1"
    >
      <Ring share={shareLeft(startedAt, endsAt, now)} box={46} stroke={5} />
      <div className="min-w-0 flex-1">
        <h2 id={id} className="text-h3 wrap-anywhere">
          {live.name}
        </h2>
        <p className="text-countdown-sub text-text-secondary">
          {teacher ? `${teacher} · in class now` : 'In class now'}
        </p>
      </div>
      <p className="flex shrink-0 flex-col text-right">
        <span className="font-num text-home-countdown tabular-nums">
          {timeLeft(Date.parse(endsAt) - now)}
        </span>
        <span className="text-cell-sub text-text-secondary">
          ends <time dateTime={endsAt}>{bellTime(endsAt)}</time>
        </span>
      </p>
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
              <span className="text-countdown-sub text-text-tertiary">{teacher}</span>
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
 * StudentStates draws it, Try again reading it again (`onRead`). At its bell by this computer's
 * clock a class leaves its card and the page reads the account again: added minutes bring it back.
 */
export function StudentHome({
  me,
  failed,
  onRead,
}: {
  me: MeResponse;
  failed: boolean;
  onRead: () => void;
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
          <p role="alert" className="text-body">
            Bali couldn&apos;t load your classes.
          </p>
          <Button variant="secondary" size="sm" onClick={() => onRead()}>
            Try again
          </Button>
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
            <LiveCard key={live.id} live={live} />
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
