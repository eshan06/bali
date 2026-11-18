'use client';

import type {
  FeedEvent,
  RosterStudent,
  SessionReportResponse,
  SessionReportSummary as Summary,
} from '@bali/shared';
import { X } from 'lucide-react';
import { useEffect, useId, useRef, useState } from 'react';

import { ICON_BUTTON, LockButton, QUIET } from '@/components/button';
import { Log, momentLine } from '@/components/log';
import { Key, RecapRows } from '@/components/timeline';
import {
  payloadOf,
  type RecapFormat,
  recapGroups,
  type RecapStudent,
  type SessionWindow,
} from '@/lib/recap';
import { bellTime } from '@/lib/session-controls';

/*
 * The recap (LO7; ClassEnded, ClassEndedOpen, PhonePages' After the bell; its in-between states on
 * the canvas's ClassEndedStates, drawn first): a session after the bell, on the class page the day
 * it ended and on the session's own report page. Its figures and groups are the recap's own
 * (`recapGroups`, over R2's report and the session's events), class aggregates and names, never one
 * student's minutes, so nothing ranks them.
 */

/** Whether `at` falls on `now`'s day by this computer's calendar (`format`'s, in a test). */
export function sameDay(at: string, now = new Date(), format: RecapFormat = {}): boolean {
  const day = new Intl.DateTimeFormat(format.locale, {
    dateStyle: 'short',
    timeZone: format.timeZone,
  });
  return day.format(new Date(at)) === day.format(now);
}

/**
 * The class page's line after the bell (ClassEnded), the time in "Ended at 9:55 AM": the end the
 * server marked, when that was today on this computer's calendar (`sameDay`). Null for none, and for
 * an older session, which the page shows as its last line instead.
 */
export function endedToday(
  session: Summary | null,
  now = new Date(),
  format: RecapFormat = {},
): string | null {
  if (session === null) return null;
  const end = session.endedAt ?? session.endsAt;
  return sameDay(end, now, format) ? bellTime(end, format) : null;
}

/**
 * A student's record (ClassEndedOpen): lock.css's `.panel`, 372 px from the right as the student
 * panel is, sliding in on the drawer curve, its name over This session, their moments oldest first,
 * each with its time and an unlock its reason under it, in the panel's own words (`momentLine`).
 * Focus comes to the name as it opens; Close or Escape closes it.
 */
function Record({
  id,
  student,
  onClose,
}: {
  id: string;
  student: RecapStudent;
  onClose: () => void;
}) {
  const name = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    name.current?.focus();
  }, [student.key]);
  return (
    <aside
      id={id}
      aria-labelledby={`${id}-name`}
      onKeyDown={(e) => {
        if (e.key === 'Escape') onClose();
      }}
      className="fixed inset-y-0 right-0 z-5 flex w-93 max-w-full flex-col bg-surface-card shadow-3 drawer-in"
    >
      <div className="flex items-start gap-3 border-b border-border-default px-6 pt-6 pb-5">
        <h2
          ref={name}
          id={`${id}-name`}
          tabIndex={-1}
          className="min-w-0 flex-1 text-panel-title wrap-anywhere"
        >
          {student.name}
        </h2>
        <button
          type="button"
          aria-label={`Close ${student.name}'s record`}
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
          <Log items={student.moments.map(momentLine)} />
        </section>
      </div>
    </aside>
  );
}

/** A figure (lock.css's `.figures`): its number over its words, hairlines between them. */
const FIGURE =
  'flex flex-col gap-0.5 border-l border-border-default px-6 first:border-l-0 first:pl-0 max-[760px]:px-4 max-[760px]:first:pl-0';

/** A line of Everyone else (`.fold-list`), between hairlines. */
const FOLD = 'border-b border-border-default py-4';

/**
 * A session's recap (ClassEnded): over a hairline, how many of who joined stayed focused the whole
 * time, the page's one number, over the figures: who joined, the emergency unlocks and protection
 * offs R2 lists, the silences before the bell, and who didn't join. Then who wasn't focused the
 * whole time, each a name and a track (`RecapRows`), the Key opening over them; then everyone else
 * in two lines, how many stayed focused the whole time with Show names, and who didn't join by name.
 * A name opens that student's record. Nobody joined: today's line in the number's place, who didn't
 * join under it, and only the figures that count someone (ClassEndedStates). Each part shows only
 * when it has someone. Its parts sit in the page's column, 40 px apart, 32 on a phone.
 */
export function Recap({
  session,
  report,
  events,
  roster,
}: {
  session: SessionWindow;
  report: SessionReportResponse;
  events: readonly FeedEvent[];
  /** The class's roster now: who didn't join is read from it. */
  roster: readonly RosterStudent[];
}) {
  const id = useId();
  const [keyOpen, setKeyOpen] = useState(false);
  const [namesOpen, setNamesOpen] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  // The name that opened the record, for focus to come back to.
  const opener = useRef<HTMLButtonElement | null>(null);

  const groups = recapGroups(session, report, events, roster);
  const { partTime, wholeTime, notJoined } = groups;
  const start = Date.parse(session.startedAt);
  const end = Date.parse(session.endedAt ?? session.endsAt);
  // The unlocks the engine noted superseded, from the session's log: the grid never applies one,
  // so no track draws it (`stretchesOf`); the record and the figures keep it.
  const superseded = new Set(
    events
      .filter((e) => e.type === 'unlock' && payloadOf(e.payload).recorded_as === 'superseded')
      .map((e) => e.eventId),
  );
  const n = new Intl.NumberFormat();
  const joined = report.joined.length;
  const unlocks = report.unlocks.length;
  const offs = report.protectionOffs.length;
  // Each silence before the bell, as the other figures count each moment; one first marked at the
  // bell or after it came once class was over (`recapGroups`).
  const silences = partTime
    .flatMap((s) => s.moments)
    .filter((m) => m.moment === 'silent' && m.at.getTime() < end).length;
  const unlocked: [string, string] = [
    unlocks === 1 ? 'emergency unlock' : 'emergency unlocks',
    n.format(unlocks),
  ];
  const offed: [string, string] = ['protection off', n.format(offs)];
  const figures: [string, string][] =
    joined > 0
      ? [
          ['joined', n.format(joined)],
          unlocked,
          offed,
          ['went silent', n.format(silences)],
          ["didn't join", n.format(notJoined.length)],
        ]
      : [...(unlocks > 0 ? [unlocked] : []), ...(offs > 0 ? [offed] : [])];
  const record = partTime.find((s) => s.key === open) ?? null;
  const close = () => {
    setOpen(null);
    opener.current?.focus();
  };

  return (
    <>
      <section
        aria-labelledby={`${id}-count`}
        className="flex flex-col gap-6 border-t border-border-default pt-8"
      >
        <h2 id={`${id}-count`} className="flex flex-wrap items-baseline gap-x-3">
          {joined > 0 ? (
            <>
              <span className="text-count tabular-nums max-[760px]:text-count-phone">
                {n.format(wholeTime.length)}
              </span>{' '}
            </>
          ) : null}
          <span className="text-count-of text-text-secondary max-[760px]:text-count-of-phone">
            {joined > 0
              ? `of ${n.format(joined)} stayed focused the whole time`
              : 'Nobody joined this session.'}
          </span>
        </h2>
        {figures.length > 0 ? (
          <dl className="flex flex-wrap gap-y-4">
            {figures.map(([words, value]) => (
              <div key={words} className={FIGURE}>
                <dt className="order-2 text-caption text-text-secondary">{words}</dt>
                <dd className="order-1 text-h2 tabular-nums">{value}</dd>
              </div>
            ))}
          </dl>
        ) : null}
      </section>

      {partTime.length > 0 ? (
        <section aria-labelledby={`${id}-part`} className="flex flex-col gap-4">
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-2">
            <h2 id={`${id}-part`} className="text-section-title">
              Not focused the whole time
            </h2>
            <span className="text-data font-normal text-text-tertiary">
              {n.format(partTime.length)}
            </span>
            <LockButton
              variant="secondary"
              size="sm"
              aria-expanded={keyOpen}
              aria-controls={keyOpen ? `${id}-key` : undefined}
              onClick={() => setKeyOpen(!keyOpen)}
              className="ml-auto"
            >
              Key
            </LockButton>
          </div>
          {keyOpen ? <Key id={`${id}-key`} /> : null}
          <RecapRows
            groups={groups}
            start={start}
            end={end}
            superseded={superseded}
            opened={open}
            onOpen={(student, from) => {
              opener.current = from;
              setOpen(open === student.key ? null : student.key);
            }}
          />
        </section>
      ) : null}

      {(joined > 0 && wholeTime.length > 0) || notJoined.length > 0 ? (
        <section aria-labelledby={`${id}-rest`}>
          <h2 id={`${id}-rest`} className="sr-only">
            Everyone else
          </h2>
          <ul className="flex flex-col border-t border-border-default text-body">
            {joined > 0 && wholeTime.length > 0 ? (
              <li className={FOLD}>
                <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-2">
                  <span>{n.format(wholeTime.length)} stayed focused the whole time</span>
                  <button
                    type="button"
                    aria-expanded={namesOpen}
                    aria-controls={namesOpen ? `${id}-names` : undefined}
                    onClick={() => setNamesOpen(!namesOpen)}
                    className={QUIET}
                  >
                    {namesOpen ? 'Hide names' : 'Show names'}
                  </button>
                </div>
                {namesOpen ? (
                  <p
                    id={`${id}-names`}
                    className="mt-3 max-w-[96ch] text-text-secondary wrap-anywhere"
                  >
                    {wholeTime.map((s) => s.name).join(', ')}
                  </p>
                ) : null}
              </li>
            ) : null}
            {notJoined.length > 0 ? (
              <li className={`${FOLD} wrap-anywhere`}>
                Didn&apos;t join: {notJoined.map((s) => s.name).join(', ')}
              </li>
            ) : null}
          </ul>
        </section>
      ) : null}

      {record ? <Record id={`${id}-record`} student={record} onClose={close} /> : null}
    </>
  );
}
