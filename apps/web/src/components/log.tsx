import {
  CircleCheck,
  Flag,
  LockOpen,
  type LucideIcon,
  ShieldCheck,
  ShieldOff,
  Wifi,
  WifiOff,
} from 'lucide-react';
import type { ReactNode } from 'react';

import { reasonWords } from '@/components/unlock-popups';
import { bareTime, type Moment, type StudentMoment } from '@/lib/recap';

/*
 * A log in the lock-only look (LO6; lock.css's `.log`), the session list's and the student panel's,
 * and a student's record in it, the panel's and the recap's (LO13), in a module of its own that
 * imports nothing of theirs or the grid's, so either can be loaded first (santa's round 1). Its one
 * component import is the pop-ups' reason words (`reasonWords`), whose module must keep importing
 * none of the grid, the session list or the student panel.
 */

/** A moment's icon in its state's ink (lock.css's `.c-*`): focused, unlocked, protection off, quiet. */
export const INK = {
  focused: 'text-state-focused-fg',
  unlocked: 'text-state-emergency-fg',
  off: 'text-state-revoked-fg',
  quiet: 'text-state-ended-fg',
};

/** A log's icon: 16 px, 2 px down to sit on its words' first line. */
export const logIcon = (Icon: LucideIcon, ink: string) => (
  <Icon size={16} aria-hidden="true" className={`mt-0.5 shrink-0 ${ink}`} />
);

/** One line of a log: when, what happened in its icon and words, and a line under them. */
export interface LogItem {
  key: string;
  at: Date;
  icon: ReactNode;
  words: ReactNode;
  /** An unlock's reason, in the secondary ink under its words. */
  under?: ReactNode;
}

/**
 * Each of a student's moments in the record's words and icon, in its state's ink, one copy for the
 * student panel (ClassStudent: "Used Emergency Unlock", "Tapped in and focused"; the rest as
 * LiveListStates draws them, in the session list's words) and the recap's record (ClassEndedOpen).
 */
const MOMENT: Record<Moment, [words: string, Icon: LucideIcon, ink: string]> = {
  in: ['Tapped in and focused', CircleCheck, INK.focused],
  unlock: ['Used Emergency Unlock', LockOpen, INK.unlocked],
  focus: ['Back in focus', CircleCheck, INK.focused],
  off: ['Turned protection off', ShieldOff, INK.off],
  on: ['Turned protection back on', ShieldCheck, INK.quiet],
  silent: ['Went silent', WifiOff, INK.quiet],
  back: ['Checked in again', Wifi, INK.quiet],
  left: ['Left', Flag, INK.quiet],
};

/** A student's moment as a line of their record: its time, icon and words, an unlock's reason under. */
export function momentLine(m: StudentMoment): LogItem {
  const [words, Icon, ink] = MOMENT[m.moment];
  return {
    key: m.key,
    at: m.at,
    icon: logIcon(Icon, ink),
    words,
    under: m.moment === 'unlock' ? reasonWords(m.reason) : null,
  };
}

/**
 * A line each between hairlines, 12 px in, its time on the left without AM or PM, 13/20 in the
 * tertiary ink, then its icon and what happened, 14/20.
 */
export function Log({ items }: { items: readonly LogItem[] }) {
  return (
    <ol className="flex flex-col">
      {items.map(({ key, at, icon, words, under }) => (
        <li
          key={key}
          className="grid grid-cols-[40px_18px_minmax(0,1fr)] items-start gap-3 border-b border-border-default py-3 first:border-t"
        >
          <time dateTime={at.toISOString()} className="text-log-time text-text-tertiary">
            {bareTime(at.getTime())}
          </time>
          {icon}
          <p className="text-data font-normal wrap-anywhere">
            {words}
            {under ? (
              <small className="block text-caption text-text-secondary">{under}</small>
            ) : null}
          </p>
        </li>
      ))}
    </ol>
  );
}
