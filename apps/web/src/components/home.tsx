'use client';

import type { MeResponse } from '@bali/shared';
import Link from 'next/link';
import { type Ref, useId } from 'react';

import { liveNow, type TaughtClass } from '@/lib/classes';
import type { RecapFormat } from '@/lib/recap';
import { bellTime } from '@/lib/session-controls';

import { Blocks } from './blocks';
import { Button, buttonClass } from './button';
import { classLine, FirstClass, LiveChip } from './classes';
import { DOT } from './live-grid';
import { QUIET_LINK } from './text-link';

/** Where Home's Create a class goes: Classes, its New class open (HomeNew to ClassesNew). */
export const NEW_CLASS = '/classes?new';

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

/**
 * A teacher's Home (PV17a; HomeIdle, HomeNew, and Main until PV17b brings its live card:
 * HomeInterim, drawn first): the greeting and the date, the list's failure with Try again over the
 * classes read before (HomeInterimStates), each class once, or for a new teacher the first class's
 * card, its Create a class to Classes' New class; beside them, under them on anything narrower, the
 * block's card. `ref` is the greeting's, for focus after a redeem.
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
  return (
    <main className="flex flex-col gap-5.5">
      <div>
        <h1 ref={ref} tabIndex={-1} className="text-greeting wrap-anywhere">
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
          <Blocks />
        </div>
      </div>
    </main>
  );
}
