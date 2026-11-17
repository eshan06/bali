import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';

import { bareTime } from '@/lib/recap';

/*
 * A log in the lock-only look (LO6; lock.css's `.log`), the session list's and the student panel's,
 * in a module of its own that imports nothing of theirs or the grid's, so either can be loaded
 * first (santa's round 1).
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
