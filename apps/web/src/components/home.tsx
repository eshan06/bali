'use client';

import type { MeResponse, SessionSnapshot } from '@bali/shared';
import { CircleAlert, CircleCheck, Plus, Presentation } from 'lucide-react';
import Link from 'next/link';
import { type Ref, useCallback, useEffect, useId, useRef, useState } from 'react';

import { type LastSession, lastOf, liveNow, type TaughtClass } from '@/lib/classes';
import { CANT_REACH } from '@/lib/errors';
import {
  gridDisplay,
  type GridDisplay,
  silentNote,
  type Student,
  type Students,
} from '@/lib/grid-state';
import { type RecapFormat, recapGroups } from '@/lib/recap';
import { readSessionPage, type SessionPage } from '@/lib/reports';
import { bellTime, laterBell } from '@/lib/session-controls';
import { useApi } from '@/lib/use-api';

import { Blocks } from './blocks';
import { LockButton, lockButton, NAME_BUTTON } from './button';
import { LIVE_WELL, WELL } from './card';
import { FirstClass, OOPS, sessionRan, YourClasses } from './classes';
import { CHIP, type GridNow, LiveGrid, LockChip, StaleWords, stateCounts } from './live-grid';
import { Ring, shareLeft, timeLeft, useClock } from './live-header';
import { NewClass, type NewClassHandle } from './new-class';
import { TryAgain } from './try-again';

/** Where a live class's Present goes (Main to Present): the class's page, Present on. */
export const presentHref = (classId: string) => `/classes/${classId}?present`;

/**
 * Where a name in Check on goes (Main to ClassStudent): the class's page, the student named, for the
 * class page to open their record (LO6's); until it does, the class's page.
 */
export const studentHref = (classId: string, studentId: string) =>
  `/classes/${classId}?student=${encodeURIComponent(studentId)}`;

/** The head's date (Main, HomeIdle): "Monday, October 12", by this computer's clock. */
export function dayOf(now: number, { locale, timeZone }: RecapFormat = {}): string {
  return new Intl.DateTimeFormat(locale, {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    timeZone,
  }).format(now);
}

/** The next time the date turns by this computer's clock: midnight. */
export function nextTurn(now: number): number {
  const at = new Date(now);
  return new Date(at.getFullYear(), at.getMonth(), at.getDate() + 1).getTime();
}

/**
 * Check on's rows in order: the unlocks first, then protection off, Silent, Not here, Left, Unknown.
 * The boards draw Unlocked, Silent and Not here; the rest are HomeMoments', the owner's approval of
 * 2026-11-17 (DECISIONS).
 */
const CHECK_ORDER: readonly GridDisplay[] = [
  'unlocked',
  'left_unprotected',
  'protection_off',
  'left_protection_off',
  'silent',
  'absent',
  'ended',
  'unknown',
];

/** A row of Check on: a state in its tile's words ("Silent · 5 min"), and who is in it. */
export interface CheckRow {
  display: GridDisplay;
  words: string;
  students: Student[];
}

/**
 * Who to check on (Main; LiveStates, HomeMoments): everyone the grid shows who isn't focused, the
 * count the board draws (28 − 24 = 4), a row per state in its tile's words, Silent's with its minutes
 * so two silent for different times get a row each; in `CHECK_ORDER`, each row's students in the
 * grid's order.
 */
export function checkOn(students: Students, now: Date): CheckRow[] {
  const rows = new Map<string, CheckRow>();
  for (const s of Object.values(students)) {
    const display = gridDisplay(s, now);
    if (display === 'focused') continue;
    const { label } = CHIP[display];
    const words = display === 'silent' ? `${label} · ${silentNote(s, now)}` : label;
    const row = rows.get(words) ?? { display, words, students: [] };
    row.students.push(s);
    rows.set(words, row);
  }
  return [...rows.values()].sort(
    (a, b) => CHECK_ORDER.indexOf(a.display) - CHECK_ORDER.indexOf(b.display),
  );
}

/**
 * Check on (Main; LiveStates, HomeMoments): "Check on 4" over its rows, each the state's chip and
 * who is in it, each name a link to them on the class's page; while the live feed is down, the rows
 * faded and the names plain, as they were at the last update. Everyone focused says so in one line;
 * a class with no students yet says that. A row keeps its key as Silent's minutes turn, so a name
 * focused in it keeps focus.
 */
function CheckOn({
  classId,
  rows,
  total,
  stale,
}: {
  classId: string;
  rows: CheckRow[];
  total: number;
  stale: boolean;
}) {
  if (total === 0) return <p className="text-text-secondary">No students yet.</p>;
  const count = rows.reduce((n, row) => n + row.students.length, 0);
  if (count === 0) {
    return (
      <p className="flex items-center gap-3 self-start border-y border-border-default py-4 font-medium text-state-focused-fg">
        <CircleCheck size={18} aria-hidden="true" className="shrink-0" />
        Everyone&apos;s focused.
      </p>
    );
  }
  return (
    <div className={stale ? 'opacity-60' : undefined}>
      <h3 className="mb-2 text-data font-semibold">Check on {count}</h3>
      <ul className="border-t border-live-edge">
        {rows.map((row) => (
          <li
            key={row.display === 'silent' ? `silent:${row.students[0]?.studentId}` : row.display}
            className="grid grid-cols-[150px_minmax(0,1fr)] items-center gap-4 border-b border-live-edge py-3 max-[760px]:grid-cols-[140px_minmax(0,1fr)] max-[760px]:gap-x-3 max-[760px]:gap-y-2"
          >
            <span>
              <LockChip display={row.display} words={row.words} />
            </span>
            <p className="flex min-w-0 flex-wrap items-baseline gap-x-3 gap-y-1">
              {row.students.map((s) => {
                const name = s.displayName ?? s.studentId.slice(0, 8);
                return stale ? (
                  <span key={s.studentId} className="font-semibold wrap-anywhere">
                    {name}
                  </span>
                ) : (
                  <Link
                    key={s.studentId}
                    href={studentHref(classId, s.studentId)}
                    className={`${NAME_BUTTON} wrap-anywhere`}
                  >
                    {name}
                  </Link>
                );
              })}
            </p>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** The live feed's health over the count (lock.css's `.status`; HomeMoments): a white pill, its dot still. */
const STATUS =
  'inline-flex items-center gap-2 self-start rounded-full border border-border-strong bg-surface-card py-2 pr-4 pl-3 text-meta text-text-primary shadow-2';

/**
 * A class live on Home (Main; HomeMoments), drawn from the class page's own grid as it stands
 * (`GridNow`): the ring, the class's name over "Live until 9:55 AM", the time left on this
 * computer's clock to the server's bell; the class counted, "24 of 28 focused"; Open the class and
 * Present; and who to check on (`CheckOn`). Until the session is read, its line in the count's place;
 * its read failed, the reason with Try again, held until the grid's read again answers, focus then on
 * its name; the live feed lost or quiet, the class page's own words over the count, the count and
 * Check on faded. Its links are described by the class's name, so two wells' links differ.
 */
export function LiveWellView({
  classId,
  name,
  grid,
  startedAt,
  endsAt,
}: {
  classId: string;
  name: string;
  grid: GridNow;
  /** The session's start, once a snapshot gives it: the ring's whole. */
  startedAt: string | null;
  endsAt: string;
}) {
  const id = useId();
  const now = useClock(endsAt);
  const students = grid.error === null ? grid.students : null;
  const counts =
    students === null
      ? null
      : stateCounts(Object.values(students).map((s) => gridDisplay(s, grid.now)));
  const faded = grid.stale === null ? '' : 'opacity-60';
  return (
    <section
      aria-labelledby={id}
      className={`${LIVE_WELL} grid grid-cols-[minmax(0,1fr)_minmax(0,1.25fr)] gap-x-12 gap-y-6 p-6 max-[760px]:grid-cols-1 max-[760px]:gap-8 max-[760px]:p-5`}
    >
      <div className="col-span-full flex flex-wrap items-center gap-x-4 gap-y-3">
        <Ring
          share={startedAt === null ? 0 : shareLeft(startedAt, endsAt, now)}
          box={44}
          stroke={5}
        />
        <div className="flex min-w-0 flex-[1_1_240px] flex-col gap-0.5">
          <h2 id={id} className="text-section-title wrap-anywhere">
            {name}
          </h2>
          <p className="text-meta text-text-secondary">
            Live until <time dateTime={endsAt}>{bellTime(endsAt)}</time>
          </p>
        </div>
        <p className="flex flex-col items-end max-[760px]:items-start">
          <span className="text-home-countdown tabular-nums">
            {timeLeft(Date.parse(endsAt) - now)}
          </span>
          <span className="text-countdown-sub text-text-tertiary">left</span>
        </p>
      </div>
      <div className="flex flex-col justify-between gap-6">
        {grid.error !== null ? (
          <div className="flex flex-wrap items-center gap-x-4 gap-y-3">
            <TryAgain onRetry={grid.retry} held={grid.retrying} then={[id]}>
              <p role="alert">Couldn&apos;t load this session. {grid.error}</p>
            </TryAgain>
          </div>
        ) : counts === null ? (
          <p role="status" className="text-text-secondary">
            Loading this session…
          </p>
        ) : (
          <div className="flex flex-col gap-4">
            {grid.stale ? (
              <p role="status" className={`${STATUS} tabular-nums`}>
                <span aria-hidden="true" className="size-1.75 shrink-0 rounded-full bg-pip" />
                <StaleWords stale={grid.stale} />
              </p>
            ) : null}
            <p className={`flex flex-wrap items-baseline gap-x-3 ${faded}`}>
              <span className="text-count tabular-nums max-[760px]:text-count-phone">
                {counts.counts.focused}
              </span>
              <span className="text-count-of text-text-secondary max-[760px]:text-count-of-phone">
                of {counts.total} focused
              </span>
            </p>
          </div>
        )}
        <div className="flex flex-wrap items-center gap-2">
          <Link
            href={`/classes/${classId}`}
            aria-describedby={id}
            className={lockButton('primary')}
          >
            Open the class
          </Link>
          <Link
            href={presentHref(classId)}
            aria-describedby={id}
            className={lockButton('secondary')}
          >
            <Presentation size={16} aria-hidden="true" />
            Present
          </Link>
        </div>
      </div>
      {students !== null && counts !== null ? (
        <CheckOn
          classId={classId}
          rows={checkOn(students, grid.now)}
          total={counts.total}
          stale={grid.stale !== null}
        />
      ) : null}
    </section>
  );
}

/**
 * A class live on Home (Main): the class page's own grid (`LiveGrid`: its snapshot, its live feed
 * and its 15 s read), drawn as Main's well (`LiveWellView`). Its start comes with the snapshot, for
 * the ring, and is told to Home (`onStart`) for the class's row; a later bell (time added on the
 * class page) has the classes read again (`onRead`), so the row and the well keep to it. The server
 * ending the session (End, or the bell's sweep) is told to Home (`onEnded`).
 */
function LiveWell({
  c,
  session,
  onEnded,
  onRead,
  onStart,
}: {
  c: TaughtClass;
  session: { id: string; endsAt: string };
  onEnded: (sessionId: string) => void;
  onRead: () => void;
  onStart: (sessionId: string, startedAt: string) => void;
}) {
  const [read, setRead] = useState<{ startedAt: string; endsAt: string } | null>(null);
  const bell = session.endsAt;
  const onSession = useCallback(
    ({ startedAt, endsAt }: SessionSnapshot['session']) => {
      setRead({ startedAt, endsAt });
      onStart(session.id, startedAt);
      if (Date.parse(endsAt) > Date.parse(bell)) onRead();
    },
    [bell, onRead, onStart, session.id],
  );
  const endsAt = laterBell(read?.endsAt ?? null, bell);
  return (
    <LiveGrid
      sessionId={session.id}
      onEnded={onEnded}
      onSession={onSession}
      card={(grid) => (
        <LiveWellView
          classId={c.id}
          name={c.name}
          grid={grid}
          startedAt={read?.startedAt ?? null}
          endsAt={endsAt}
        />
      )}
    />
  );
}

/**
 * Last session's figures (HomeIdle), as the recap counts them (`recapGroups`), so the two never
 * disagree: of those who joined, how many stayed focused the whole time; the emergency unlocks; and
 * who didn't join. Nobody joined, the recap's line in their place, the unlocks kept if it had any
 * (HomeMoments).
 */
function LastFigures({ page }: { page: Extract<SessionPage, { kind: 'ready' }> }) {
  const { report } = page;
  const { wholeTime, notJoined } = recapGroups(page.session, report, page.events, page.roster);
  const n = new Intl.NumberFormat();
  const joined = report.joined.length;
  const unlocks = report.unlocks.length;
  const unlocked: [string, string] = [
    n.format(unlocks),
    unlocks === 1 ? 'emergency unlock' : 'emergency unlocks',
  ];
  const figures: [string, string][] =
    joined > 0
      ? [
          [`${n.format(wholeTime.length)} of ${n.format(joined)}`, 'stayed focused the whole time'],
          unlocked,
          [n.format(notJoined.length), "didn't join"],
        ]
      : unlocks > 0
        ? [unlocked]
        : [];
  return (
    <>
      {joined === 0 ? <p className="text-text-secondary">Nobody joined this session.</p> : null}
      {figures.length > 0 ? (
        <dl className="flex flex-wrap gap-y-4">
          {figures.map(([value, words]) => (
            <div
              key={words}
              className="flex flex-col gap-0.5 border-l border-border-strong px-6 first:border-l-0 first:pl-0 max-[760px]:px-4 max-[760px]:first:pl-0"
            >
              <dt className="order-2 text-caption text-text-secondary">{words}</dt>
              <dd className="order-1 text-h2 tabular-nums">{value}</dd>
            </div>
          ))}
        </dl>
      ) : null}
    </>
  );
}

/**
 * Last session (HomeIdle; HomeMoments), while no class runs: the last session over, its class and
 * when it ran from the account (PV2's `lastSession`), then its figures (`LastFigures`) from its
 * report, its events and the class's roster, the recap's own reads (`readSessionPage`). Open the
 * recap goes to the class's page once they are in. Being read, a line in their place; failed, the
 * reason with Try again, held until its read answers, focus then on its title.
 */
export function LastSessionView({
  last,
  read,
  now,
  onRetry,
}: {
  last: LastSession;
  read: SessionPage;
  now: number;
  /** Read it again, the failure said until it answers. */
  onRetry: () => Promise<void>;
}) {
  const id = useId();
  const name = useId();
  return (
    <section
      aria-labelledby={id}
      className={`${WELL} flex flex-wrap items-end justify-between gap-x-12 gap-y-6 p-6`}
    >
      <div className="flex min-w-0 flex-col gap-5">
        <div>
          <h2 id={id} className="text-section-title">
            Last session
          </h2>
          <p className="flex flex-wrap items-baseline gap-x-5 gap-y-1 text-meta text-text-secondary">
            <span id={name} className="font-semibold text-text-primary wrap-anywhere">
              {last.name}
            </span>
            <span>{sessionRan(last.session, new Date(now))}</span>
          </p>
        </div>
        {read.kind === 'loading' ? (
          <p role="status" className="text-text-secondary">
            Loading the last session…
          </p>
        ) : read.kind === 'error' ? (
          <div className="flex flex-wrap items-center gap-x-4 gap-y-3">
            <TryAgain onRetry={onRetry} then={[id]}>
              <p role="alert">Couldn&apos;t load the last session. {read.message}</p>
            </TryAgain>
          </div>
        ) : (
          <LastFigures page={read} />
        )}
      </div>
      {read.kind === 'ready' ? (
        <Link
          href={`/classes/${last.classId}`}
          aria-describedby={name}
          className={lockButton('secondary')}
        >
          Open the recap
        </Link>
      ) : null}
    </section>
  );
}

/** Last session, its reads made as Home shows it and again by Try again (`readSessionPage`). */
function LastSessionWell({ last, now }: { last: LastSession; now: number }) {
  const api = useApi();
  const [read, setRead] = useState<SessionPage>({ kind: 'loading' });
  const { classId } = last;
  const sessionId = last.session.id;
  useEffect(() => {
    let live = true;
    void readSessionPage(api, classId, sessionId).then((answer) => {
      if (live) setRead(answer);
    });
    return () => {
      live = false;
    };
  }, [api, classId, sessionId]);
  return (
    <LastSessionView
      last={last}
      read={read}
      now={now}
      onRetry={async () => setRead(await readSessionPage(api, classId, sessionId))}
    />
  );
}

/**
 * A teacher's Home, one page for their classes (Main, HomeIdle, HomeStates, PhonePages; its other
 * moments on HomeMoments, drawn first): its head, Classes and the date, with New class; a later read
 * of the account that failed, said under it with Try again over what was read before; each class live
 * by this computer's clock to the server's bell in a well of its own, in the account's order; while
 * none runs, the last session over, once one has ended; then Your classes, or a new teacher's first
 * class, beside Your block, under it on a phone. New class and Create a class open New class's
 * dialog, and its every answer has the account read again (`onRead`). A session the server ends while
 * Home is open loses its well at once and the account is read again; Last session shows once that
 * read says none runs, so it never shows an older session meanwhile. `ref` is the heading's, for
 * focus after a redeem. The failure's Try again reads with `onRetry` (the shell's `refresh`), held
 * until it answers, focus then on Your classes or, with none, the heading.
 */
export function TeacherHome({
  ref,
  me,
  failed,
  now,
  onRead,
  onRetry,
}: {
  ref?: Ref<HTMLHeadingElement>;
  me: MeResponse;
  /** The account's last read failed, in `errText`'s words; null once one works. */
  failed: string | null;
  now: number;
  onRead: () => void;
  /** The failure's Try again: the account read again, its failure kept until the answer. */
  onRetry: () => Promise<void>;
}) {
  const yours = useId();
  const newClass = useRef<NewClassHandle>(null);
  // The sessions the server ended while Home was open: their wells go before the read answers.
  const [ended, setEnded] = useState<ReadonlySet<string>>(() => new Set());
  // Each running session's start, as its well reads it, for its class's row.
  const [starts, setStarts] = useState<ReadonlyMap<string, string>>(() => new Map());
  const onEnded = useCallback(
    (session: string) => {
      setEnded((cur) => new Set(cur).add(session));
      onRead();
    },
    [onRead],
  );
  const onStart = useCallback(
    (session: string, startedAt: string) =>
      setStarts((had) =>
        had.get(session) === startedAt ? had : new Map(had).set(session, startedAt),
      ),
    [],
  );
  const live = me.classes.flatMap((c) => {
    const session = liveNow(c, now);
    return session && !ended.has(session.id) ? [{ c, session }] : [];
  });
  // Past a bell, or past an End elsewhere, the read still counts the session running until it is
  // read again; until then there is no Last session to show, never an older one.
  const running = me.classes.some((c) => (c.summary?.runningSession ?? null) !== null);
  const last = running ? null : lastOf(me.classes);
  const onNew = () => newClass.current?.open();
  return (
    <div className="flex flex-col gap-10 text-body max-[760px]:gap-8">
      <div className="flex flex-wrap items-center gap-x-6 gap-y-4">
        <div className="flex min-w-0 flex-[1_1_320px] flex-col gap-1">
          <h1 ref={ref} tabIndex={-1} className="text-page-title">
            Classes
          </h1>
          <p className="text-meta text-text-secondary">{dayOf(now)}</p>
        </div>
        <LockButton variant="secondary" aria-haspopup="dialog" onClick={onNew}>
          <Plus size={16} aria-hidden="true" />
          New class
        </LockButton>
      </div>
      {failed !== null ? (
        <div className={OOPS}>
          <TryAgain onRetry={onRetry} then={[yours]}>
            <p role="alert" className="flex items-center gap-3">
              <CircleAlert size={18} aria-hidden="true" className="shrink-0" />
              {/* HomeStates' line where Bali couldn't be reached; any other failure named as
                  what didn't load, today's words, so a reason written for a log never stands alone. */}
              {failed === CANT_REACH ? failed : `Couldn't load your classes. ${failed}`}
            </p>
          </TryAgain>
        </div>
      ) : null}
      {live.map(({ c, session }) => (
        <LiveWell
          key={session.id}
          c={c}
          session={session}
          onEnded={onEnded}
          onRead={onRead}
          onStart={onStart}
        />
      ))}
      {last !== null ? <LastSessionWell key={last.session.id} last={last} now={now} /> : null}
      <div className="grid grid-cols-[minmax(0,1fr)_340px] items-start gap-12 max-[760px]:grid-cols-1 max-[760px]:gap-8">
        {me.classes.length === 0 ? (
          <FirstClass onNew={onNew} />
        ) : (
          <YourClasses id={yours} classes={me.classes} now={now} starts={starts} ended={ended} />
        )}
        <Blocks />
      </div>
      <NewClass ref={newClass} onAnswer={onRead} />
    </div>
  );
}
