'use client';

import { X } from 'lucide-react';
import type { ReactNode } from 'react';

import { ICON_BUTTON } from '@/components/button';
import { Log, momentLine } from '@/components/log';
import { gridDisplay, lastSeenNote, type Student } from '@/lib/grid-state';
import { bellTime } from '@/lib/session-controls';
import type { LogRead } from '@/lib/session-log';
import { studentPanel } from '@/lib/student-panel';

import { Oops } from './live-grid';

/**
 * Clock off's words (S9), the panel's line: the owner's (2026-10-14), beside times that are the
 * phone's own claim held to the session's window.
 */
export const CLOCK_OFF = "This phone's clock is off, so its times may be off too.";

/**
 * lock.css's `.panel`: 372 px from the right, white, `shadow-3`, sliding in on the drawer curve
 * (`drawer-in`), under the reconnect pill and the pop-ups (z 10 and 20), so no unlock is hidden
 * behind it; over the top bar (z 3). Its head stays as its body scrolls.
 */
const PANEL =
  'fixed inset-y-0 right-0 z-5 flex w-93 max-w-full flex-col bg-surface-card shadow-3 drawer-in';
/** A line under the moments (LiveListStates): 13.5/19 in the secondary ink. */
const NOTE = 'text-meta text-text-secondary';

/**
 * The student panel (LO6; ClassStudent, LiveListStates): the name over their state as their tile
 * has it, and Close; this session's moments, newest first as the session list's, each with its time
 * and an unlock its reason (so never in Present, #265), from the session's log, the list's own; then when the
 * phone last checked in, once that's a minute or more ago with them focused, unlocked or protection
 * off, as their tile said before LO5 (`lastSeenNote`), and Clock off's line. While the log is read,
 * the name and the state alone; a log that didn't load, why, with Try again, which holds until Bali
 * answers, focus then on This session. Escape closes it from inside.
 */
export function StudentPanel({
  id,
  student,
  chip,
  log,
  now,
  onClose,
  onRetry,
}: {
  /** The panel's id, which its tile's `aria-controls` names; its heading's is `${id}-name`. */
  id: string;
  student: Student;
  /** Their state as their tile has it (`StateChip`), so the two never disagree. */
  chip: ReactNode;
  /** The session's log, the stream's folded in, or its read under way or failed. */
  log: LogRead;
  now: Date;
  onClose: () => void;
  /** Read the log again, its failure said until the answer. */
  onRetry: () => Promise<void>;
}) {
  const name = student.displayName ?? student.studentId.slice(0, 8);
  const panel = log.kind === 'ready' ? studentPanel(student, log.events, now) : null;
  const seen =
    panel?.lastCheckIn && lastSeenNote(student, gridDisplay(student, now), now) !== null
      ? panel.lastCheckIn
      : null;
  return (
    <aside
      id={id}
      aria-labelledby={`${id}-name`}
      onKeyDown={(e) => {
        if (e.key === 'Escape') onClose();
      }}
      className={PANEL}
    >
      <div className="flex items-start gap-3 border-b border-border-default px-6 pt-6 pb-5">
        <div className="flex min-w-0 flex-1 flex-col items-start gap-2">
          {/* Focus comes here as the panel opens, so a screen reader starts at the name. */}
          <h2 id={`${id}-name`} tabIndex={-1} className="text-panel-title wrap-anywhere">
            {name}
          </h2>
          {chip}
        </div>
        {/* Named for whose panel it closes, as the pop-ups' Close is (the audit's C02). */}
        <button
          type="button"
          aria-label={`Close ${name}'s panel`}
          onClick={onClose}
          className={ICON_BUTTON}
        >
          <X size={16} aria-hidden="true" />
        </button>
      </div>
      <div className="flex flex-col gap-6 overflow-y-auto overscroll-contain p-6">
        <section aria-labelledby={`${id}-session`} className="flex flex-col gap-4">
          <h3 id={`${id}-session`} className="mb-2 text-data font-semibold">
            This session
          </h3>
          {log.kind === 'loading' ? (
            <p role="status" className="text-body text-text-secondary">
              Loading this session…
            </p>
          ) : log.kind === 'error' ? (
            <Oops onRetry={onRetry} then={[`${id}-session`]}>
              Couldn&apos;t load this session. {log.message}
            </Oops>
          ) : panel === null || panel.moments.length === 0 ? (
            <p className="text-body text-text-secondary">
              {name} hasn&apos;t tapped in this session.
            </p>
          ) : (
            <Log
              // Newest first, at one instant the engine's later first (ClassStudent), in the
              // record's words (`momentLine`).
              items={[...panel.moments].reverse().map(momentLine)}
            />
          )}
        </section>
        {seen ? (
          <p className={NOTE}>The phone last checked in at {bellTime(seen.toISOString())}.</p>
        ) : null}
        {panel && student.clockOff ? <p className={NOTE}>{CLOCK_OFF}</p> : null}
      </div>
    </aside>
  );
}
