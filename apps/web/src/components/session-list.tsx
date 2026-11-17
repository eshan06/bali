'use client';

import { CircleCheck, LockOpen, type LucideIcon, ShieldOff, WifiOff } from 'lucide-react';
import { type ReactNode, useMemo } from 'react';

import { Mark } from '@/components/mark';
import type { Students } from '@/lib/grid-state';
import { bareTime } from '@/lib/recap';
import { type LineKind, type LogRead, logLines } from '@/lib/session-log';

import { Oops } from './live-grid';

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
 * A log in the lock-only look (lock.css's `.log`; the session list and the student panel): a line
 * each between hairlines, 12 px in, its time on the left without AM or PM, 13/20 in the tertiary
 * ink, then its icon and what happened, 14/20.
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

/** Each line's icon and what it says after the student's name (ClassLive). */
const LINE: Record<Exclude<LineKind, 'started'>, [Icon: LucideIcon, ink: string, says: string]> = {
  unlock: [LockOpen, INK.unlocked, 'used Emergency Unlock'],
  silent: [WifiOff, INK.quiet, 'went silent'],
  focus: [CircleCheck, INK.focused, 'was back in focus'],
  off: [ShieldOff, INK.off, 'turned protection off'],
};

/**
 * The session list on the right of the live page (LO6; ClassLive, PhoneLive under the room,
 * LiveListStates): "This session" over a line per moment, newest first (`logLines`), each student
 * named as their tile names them. Until the log is read, today's words say so; a log that didn't
 * load says why, with Try again (`retry`), which holds until Bali answers, focus then on the list's
 * title. Never in Present.
 */
export function SessionList({
  id,
  log,
  students,
  onRetry,
}: {
  id: string;
  log: LogRead;
  /** The grid's students, so a line names each as their tile does now. */
  students: Students;
  onRetry: () => Promise<void>;
}) {
  const events = log.kind === 'ready' ? log.events : null;
  const lines = useMemo(() => (events === null ? [] : logLines(events)), [events]);
  const title = `${id}-log`;
  const nameOf = (studentId: string) => students[studentId]?.displayName ?? studentId.slice(0, 8);
  return (
    <aside aria-labelledby={title} className="flex min-w-0 flex-col gap-4">
      <h2 id={title} className="text-section-title">
        This session
      </h2>
      {log.kind === 'loading' ? (
        <p className="border-y border-border-default py-3 text-body text-text-secondary">
          Loading this session…
        </p>
      ) : log.kind === 'error' ? (
        <Oops onRetry={onRetry} then={[title]}>
          Couldn&apos;t load this session. {log.message}
        </Oops>
      ) : (
        <Log
          items={lines.map(({ key, kind, studentId, at }) => {
            if (kind === 'started' || studentId === null) {
              return {
                key,
                at,
                icon: (
                  <span className="mt-0.5 flex">
                    <Mark size={16} />
                  </span>
                ),
                words: 'Session started',
              };
            }
            const [Icon, ink, says] = LINE[kind];
            return { key, at, icon: logIcon(Icon, ink), words: `${nameOf(studentId)} ${says}` };
          })}
        />
      )}
    </aside>
  );
}
