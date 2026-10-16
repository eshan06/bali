'use client';

import {
  type ActivityEvent,
  type ActivityEventType,
  isUnlockReason,
  type MeResponse,
  type SessionSnapshot,
} from '@bali/shared';
import {
  CircleCheck,
  Clock,
  LockOpen,
  type LucideIcon,
  Presentation,
  ScrollText,
  ShieldOff,
} from 'lucide-react';
import Link from 'next/link';
import { type Ref, useCallback, useEffect, useId, useState, useSyncExternalStore } from 'react';

import { type ActivityRead, pollActivity } from '@/lib/activity';
import { type LastSession, lastOf, liveNow, type TaughtClass } from '@/lib/classes';
import { gridDisplay, latestUnlock, staleWords } from '@/lib/grid-state';
import { bareTime, classFigures, nameOf, type RecapFormat, sessionTimes } from '@/lib/recap';
import { readReport, type ReportRead } from '@/lib/reports';
import { bellTime, laterBell } from '@/lib/session-controls';
import { useApi } from '@/lib/use-api';

import { Blocks } from './blocks';
import { Button, buttonClass } from './button';
import { CARD_ALONE } from './card';
import { classLine, FirstClass, LiveChip } from './classes';
import { DOT, type GridNow, LiveGrid, stateCounts } from './live-grid';
import { joinedLine, LIVE_CARD, LiveCardHead, LiveCounts, useClock } from './live-header';
import { Figures } from './recap-card';
import { QUIET_LINK } from './text-link';
import { Timeline, type TimelineMoment } from './timeline';
import { reasonWords } from './unlock-popups';
import { NOTICE } from './your-phone';

/** Where Home's Create a class goes: Classes, its New class open (HomeNew to ClassesNew). */
export const NEW_CLASS = '/classes?new';

/** Where a live card's Present goes (Main to ClassPresent): the class's page, Present on. */
export const presentHref = (classId: string) => `/classes/${classId}?present`;

/**
 * Main's live card, drawn from the grid as it stands (`GridNow`): its head (the ring, the name over
 * "Live · 25 of 28 joined", the countdown and the bell), the six counts, then Open the class, Present
 * (never on a phone, which drives no projector; PhoneHome) and the latest unlock on the grid, its
 * student and when (`latestUnlock`), none while no chip carries one; the live feed lost, the class
 * page's own line under the counts (HomeLiveStates, drawn first). Until the session is read, its
 * name and "Loading this session…"; its read failed, "Couldn't load this session." with Try again
 * (HomeMoreStates). Its links are described by the class's name, so a list of links tells two
 * cards apart.
 */
export function LiveCardView({
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
  if (grid.error !== null || grid.students === null) {
    return (
      <section aria-labelledby={id} className={LIVE_CARD}>
        <LiveCardHead id={id} name={name} now={now} />
        {grid.error === null ? (
          <p role="status" className="text-body text-text-secondary">
            Loading this session…
          </p>
        ) : (
          <div>
            <div role="alert" className="text-body">
              <p className="font-semibold">Couldn&apos;t load this session.</p>
              <p className="text-text-secondary">{grid.error}</p>
            </div>
            <Button variant="secondary" size="sm" onClick={grid.retry} className="mt-3.5">
              Try again
            </Button>
          </div>
        )}
      </section>
    );
  }
  const shown = grid.students;
  const counts = stateCounts(Object.values(shown).map((s) => gridDisplay(s, grid.now)));
  const latest = latestUnlock(shown);
  const at = latest?.unlock?.at.toISOString() ?? null;
  return (
    <section aria-labelledby={id} className={LIVE_CARD}>
      <LiveCardHead
        id={id}
        name={name}
        line={joinedLine(counts)}
        startedAt={startedAt}
        endsAt={endsAt}
        now={now}
      />
      <LiveCounts counts={counts} />
      {grid.stale ? <p className={`${NOTICE} tabular-nums`}>{staleWords(grid.stale)}</p> : null}
      <div className="flex flex-wrap items-center gap-2.5">
        <Link href={`/classes/${classId}`} aria-describedby={id} className={buttonClass('primary')}>
          Open the class
        </Link>
        <Link
          href={presentHref(classId)}
          aria-describedby={id}
          className={buttonClass('secondary', 'max-sm:hidden')}
        >
          <Presentation size={16} aria-hidden="true" />
          Present
        </Link>
        {latest !== null && at !== null ? (
          <p className="ml-auto text-countdown-sub text-text-tertiary wrap-anywhere max-sm:ml-0">
            {latest.displayName ?? latest.studentId.slice(0, 8)} used Emergency Unlock at{' '}
            <time dateTime={at}>{bellTime(at)}</time>
          </p>
        ) : null}
      </div>
    </section>
  );
}

/**
 * A class live on Home (PV17b; Main): the class page's own grid (`LiveGrid`: its snapshot, its live
 * feed and its 15 s read), drawn as Main's card (`LiveCardView`). Its start comes with the
 * snapshot, for the ring, and so does a later bell (time added on the class page), which has your
 * classes read again (`onRead`), so the row, the date's line and the card keep to it. The server
 * ending the session (End, or the bell's sweep) is told to Home (`onEnded`).
 */
function LiveCard({
  c,
  session,
  onEnded,
  onRead,
}: {
  c: TaughtClass;
  session: { id: string; endsAt: string };
  onEnded: (sessionId: string) => void;
  onRead: () => void;
}) {
  const [read, setRead] = useState<{ startedAt: string; endsAt: string } | null>(null);
  const bell = session.endsAt;
  const onSession = useCallback(
    ({ startedAt, endsAt }: SessionSnapshot['session']) => {
      setRead({ startedAt, endsAt });
      if (Date.parse(endsAt) > Date.parse(bell)) onRead();
    },
    [bell, onRead],
  );
  const endsAt = laterBell(read?.endsAt ?? null, bell);
  return (
    <LiveGrid
      sessionId={session.id}
      onEnded={onEnded}
      onSession={onSession}
      card={(grid) => (
        <LiveCardView
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
 * The greeting (Main, HomeIdle, HomeNew): Good morning until noon, Good afternoon until 5 PM, then
 * Good evening (HomeInterimStates, drawn first), by this computer's clock, with the account's name,
 * or none for an account with no name (HomeNoName).
 */
export function greeting(now: number, name: string | null, { timeZone }: RecapFormat = {}): string {
  const hour = Number(
    new Intl.DateTimeFormat('en-US', { hour: 'numeric', hourCycle: 'h23', timeZone }).format(now),
  );
  const part = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
  return name ? `${part}, ${name}` : part;
}

/** The next time the greeting or the date turns by this computer's clock: noon, 5 PM or midnight. */
export function nextTurn(now: number): number {
  const at = new Date(now);
  const day = (hour: number) =>
    new Date(at.getFullYear(), at.getMonth(), at.getDate(), hour).getTime();
  return [day(12), day(17)].find((turn) => turn > now) ?? day(24);
}

/**
 * The line under the greeting: today's date, then, for a teacher with a class, what is in session
 * by this computer's clock to the server's bell: none, the one live and its bell (Main), or how many
 * (HomeInterimStates, drawn first).
 */
export function dayLine(classes: TaughtClass[], now: number, format: RecapFormat = {}): string {
  const { locale, timeZone } = format;
  const day = new Intl.DateTimeFormat(locale, {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    timeZone,
  }).format(now);
  if (classes.length === 0) return day;
  const live = classes.flatMap((c) => {
    const session = liveNow(c, now);
    return session ? [{ name: c.name, endsAt: session.endsAt }] : [];
  });
  const [only] = live;
  const said =
    only === undefined
      ? 'no class in session'
      : live.length === 1
        ? `${only.name} ends at ${bellTime(only.endsAt, format)}`
        : `${live.length} classes in session`;
  return `${day}${DOT}${said}`;
}

/**
 * A class once (Main's and HomeIdle's `.schedrow`): its name over its line, as Classes' card says it
 * (`classLine`), in the row's own 15/22 line as the board renders its inline line; while its session
 * runs, the Live chip and the live card's edge, and Open, else Start…, both to its page, each
 * described by the class's name.
 */
function ClassRow({ c, now }: { c: TaughtClass; now: number }) {
  const name = useId();
  const live = liveNow(c, now);
  return (
    <li
      className={`flex items-center gap-3.5 rounded-md border bg-surface-card px-4.5 py-3.75 text-body ${live ? 'border-live-edge' : 'border-border-default'}`}
    >
      <div className="min-w-0 flex-1">
        <span id={name} className="block text-tile-name wrap-anywhere">
          {c.name}
        </span>
        <span className="text-countdown-sub text-text-tertiary">{classLine(c, now)}</span>
      </div>
      {live ? (
        <>
          <LiveChip endsAt={live.endsAt} />
          <Link href={`/classes/${c.id}`} aria-describedby={name} className={QUIET_LINK}>
            Open
          </Link>
        </>
      ) : (
        <Link
          href={`/classes/${c.id}`}
          aria-describedby={name}
          className={buttonClass('secondary', '', 'sm')}
        >
          Start…
        </Link>
      )}
    </li>
  );
}

/** A rail card's label (v2.css's `.wlabel`) with its icon, as the block's card has it. */
const RAIL_LABEL = 'flex items-center gap-2 text-section-label text-text-tertiary uppercase';

/** Each moment's dot (Main): an unlock's open lock, protection off's shield, a start's check. */
const ACTIVITY_ICON: Record<ActivityEventType, LucideIcon> = {
  unlock: LockOpen,
  protection_off: ShieldOff,
  session_started: CircleCheck,
};

/**
 * A moment of Recent activity as Main says it: who did what, the student named as their tile names
 * them, then an unlock's reason as the pop-up says it and the class, or the class alone; its time
 * without AM or PM, all of them today's.
 */
export function activityMoment(e: ActivityEvent, clock?: Intl.DateTimeFormat): TimelineMoment {
  const who = e.student === null ? '' : nameOf(e.student);
  const reason = reasonWords(isUnlockReason(e.reason) ? e.reason : null);
  const [words, under] =
    e.type === 'unlock'
      ? [`${who} used Emergency Unlock`, `${reason}${DOT}${e.class.name}`]
      : e.type === 'protection_off'
        ? [`${who} turned protection off`, e.class.name]
        : ['Session started', e.class.name];
  const at = new Date(e.occurredAt);
  return {
    key: e.eventId,
    Icon: ACTIVITY_ICON[e.type],
    words,
    under,
    at,
    time: bareTime(+at, clock),
  };
}

/**
 * Recent activity (PV17c; Main): today's unlocks with their reasons, protection offs and starts
 * across the teacher's classes, newest first, four at most, then Open the class while one class is
 * live (with more, each live card has its own: HomeRailStates, drawn first). Loading and a failure
 * as HomeMoreStates draws them, the failure in the list's place until a read works. None at all for
 * a list that came back empty: a live class's own start is always in it (PV1), but for one that
 * started before midnight.
 */
export function RecentActivityView({
  read,
  only,
  onRetry,
}: {
  read: ActivityRead;
  /** The class live, when there is one alone. */
  only: string | null;
  onRetry: () => void;
}) {
  const id = useId();
  if (read.kind === 'ready' && read.events.length === 0) return null;
  return (
    <section aria-labelledby={id} className={CARD_ALONE}>
      <h2 id={id} className={RAIL_LABEL}>
        <ScrollText size={14} aria-hidden="true" className="shrink-0" />
        Recent activity
      </h2>
      {read.kind === 'loading' ? (
        <p role="status" className="mt-3.5 text-body text-text-secondary">
          Loading…
        </p>
      ) : read.kind === 'error' ? (
        <div className="mt-3.5">
          <div role="alert" className="text-body">
            <p className="font-semibold">Couldn&apos;t load recent activity.</p>
            <p className="text-text-secondary">{read.message}</p>
          </div>
          <Button variant="secondary" size="sm" onClick={onRetry} className="mt-3.5">
            Try again
          </Button>
        </div>
      ) : (
        <>
          <Timeline moments={read.events.map((e) => activityMoment(e))} className="mt-3.5" />
          {/* In a line of the body's height, as the board sets it: 14 px under the list. */}
          {only !== null ? (
            <div className="mt-3.5 text-body">
              <Link href={`/classes/${only}`} className={QUIET_LINK}>
                Open the class
              </Link>
            </div>
          ) : null}
        </>
      )}
    </section>
  );
}

/** Recent activity, read as Home shows it and again while it is in view (`pollActivity`). */
function RecentActivity({ only }: { only: string | null }) {
  const api = useApi();
  const [read, setRead] = useState<ActivityRead>({ kind: 'loading' });
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const poll = pollActivity(api, setRead);
    return () => poll.stop();
  }, [api, attempt]);
  return (
    <RecentActivityView
      read={read}
      only={only}
      onRetry={() => {
        setRead({ kind: 'loading' });
        setAttempt((n) => n + 1);
      }}
    />
  );
}

/**
 * Last session (PV17c; HomeIdle): the last session over, its class and when it ran from the account
 * (PV2's `lastSession`), its figures from its report (R2): who joined, the average per student and
 * the unlocks; nobody joined, the recap's line in place of the first two (HomeRailStates, drawn
 * first). Within a minute of its bell its report says `ended: false`, the sweep not there yet, its
 * figures already counted to the bell: never read here, so the card never calls it running. Loading
 * and a failure as HomeMoreStates draws them.
 */
export function LastSessionView({
  last,
  read,
  onRetry,
}: {
  last: LastSession;
  read: ReportRead;
  onRetry: () => void;
}) {
  const id = useId();
  const name = useId();
  const { startedAt, endedAt } = last.session;
  return (
    <section aria-labelledby={id} className={CARD_ALONE}>
      <h2 id={id} className={RAIL_LABEL}>
        <Clock size={14} aria-hidden="true" className="shrink-0" />
        Last session
      </h2>
      <p id={name} className="mt-3.5 text-body font-semibold wrap-anywhere">
        {last.name}
      </p>
      <p className="text-caption text-text-tertiary">
        {sessionTimes({ startedAt, endsAt: endedAt, endedAt })}
      </p>
      {read.kind === 'loading' ? (
        <p role="status" className="mt-3.5 text-body text-text-secondary">
          Loading the last session…
        </p>
      ) : read.kind === 'error' ? (
        <div className="mt-3.5">
          <div role="alert" className="text-body">
            <p className="font-semibold">Couldn&apos;t load the last session.</p>
            <p className="text-text-secondary">{read.message}</p>
          </div>
          <Button variant="secondary" size="sm" onClick={onRetry} className="mt-3.5">
            Try again
          </Button>
        </div>
      ) : (
        <LastFigures report={read.report} />
      )}
      {/* In a line of the body's height, as the board sets it: 14 px under the figures. */}
      {read.kind === 'ready' ? (
        <div className="mt-3.5 text-body">
          <Link href={`/classes/${last.classId}`} aria-describedby={name} className={QUIET_LINK}>
            Open the recap
          </Link>
        </div>
      ) : null}
    </section>
  );
}

/** HomeIdle's three figures; nobody joined, the recap's line, and the unlocks only if any. */
function LastFigures({ report }: { report: Extract<ReportRead, { kind: 'ready' }>['report'] }) {
  const joined = report.joined.length;
  const unlocks = new Intl.NumberFormat().format(report.unlocks.length);
  const { joined: who, average } = classFigures(joined, report);
  const figures =
    joined > 0
      ? ([
          ['Joined', who],
          ['Average per student', `${average} min`],
          ['Unlocks', unlocks],
        ] as const)
      : report.unlocks.length > 0
        ? ([['Unlocks', unlocks]] as const)
        : [];
  return (
    <>
      {joined === 0 ? (
        <p className="mt-3.5 text-body text-text-secondary">Nobody joined this session.</p>
      ) : null}
      {figures.length > 0 ? <Figures figures={figures} className="mt-3.5 gap-x-7 gap-y-3" /> : null}
    </>
  );
}

/** Last session, its report read as Home shows it and by Try again (`readReport`). */
function LastSessionCard({ last }: { last: LastSession }) {
  const api = useApi();
  const [read, setRead] = useState<ReportRead>({ kind: 'loading' });
  const [attempt, setAttempt] = useState(0);
  const { classId } = last;
  const sessionId = last.session.id;
  useEffect(() => {
    let live = true;
    void readReport(api, classId, sessionId).then((answer) => {
      if (live) setRead(answer);
    });
    return () => {
      live = false;
    };
  }, [api, classId, sessionId, attempt]);
  return (
    <LastSessionView
      last={last}
      read={read}
      onRetry={() => {
        setRead({ kind: 'loading' });
        setAttempt((n) => n + 1);
      }}
    />
  );
}

/** v2.css's phone width, Tailwind's `sm`: under it Recent activity is hidden (PV1; PhoneHome). */
const WIDE = '(min-width: 40rem)';

/** Whether the page is at least `WIDE`, so a phone never reads what it hides. */
function useWide(): boolean {
  return useSyncExternalStore(
    (changed) => {
      const query = window.matchMedia(WIDE);
      query.addEventListener('change', changed);
      return () => query.removeEventListener('change', changed);
    },
    () => window.matchMedia(WIDE).matches,
    () => true,
  );
}

/**
 * A teacher's Home (PV17a; Main, HomeIdle, HomeNew): the greeting and the date, the list's failure
 * with Try again over the classes read before (HomeInterimStates), each class live by this
 * computer's clock to the server's bell on its live card (PV17b), then each class once, or for a new
 * teacher the first class's card, its Create a class to Classes' New class; beside them, under them
 * on anything narrower, the rail (PV17c): while a class is live Recent activity, never on a phone;
 * once the last read has none running, the last session over, if any has ended; then the block's
 * card. A session the server ends while Home is open loses its card at once, and the classes are
 * read again (HomeLiveStates, drawn first), Last session showing once the read says none runs, so
 * it never shows an older session meanwhile (HomeRailStates, drawn first). `ref` is the greeting's,
 * for focus after a redeem.
 */
export function TeacherHome({
  ref,
  me,
  failed,
  now,
  onRead,
}: {
  ref?: Ref<HTMLHeadingElement>;
  me: MeResponse;
  /** The account's last read failed, in `errText`'s words; null once one works. */
  failed: string | null;
  now: number;
  onRead: () => void;
}) {
  const yours = useId();
  const name = me.user.displayName?.trim() || null;
  // The sessions the server ended while Home was open: their cards go before the read answers.
  const [ended, setEnded] = useState<ReadonlySet<string>>(() => new Set());
  const onEnded = useCallback(
    (session: string) => {
      setEnded((cur) => new Set(cur).add(session));
      onRead();
    },
    [onRead],
  );
  const live = me.classes.flatMap((c) => {
    const session = liveNow(c, now);
    return session && !ended.has(session.id) ? [{ c, session }] : [];
  });
  const wide = useWide();
  // Past a bell, or past an End elsewhere, the read still counts the session running until it is
  // read again; until then there is no Last session to show, never an older one (HomeRailStates).
  const running = me.classes.some((c) => (c.summary?.runningSession ?? null) !== null);
  const last = running ? null : lastOf(me.classes);
  return (
    <main className="flex flex-col gap-5.5">
      <div>
        <h1 ref={ref} tabIndex={-1} className="text-greeting text-balance wrap-anywhere">
          {greeting(now, name)}
        </h1>
        <p className="mt-0.75 text-meta text-text-secondary">{dayLine(me.classes, now)}</p>
      </div>
      {failed !== null ? (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-3">
          <p role="alert" className="text-body">
            Couldn&apos;t load your classes. {failed}
          </p>
          <Button variant="secondary" size="sm" onClick={onRead}>
            Try again
          </Button>
        </div>
      ) : null}
      <div className="flex flex-wrap items-start gap-5">
        <div className="flex min-w-0 grow-999 basis-130 flex-col gap-5">
          {live.map(({ c, session }) => (
            <LiveCard key={session.id} c={c} session={session} onEnded={onEnded} onRead={onRead} />
          ))}
          {me.classes.length === 0 ? (
            <FirstClass href={NEW_CLASS} />
          ) : (
            <section aria-labelledby={yours}>
              <h2 id={yours} className="mb-3 text-section-label text-text-tertiary uppercase">
                Your classes
              </h2>
              <ul className="flex flex-col gap-2.5">
                {me.classes.map((c) => (
                  <ClassRow key={c.id} c={c} now={now} />
                ))}
              </ul>
            </section>
          )}
        </div>
        <div className="flex min-w-0 grow basis-80 flex-col gap-5">
          {live.length > 0 ? (
            wide ? (
              <RecentActivity only={live.length === 1 ? (live[0]?.c.id ?? null) : null} />
            ) : null
          ) : last !== null ? (
            <LastSessionCard key={last.session.id} last={last} />
          ) : null}
          <Blocks />
        </div>
      </div>
    </main>
  );
}
