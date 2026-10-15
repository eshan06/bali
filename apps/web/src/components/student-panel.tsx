'use client';

import type { FeedEvent } from '@bali/shared';
import { CircleCheck, X } from 'lucide-react';
import { type ReactNode, useEffect, useMemo, useState } from 'react';

import { Button } from '@/components/button';
import { MOMENT } from '@/components/timeline';
import { reasonWords } from '@/components/unlock-popups';
import type { Student } from '@/lib/grid-state';
import type { Moment } from '@/lib/recap';
import { bellTime } from '@/lib/session-controls';
import {
  noEvents,
  readStudentEvents,
  type StudentRead,
  studentPanel,
  withEvents,
} from '@/lib/student-panel';
import { useApi } from '@/lib/use-api';

/** Clock off's words (S9): advice, which changes no state; the panel's line and the tile's tooltip. */
export const CLOCK_OFF = "This phone's clock is set ahead. Bali records the time by its own clock.";

/**
 * The moments the panel leaves out, as PanelStates draws it: its Silent board lists no going
 * silent, the chip and the last check-in saying it, and so no coming back, which only ends one.
 * The recap marks both; which the panel lists is the owner's open question (DECISIONS 2026-10-14).
 */
const UNLISTED: ReadonlySet<Moment> = new Set(['silent', 'back']);

/** "9:31 AM", as the bell and the pop-ups say a time. */
const time = (at: Date) => bellTime(at.toISOString());

/**
 * v2.css's `.panel`, 372 px from the right, under the reconnect pill and the pop-ups (z 10 and 20).
 * Fixed where the board draws it absolute on a page one screen tall: at rest the two are one, and
 * it stays in view as the page scrolls, by a tile on the grid's last row too.
 */
const PANEL =
  'fixed inset-y-0 right-0 z-5 flex w-93 max-w-full flex-col overflow-y-auto border-l border-border-default bg-surface-card shadow-3';
/** A line under the moments, 13/18 in the tertiary ink. */
const NOTE = 'text-caption text-text-tertiary';

export interface PanelProps {
  /** The panel's id, which its tile's `aria-controls` names; its heading's is `${id}-name`. */
  id: string;
  student: Student;
  /** Their state as their tile has it (`StateChip`), so the two never disagree. */
  chip: ReactNode;
  /** This session's events for them, the stream's folded in, or the read under way or failed. */
  read: StudentRead;
  now: Date;
  onClose: () => void;
  onRetry: () => void;
}

/**
 * The student panel (PV11b; ClassStudent, PanelStates): the name, when they tapped in, their state
 * and Close; this session's moments, oldest first, with their times and each unlock's reason (so
 * never in Present, #265); Clock off, the last check-in and who sees it. While the events are read,
 * the name and state alone; a read that failed, with Try again. Escape closes it from inside.
 */
export function PanelView({ id, student, chip, read, now, onClose, onRetry }: PanelProps) {
  const name = student.displayName ?? student.studentId.slice(0, 8);
  const panel = read.kind === 'ready' ? studentPanel(student, read.events.events, now) : null;
  const moments = panel?.moments.filter((m) => !UNLISTED.has(m.moment)) ?? [];
  return (
    <aside
      id={id}
      aria-labelledby={`${id}-name`}
      onKeyDown={(e) => {
        if (e.key === 'Escape') onClose();
      }}
      className={PANEL}
    >
      <div className="flex items-start gap-3 border-b border-border-default pt-5 pr-3.5 pb-4 pl-5">
        <div className="min-w-0 flex-1">
          {/* Focus comes here as the panel opens, so a screen reader starts at the name. */}
          <h2 id={`${id}-name`} tabIndex={-1} className="text-h3 wrap-anywhere">
            {name}
          </h2>
          {panel?.tappedInAt ? <p className={NOTE}>Tapped in at {time(panel.tappedInAt)}</p> : null}
        </div>
        {chip}
        <button
          type="button"
          aria-label="Close"
          onClick={onClose}
          className="grid size-9 shrink-0 cursor-pointer place-items-center rounded-item text-text-tertiary hover:bg-surface-sunken hover:text-text-primary"
        >
          <X size={16} aria-hidden="true" />
        </button>
      </div>
      <div className="flex flex-col gap-5.5 px-5 pt-4.5 pb-6">
        <section>
          <h3 className="mb-3 text-label text-text-tertiary uppercase">This session</h3>
          {read.kind === 'loading' ? (
            <p role="status" className="text-body text-text-secondary">
              Loading this session…
            </p>
          ) : read.kind === 'error' ? (
            <>
              <div role="alert">
                <p className="text-body font-semibold">Couldn&apos;t load this session.</p>
                <p className="text-body text-text-secondary">{read.message}</p>
              </div>
              <div className="mt-3.5">
                <Button variant="secondary" size="sm" onClick={onRetry}>
                  Try again
                </Button>
              </div>
            </>
          ) : moments.length === 0 ? (
            <p className="text-body text-text-secondary">
              {name} hasn&apos;t tapped in this session.
            </p>
          ) : (
            // v2.css's `.tl`: a 26 px grey dot each, joined by a hairline; the icon and the words say
            // what happened, with no colour behind them.
            <ol className="flex flex-col">
              {moments.map((m) => {
                const [words, Icon] = MOMENT[m.moment];
                const Dot = Icon ?? CircleCheck;
                return (
                  <li
                    key={m.key}
                    className="relative grid grid-cols-[26px_minmax(0,1fr)_auto] items-start gap-2.5 pb-4.5 before:absolute before:top-6.5 before:bottom-0.5 before:left-[12.5px] before:w-px before:bg-border-default last:pb-0 last:before:hidden"
                  >
                    <span className="relative z-1 grid size-6.5 place-items-center rounded-full bg-surface-sunken text-text-secondary">
                      <Dot size={13} aria-hidden="true" />
                    </span>
                    <p className="pt-0.75 text-data font-normal">
                      {words}
                      {m.moment === 'unlock' ? (
                        <small className="block text-tile-line font-normal text-text-secondary">
                          {reasonWords(m.reason)}
                        </small>
                      ) : null}
                    </p>
                    <span className="pt-1 text-tile-line text-text-tertiary">{time(m.at)}</span>
                  </li>
                );
              })}
            </ol>
          )}
        </section>
        {panel && student.clockOff ? <p className={NOTE}>{CLOCK_OFF}</p> : null}
        {panel?.lastCheckIn ? (
          <p className={NOTE}>The phone last checked in at {time(panel.lastCheckIn)}.</p>
        ) : null}
        <p className={NOTE}>
          Only you see this panel. Present never shows it, or an unlock&apos;s reason.
        </p>
      </div>
    </aside>
  );
}

/**
 * The panel with its read (PV11a), as it opens and by Try again; every event the live grid's stream
 * has brought (`streamed`) folded in, those that came while the read was out too, each once.
 */
export function StudentPanel({
  sessionId,
  streamed,
  ...view
}: Omit<PanelProps, 'read' | 'onRetry'> & { sessionId: string; streamed: readonly FeedEvent[] }) {
  const api = useApi();
  const [answer, setAnswer] = useState<StudentRead>({ kind: 'loading' });
  const [attempt, setAttempt] = useState(0);
  const studentId = view.student.studentId;
  useEffect(() => {
    let cancelled = false;
    void readStudentEvents(api, noEvents(sessionId, studentId)).then((read) => {
      if (!cancelled) setAnswer(read);
    });
    return () => {
      cancelled = true;
    };
  }, [api, sessionId, studentId, attempt]);
  const read = useMemo<StudentRead>(
    () =>
      answer.kind === 'ready'
        ? { kind: 'ready', events: withEvents(answer.events, sessionId, streamed) }
        : answer,
    [answer, sessionId, streamed],
  );
  return (
    <PanelView
      {...view}
      read={read}
      onRetry={() => {
        setAnswer({ kind: 'loading' });
        setAttempt((n) => n + 1);
        // Try again goes as the read starts: focus back to the name, never lost.
        document.getElementById(`${view.id}-name`)?.focus();
      }}
    />
  );
}
