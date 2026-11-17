'use client';

import type { SessionReportSummary } from '@bali/shared';
import { CircleAlert, Download } from 'lucide-react';
import Link from 'next/link';
import { useId } from 'react';

import { LockButton } from '@/components/button';
import { LEDGER, LEDGER_CELL, LEDGER_HEAD, LEDGER_SUB } from '@/components/card';
import { OOPS, WAIT_LINE } from '@/components/classes';
import { TryAgain } from '@/components/try-again';
import { csvName, saveFile, sessionsCsv } from '@/lib/report-csv';
import {
  focusBar,
  focusShare,
  type ReadAt,
  reportPath,
  type SessionList,
  sessionRow,
} from '@/lib/reports';

/*
 * v2.css's `.wtable`, which a session's own page keeps for its Unlocks until LO7 redraws it: a
 * section's name over its part, 12 px above it; the table's head grey, each cell 16 px in, a
 * hairline under every row but the last, in a box that scrolls sideways.
 */
export const LABEL = 'mb-3 text-section-label text-text-tertiary uppercase';
export const HEAD =
  'border-b border-border-default bg-surface-sunken px-4 py-2.75 text-section-label whitespace-nowrap text-text-tertiary uppercase';
export const CELL = 'border-b border-border-default px-4 py-3 align-middle text-cell';
export const FIGURE = `${CELL} text-right whitespace-nowrap`;
export const TABLE_BOX =
  'overflow-x-auto rounded-frame border border-border-default bg-surface-card';

/** The sessions' figures, in their columns' order after the session's own (Reports). */
const COLUMNS = [
  'Joined',
  'Focused the whole time',
  'Average time focused',
  'Emergency unlocks',
  'Protection off',
] as const;

/**
 * Reports as its state draws it (Reports, HomeStates, PhonePages; its other moments on
 * ReportsMoments, drawn first): the heading; a tab per class, the one picked marked; the share of
 * the listed sessions' class time spent focused, with Download CSV; then those sessions, newest
 * first, in a ledger that scrolls sideways on a phone, each a link to its own page, with Show
 * earlier. Every state with its words: loading, couldn't load with Try again, none yet, the place
 * lost, and earlier sessions that didn't load. A failure stays said while its Try again reads, Try
 * again held; read, focus on the sessions' table, or on Show earlier, its own Try again, one button
 * throughout, until it goes with the last page. `classes` is null until the account is read.
 */
export function ReportsView({
  classes,
  classId,
  list,
  onRead,
}: {
  classes: { id: string; name: string }[] | null;
  classId: string | null;
  list: SessionList;
  onRead: (at: ReadAt) => void;
}) {
  const sessionsId = useId();
  const tableId = useId();
  const failed = list.failure?.at === 'newest' ? list.failure : null;
  // Show earlier's read that failed, said before its button, which then says Try again.
  const earlier = list.failure?.at === 'earlier' ? list.failure : null;
  const loading = classId !== null && list.reading === 'newest' && list.failure === null;
  const none =
    (classes !== null && classId === null) ||
    (list.loaded && list.sessions.length === 0 && list.nextBefore === null);
  const listed = !loading && list.sessions.length > 0;
  return (
    <div className="flex flex-col gap-10 text-body max-[760px]:gap-8">
      <h1 className="text-page-title max-[760px]:text-page-title-phone">Reports</h1>
      <div className="flex flex-col gap-4">
        {classes?.length ? <ClassTabs classes={classes} classId={classId} /> : null}
        {loading ? (
          <p role="status" className={WAIT_LINE}>
            Loading sessions…
          </p>
        ) : null}
        {failed ? (
          <div className={OOPS}>
            <TryAgain
              onRetry={() => onRead('newest')}
              held={list.reading === 'newest'}
              then={[tableId]}
            >
              <p role="alert" className="flex items-center gap-3">
                <CircleAlert size={18} aria-hidden="true" className="shrink-0" />
                Couldn&apos;t load the sessions. {failed.message}
              </p>
            </TryAgain>
          </div>
        ) : null}
        {none ? <p className={WAIT_LINE}>When a session ends, its report shows here.</p> : null}
        {listed ? <Share name={list.className ?? ''} list={list} /> : null}
      </div>

      {listed ? (
        <section aria-labelledby={sessionsId} className="flex flex-col gap-4">
          <h2 id={sessionsId} className="sr-only">
            Sessions, newest first
          </h2>
          {list.restarted ? (
            <p role="status" className={WAIT_LINE}>
              Bali lost your place in the list, so it starts again from the newest session.
            </p>
          ) : null}
          <Ledger id={tableId} labelledBy={sessionsId} classId={classId ?? ''} list={list} />
          {list.nextBefore === null ? null : (
            // Show earlier, and its Try again once a read of it failed, the line before it: one
            // button throughout, held as Loading… while it reads, so focus stays on it; gone with
            // the last page, it lands focus on the table.
            <div className={earlier ? 'flex flex-wrap items-center gap-x-4 gap-y-3' : undefined}>
              <TryAgain
                onRetry={() => onRead('earlier')}
                held={list.reading === 'earlier'}
                blocked={list.reading !== null}
                then={[tableId]}
                send={{ words: 'Show earlier', sending: 'Loading…', failed: earlier !== null }}
              >
                {earlier ? (
                  <p role="alert">Couldn&apos;t load earlier sessions. {earlier.message}</p>
                ) : null}
              </TryAgain>
            </div>
          )}
        </section>
      ) : null}
    </div>
  );
}

/**
 * The classes as tabs (lock.css's `.tabs`), the one picked marked by its ink and its rule, never by
 * colour alone; scrolling sideways when they outrun the page, with room in the box for the focus
 * ring.
 */
function ClassTabs({
  classes,
  classId,
}: {
  classes: { id: string; name: string }[];
  classId: string | null;
}) {
  return (
    <nav aria-label="Class" className="-m-1 overflow-x-auto p-1">
      <div className="flex w-max min-w-full gap-1 border-b border-border-default">
        {classes.map(({ id, name }) => (
          <Link
            key={id}
            href={`/reports?class=${encodeURIComponent(id)}`}
            aria-current={id === classId ? 'page' : undefined}
            className="-mb-px inline-flex min-h-10 items-center border-b-2 border-transparent px-3 text-nav whitespace-nowrap text-text-secondary hover:text-text-primary aria-[current=page]:border-text-primary aria-[current=page]:text-text-primary"
          >
            {name}
          </Link>
        ))}
      </div>
    </nav>
  );
}

/**
 * The share of the listed sessions' class time spent focused (`focusShare`), with Download CSV
 * beside it, which saves those sessions' totals (`sessionsCsv`); no share when nobody joined any,
 * the button alone (ReportsMoments).
 */
function Share({ name, list }: { name: string; list: SessionList }) {
  const share = focusShare(list.sessions);
  return (
    <div className="flex flex-wrap items-end justify-between gap-x-8 gap-y-4">
      {share === null ? null : (
        <p className="flex flex-wrap items-baseline gap-x-3">
          <span className="text-share tabular-nums">
            {new Intl.NumberFormat(undefined, { style: 'percent' }).format(share / 100)}
          </span>
          <span className="text-count-of text-text-secondary max-[760px]:text-count-of-phone">
            of class time spent focused
          </span>
        </p>
      )}
      <LockButton
        variant="secondary"
        onClick={() => saveFile(csvName(name), sessionsCsv(name, list))}
      >
        <Download size={16} aria-hidden="true" />
        Download CSV
      </LockButton>
    </div>
  );
}

/**
 * The sessions (lock.css's `.ledger`), a box of their own that scrolls sideways when the page is
 * narrower than they are: under 760 px at least 720 px wide, each cell on one line (PhonePages).
 */
function Ledger({
  id,
  labelledBy,
  classId,
  list,
}: {
  id: string;
  labelledBy: string;
  classId: string;
  list: SessionList;
}) {
  return (
    <div className="-m-1 overflow-x-auto p-1">
      <table
        id={id}
        aria-labelledby={labelledBy}
        className={`${LEDGER} max-[760px]:min-w-180 max-[760px]:[&_td]:whitespace-nowrap`}
      >
        <thead>
          <tr>
            <th scope="col" className={LEDGER_HEAD}>
              Session
            </th>
            {COLUMNS.map((column) => (
              <th key={column} scope="col" className={`${LEDGER_HEAD} text-right`}>
                {column}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {list.sessions.map((session) => (
            <SessionRow
              key={session.id}
              classId={classId}
              session={session}
              whole={list.wholeTime[session.id]}
            />
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * A session's row: its day, a link to its own page with its times under it, then its figures, its
 * average focus as words over a bar out of its length; Nobody joined across the three a session
 * nobody joined has none of, never zeros (R5).
 */
function SessionRow({
  classId,
  session,
  whole,
}: {
  classId: string;
  session: SessionReportSummary;
  /** How many stayed focused the whole time, once counted. */
  whole: number | undefined;
}) {
  const row = sessionRow(session);
  const bar = focusBar(session);
  const figure = `${LEDGER_CELL} text-right tabular-nums`;
  return (
    <tr>
      <th scope="row" className={`${LEDGER_CELL} text-left font-normal`}>
        <Link href={reportPath(classId, session.id)} className="group block rounded-xs">
          <span className="font-semibold text-text-primary underline-offset-3 group-hover:underline">
            {row.day}
            <span className="sr-only">,</span>
          </span>
          <span className={LEDGER_SUB}>{row.times}</span>
        </Link>
      </th>
      {row.figures && bar ? (
        <>
          <td className={figure}>{row.figures.joined}</td>
          <td className={figure}>
            {whole === undefined ? null : new Intl.NumberFormat().format(whole)}
          </td>
          <td className={figure}>
            <span className="flex items-center justify-end gap-3">
              {bar.words}
              <span
                aria-hidden="true"
                className="h-1.5 w-22 shrink-0 overflow-hidden rounded-full bg-surface-sunken"
              >
                <span
                  className="block h-full rounded-full bg-arc-fill"
                  style={{ width: `${bar.percent}%` }}
                />
              </span>
            </span>
          </td>
        </>
      ) : (
        <td colSpan={3} className={`${LEDGER_CELL} text-text-secondary`}>
          Nobody joined
        </td>
      )}
      <td className={figure}>{row.unlocks}</td>
      <td className={figure}>{row.protectionOffs}</td>
    </tr>
  );
}
