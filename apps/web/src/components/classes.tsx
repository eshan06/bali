'use client';

import { ChevronRight, CircleCheck, Plus } from 'lucide-react';
import Link from 'next/link';
import { type ReactNode, useId } from 'react';

import { daysBefore, liveNow, type TaughtClass } from '@/lib/classes';
import type { RecapFormat } from '@/lib/recap';
import { bellTime } from '@/lib/session-controls';

import { Blocks } from './blocks';
import { Button, buttonClass } from './button';
import { Ring } from './live-header';
import { CHIP, CHIP_PILL, DOT } from './live-grid';
import { cardId } from './new-class';

/** "1 student", "28 students". */
export const students = (count: number) => `${count} ${count === 1 ? 'student' : 'students'}`;

/**
 * When the class's last session started, as its card says it, by this computer's calendar: "today,
 * 8:00 AM", a day of the last six ("Friday"), else its date ("Oct 2"), with its year once that isn't
 * this one ("Dec 18, 2025"; ClassesStates, drawn first).
 */
export function lastSessionDay(startedAt: string, now: Date, format: RecapFormat = {}): string {
  const { locale, timeZone } = format;
  const at = new Date(startedAt);
  const ago = daysBefore(at, now, timeZone);
  if (ago <= 0) return `today, ${bellTime(startedAt, format)}`;
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

/** A card's line (Classes): its students, then, but while it is live, its last session or none. */
export function classLine(c: TaughtClass, now: number, format?: RecapFormat): string {
  const count = students(c.summary?.studentCount ?? 0);
  if (liveNow(c, now)) return count;
  const last = c.summary?.lastSession ?? null;
  const when = last
    ? `last session ${lastSessionDay(last.startedAt, new Date(now), format)}`
    : 'no sessions yet';
  return `${count}${DOT}${when}`;
}

/** A class whose session runs (Classes, Main): the Live chip with its bell, in Focused's tint. */
export function LiveChip({ endsAt }: { endsAt: string }) {
  return (
    <span className={`${CHIP_PILL} ${CHIP.focused.tone}`}>
      <CircleCheck size={13} aria-hidden="true" className="shrink-0" />
      Live{DOT}ends {bellTime(endsAt)}
    </span>
  );
}

/**
 * A class on the list (Classes' `.classcard`), the whole card its link: its name over its line, and
 * while its session runs by this computer's clock to the server's bell, the Live chip and the live
 * card's green edge. Its id lets focus come to a class just made (`NewClass`).
 */
function ClassCard({ c, now }: { c: TaughtClass; now: number }) {
  const live = liveNow(c, now);
  return (
    <Link
      id={cardId(c.id)}
      href={`/classes/${c.id}`}
      className={`flex flex-wrap items-center gap-x-4 gap-y-3 rounded-md border bg-surface-card px-5 py-4.5 shadow-1 ${live ? 'border-live-edge' : 'border-border-default hover:border-border-strong'}`}
    >
      <span className="min-w-0 flex-1">
        <span className="block text-card-name wrap-anywhere">{c.name}</span>
        <span className="mt-0.5 block text-caption text-text-tertiary">{classLine(c, now)}</span>
      </span>
      {live ? <LiveChip endsAt={live.endsAt} /> : null}
      <ChevronRight size={20} aria-hidden="true" className="shrink-0 text-text-tertiary" />
    </Link>
  );
}

/**
 * No classes yet (ClassesEmpty, HomeNew), word for word on both: its Create a class opens New class
 * on Classes (`onNew`), or, on Home, goes there to open it (`href`), as HomeNew links to ClassesNew.
 */
export function FirstClass({ onNew, href }: { onNew?: () => void; href?: string }) {
  const id = useId();
  return (
    <section
      aria-labelledby={id}
      className="flex flex-col items-start gap-2.5 rounded-md border border-border-default bg-surface-card p-8 shadow-1"
    >
      <Ring share={0} box={46} stroke={5} />
      <h2 id={id} className="text-entry-title">
        Set up your first class
      </h2>
      <p className="max-w-144 text-body text-text-secondary">
        Name it, then put its join code on the board. Students join with it in the Bali app.
      </p>
      {href ? (
        <Link href={href} className={buttonClass('primary', 'mt-1.5')}>
          Create a class
        </Link>
      ) : (
        <Button aria-haspopup="dialog" onClick={onNew} className="mt-1.5">
          Create a class
        </Button>
      )}
    </section>
  );
}

/**
 * Classes, in the menu (PV16; Classes, ClassesEmpty): its head with New class, the list's failure
 * with Try again over the classes read before (HomeStates; as the page opens too, ClassesStates), a
 * card per class or the first class's card, and beside them the block's card, under them on
 * anything narrower. `children` is the New class dialog, which New class and Create a class open.
 */
export function ClassesView({
  classes,
  failed,
  now,
  onRead,
  onNew,
  children,
}: {
  classes: TaughtClass[];
  /** The list's last read failed, in `errText`'s words; null once one works. */
  failed: string | null;
  now: number;
  onRead: () => void;
  onNew: () => void;
  children?: ReactNode;
}) {
  return (
    <main className="flex flex-col gap-5.5">
      <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3">
        <h1 className="text-page-title">Classes</h1>
        <Button variant="secondary" aria-haspopup="dialog" onClick={onNew}>
          <Plus size={16} aria-hidden="true" />
          New class
        </Button>
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
          {classes.length === 0 ? (
            <FirstClass onNew={onNew} />
          ) : (
            <ul className="flex flex-col gap-2.5">
              {classes.map((c) => (
                <li key={c.id}>
                  <ClassCard c={c} now={now} />
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="flex min-w-0 grow basis-80 flex-col gap-5">
          <Blocks />
        </div>
      </div>
      {children}
    </main>
  );
}
