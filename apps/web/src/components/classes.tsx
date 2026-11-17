'use client';

import Link from 'next/link';
import { useId } from 'react';

import { daysBefore, liveNow, type TaughtClass } from '@/lib/classes';
import { bareTime, type RecapFormat } from '@/lib/recap';
import { bellTime } from '@/lib/session-controls';

import { LockButton, lockButton, QUIET } from './button';
import { LEDGER, LEDGER_CELL, LEDGER_HEAD, LEDGER_LIVE, LEDGER_NAME, WELL } from './card';
import { Ring, shareLeft, useClock } from './live-header';
import { cardId } from './new-class';

/** A line between hairlines in the secondary ink (lock.css's `.wait-line`): Loading…, none yet. */
export const WAIT_LINE = 'border-y border-border-default py-3 text-text-secondary';

/** A failure's line between hairlines, its Try again beside it (lock.css's `.oops`; HomeStates). */
export const OOPS =
  'flex flex-wrap items-center gap-x-4 gap-y-3 border-y border-border-default py-4';

/**
 * The day a session started, as Your classes and Last session say it, by this computer's calendar:
 * "Today", a day of the last six ("Friday"), else its date ("Oct 2"), with its year once that isn't
 * this one ("Dec 18, 2025"; ClassesStates, drawn first).
 */
export function sessionDay(startedAt: string, now: Date, format: RecapFormat = {}): string {
  const { locale, timeZone } = format;
  const at = new Date(startedAt);
  const ago = daysBefore(at, now, timeZone);
  if (ago <= 0) return 'Today';
  if (ago < 7) return new Intl.DateTimeFormat(locale, { weekday: 'long', timeZone }).format(at);
  const year = new Intl.DateTimeFormat(locale, { year: 'numeric', timeZone });
  const other = year.format(at) !== year.format(now);
  return new Intl.DateTimeFormat(locale, {
    month: 'short',
    day: 'numeric',
    year: other ? 'numeric' : undefined,
    timeZone,
  }).format(at);
}

/** A class's last session in Your classes (Main, HomeIdle): "Today, 8:00 AM", "Friday", "Oct 2". */
export function lastSessionDay(startedAt: string, now: Date, format: RecapFormat = {}): string {
  const day = sessionDay(startedAt, now, format);
  return daysBefore(new Date(startedAt), now, format.timeZone) <= 0
    ? `${day}, ${bellTime(startedAt, format)}`
    : day;
}

/**
 * When a session ran, as Last session says it (HomeIdle): its day as Your classes says it, then its
 * start to its end, the start's AM or PM left off when the end's is the same, "Today, 8:00 to 8:50
 * AM", and kept when it isn't, "Friday, 11:30 AM to 12:20 PM".
 */
export function sessionRan(
  { startedAt, endedAt }: { startedAt: string; endedAt: string },
  now: Date,
  format: RecapFormat = {},
): string {
  const { locale, timeZone } = format;
  const clock = new Intl.DateTimeFormat(locale, { hour: 'numeric', minute: '2-digit', timeZone });
  const period = (iso: string) =>
    clock.formatToParts(new Date(iso)).find((p) => p.type === 'dayPeriod')?.value;
  const start =
    period(startedAt) === period(endedAt)
      ? bareTime(Date.parse(startedAt), clock)
      : clock.format(new Date(startedAt));
  return `${sessionDay(startedAt, now, format)}, ${start} to ${clock.format(new Date(endedAt))}`;
}

/**
 * No classes yet (HomeStates' "A new teacher", today's words), in Your classes' place beside Your
 * block (HomeMoments): the plain well, the ring's track, and Create a class, which opens New class.
 */
export function FirstClass({ onNew }: { onNew: () => void }) {
  const id = useId();
  return (
    <section aria-labelledby={id} className={`${WELL} flex min-w-0 flex-col items-start gap-3 p-8`}>
      <Ring share={0} box={46} stroke={5} />
      <h2 id={id} className="text-page-title">
        Set up your first class
      </h2>
      <p className="max-w-[60ch] text-text-secondary">
        Name it, then put its join code on the board. Students join with it in the Bali app.
      </p>
      <LockButton aria-haspopup="dialog" onClick={onNew} className="mt-2">
        Create a class
      </LockButton>
    </section>
  );
}

/** A class's session running, in its row (`.livechip`): the ring, ticking, and "Live until 9:55 AM". */
function LiveUntil({ startedAt, endsAt }: { startedAt: string | null; endsAt: string }) {
  const now = useClock(endsAt);
  return (
    <span className="inline-flex items-center gap-2 font-medium text-state-focused-fg">
      <Ring
        share={startedAt === null ? 0 : shareLeft(startedAt, endsAt, now)}
        box={16}
        stroke={2.5}
      />
      Live until {bellTime(endsAt)}
    </span>
  );
}

/**
 * A class once in Your classes: its name, a link to its page (its id lets focus come to a class just
 * made, `NewClass`); its students now; while its session runs by this computer's clock to the
 * server's bell, the live green, its chip and Open; else its last session's day, or none, and
 * Start…. Open and Start… go to its page, each described by the class's name.
 */
function ClassRow({
  c,
  now,
  startedAt,
}: {
  c: TaughtClass;
  now: number;
  /** The running session's start, once Home's well has read it: the chip's ring. */
  startedAt: string | null;
}) {
  const name = useId();
  const live = liveNow(c, now);
  const last = c.summary?.lastSession ?? null;
  const page = `/classes/${c.id}`;
  return (
    <tr className={live ? LEDGER_LIVE : undefined}>
      <td className={LEDGER_CELL}>
        <Link id={cardId(c.id)} href={page} className={`${LEDGER_NAME} wrap-anywhere`}>
          <span id={name}>{c.name}</span>
        </Link>
      </td>
      <td className={`${LEDGER_CELL} text-right tabular-nums`}>{c.summary?.studentCount ?? 0}</td>
      <td className={LEDGER_CELL}>
        {live ? (
          <LiveUntil startedAt={startedAt} endsAt={live.endsAt} />
        ) : (
          <span className="text-text-secondary">
            {last ? lastSessionDay(last.startedAt, new Date(now)) : 'No sessions yet'}
          </span>
        )}
      </td>
      <td className={`${LEDGER_CELL} text-right`}>
        {live ? (
          <Link href={page} aria-describedby={name} className={QUIET}>
            Open
          </Link>
        ) : (
          <Link href={page} aria-describedby={name} className={lockButton('secondary', 'sm')}>
            Start…
          </Link>
        )}
      </td>
    </tr>
  );
}

/**
 * Your classes (Main, HomeIdle; lock.css's `.ledger`): a row per class in the account's order, in a
 * box that scrolls sideways when the table is wider than its column (PhonePages). `id` is its
 * title's, where focus lands after Home's Try again.
 */
export function YourClasses({
  id,
  classes,
  now,
  starts,
}: {
  id: string;
  classes: readonly TaughtClass[];
  now: number;
  /** Each running session's start, by its id, as Home's wells read them. */
  starts: ReadonlyMap<string, string>;
}) {
  return (
    <section aria-labelledby={id} className="flex min-w-0 flex-col gap-4">
      <h2 id={id} className="text-section-title">
        Your classes
      </h2>
      <div className="overflow-x-auto">
        <table className={LEDGER}>
          <thead>
            <tr>
              <th scope="col" className={LEDGER_HEAD}>
                Class
              </th>
              <th scope="col" className={`${LEDGER_HEAD} text-right`}>
                Students
              </th>
              <th scope="col" className={LEDGER_HEAD}>
                Last session
              </th>
              <th scope="col" className={`${LEDGER_HEAD} text-right`}>
                <span className="sr-only">Open or start</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {classes.map((c) => (
              <ClassRow
                key={c.id}
                c={c}
                now={now}
                startedAt={starts.get(c.summary?.runningSession?.id ?? '') ?? null}
              />
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
