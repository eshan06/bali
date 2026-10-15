'use client';

import type { SessionReportSummary } from '@bali/shared';
import Link from 'next/link';
import { useId } from 'react';

import { Button } from '@/components/button';
import { CARD_ALONE } from '@/components/card';
import { RecapCard } from '@/components/recap-card';
import { sessionWhen } from '@/lib/recap';
import { type ReadAt, type SessionList, sessionRow } from '@/lib/reports';

/** The figures' names, in the columns' order, after the session's own. */
export const COLUMNS = [
  'Joined',
  'Focus time',
  'Average',
  'Silent',
  'Unlocks',
  'Protection off',
] as const;

/** A section's name over its part, v2.css's `.wlabel`, 12 px above it. */
const LABEL = 'mb-3 text-section-label text-text-tertiary uppercase';
/** v2.css's `.wtable`: its head grey, each cell 16 px in, a hairline under every row but the last. */
const HEAD =
  'border-b border-border-default bg-surface-sunken px-4 py-2.75 text-section-label whitespace-nowrap text-text-tertiary uppercase';
const CELL = 'border-b border-border-default px-4 py-3 align-middle text-cell';
const FIGURE = `${CELL} text-right whitespace-nowrap`;

/**
 * A session's average focus as its bar (Reports): out of its length, its start to its end in whole
 * minutes, as the table says its times; null when nobody joined, who have no average.
 */
export function focusBar(
  session: SessionReportSummary,
  locale?: string,
): { words: string; percent: number } | null {
  const average = session.averageFocusMinutes;
  if (average === null) return null;
  const end = Date.parse(session.endedAt ?? session.endsAt);
  const length = Math.round((end - Date.parse(session.startedAt)) / 60_000);
  const n = new Intl.NumberFormat(locale);
  return {
    words: `${n.format(average)} of ${n.format(length)} min`,
    percent: length > 0 ? Math.min(100, (average / length) * 100) : 0,
  };
}

/**
 * The Reports page as its state draws it (Reports, ReportStates): the heading and its framing line
 * in italic, the class picked with pills, then that class's sessions, newest first, as a table in a
 * box that scrolls sideways, with Show earlier, beside each session's average focus as a bar. Every
 * state with its words: loading, couldn't load with Try again, none yet, the place lost, and
 * earlier sessions that didn't load. `classes` is null until the account is read.
 */
export function ReportsView({
  classes,
  classId,
  list,
  open,
  onToggle,
  onRead,
}: {
  classes: { id: string; name: string }[] | null;
  classId: string | null;
  list: SessionList;
  open: string | null;
  onToggle: (sessionId: string) => void;
  onRead: (at: ReadAt) => void;
}) {
  const sessionsId = useId();
  const loading = classId !== null && list.reading === 'newest';
  const none =
    (classes !== null && classId === null) ||
    (list.loaded && list.sessions.length === 0 && list.nextBefore === null);
  return (
    <main className="flex flex-col gap-5.5">
      <header>
        <h1 className="text-page-title">Reports</h1>
        {/* The italic class alone: `font-sans` would set the upright face, slanted (PV4). */}
        <p className="mt-1 text-body text-text-secondary italic">
          Patterns are conversation starters, not verdicts.
        </p>
      </header>

      {classes?.length ? (
        <nav aria-label="Class" className="flex flex-wrap gap-2">
          {classes.map(({ id, name }) => (
            <Link
              key={id}
              href={`/reports?class=${encodeURIComponent(id)}`}
              aria-current={id === classId ? 'page' : undefined}
              className="rounded-full border border-border-strong bg-surface-card px-3.5 py-1.5 text-pill text-text-secondary aria-[current=page]:border-surface-brand aria-[current=page]:bg-surface-brand aria-[current=page]:font-semibold aria-[current=page]:text-text-on-brand"
            >
              {name}
            </Link>
          ))}
        </nav>
      ) : null}

      <div>
        {/* Mounted throughout, so a screen reader hears what it comes to say. */}
        <div role="status">
          {loading ? (
            <p className="text-body text-text-secondary">Loading sessions…</p>
          ) : list.restarted ? (
            <p className="mb-5.5 rounded-sm border border-border-default bg-surface-sunken px-4 py-3 text-body">
              Bali lost your place in the list, so it starts again from the newest session.
            </p>
          ) : null}
        </div>

        {list.failure?.at === 'newest' ? (
          <div className={CARD_ALONE}>
            <p role="alert" className="text-body">
              <span className="block font-semibold">Couldn&apos;t load the sessions.</span>
              <span className="text-text-secondary">{list.failure.message}</span>
            </p>
            <Button variant="secondary" onClick={() => onRead('newest')} className="mt-3.5">
              Try again
            </Button>
          </div>
        ) : null}

        {none ? (
          <p className="flex flex-col text-body text-text-secondary">
            <span className="font-semibold text-text-primary">No reports yet.</span>
            <span>When a session ends, its report shows here.</span>
          </p>
        ) : null}

        {!loading && list.sessions.length > 0 ? (
          <div className="flex flex-wrap items-start gap-5">
            <section
              aria-labelledby={sessionsId}
              className="flex min-w-0 flex-[999_1_520px] flex-col gap-5"
            >
              <h2 id={sessionsId} className={LABEL}>
                Sessions · {list.className}
              </h2>
              <SessionsTable
                classId={classId ?? ''}
                sessions={list.sessions}
                open={open}
                onToggle={onToggle}
              />
              {list.nextBefore === null ? null : list.failure?.at === 'earlier' ? (
                <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-3">
                  <p role="alert" className="text-body">
                    Couldn&apos;t load earlier sessions. {list.failure.message}
                  </p>
                  <Button variant="secondary" size="sm" onClick={() => onRead('earlier')}>
                    Try again
                  </Button>
                </div>
              ) : (
                <div className="mt-3">
                  {/* Held, not disabled, while it reads: focus stays on it. */}
                  <Button
                    variant="secondary"
                    size="sm"
                    aria-disabled={list.reading !== null}
                    onClick={() => {
                      if (list.reading === null) onRead('earlier');
                    }}
                  >
                    {list.reading === 'earlier' ? 'Loading…' : 'Show earlier'}
                  </Button>
                </div>
              )}
            </section>
            <FocusBars sessions={list.sessions} />
          </div>
        ) : null}
      </div>
    </main>
  );
}

/**
 * The sessions as v2.css's table, in a box that scrolls sideways when the page is narrower than
 * it (DESIGN.md §8). Until a session has a page of its own (PV14), its row opens its report under
 * it, as the reports list did, kept in view in the box as it scrolls.
 */
export function SessionsTable({
  classId,
  sessions,
  open,
  onToggle,
}: {
  classId: string;
  sessions: SessionReportSummary[];
  open: string | null;
  onToggle: (sessionId: string) => void;
}) {
  return (
    <div className="@container overflow-x-auto rounded-frame border border-border-default bg-surface-card">
      <table aria-label="Sessions, newest first" className="w-full border-collapse">
        <thead>
          <tr>
            <th scope="col" className={`${HEAD} text-left`}>
              Session
            </th>
            {COLUMNS.map((name) => (
              <th key={name} scope="col" className={`${HEAD} text-right`}>
                {name}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="[&>tr:last-child>*]:border-b-0">
          {sessions.map((session) => {
            const row = sessionRow(session);
            const isOpen = open === session.id;
            const recap = `recap-${session.id}`;
            return [
              <tr key={session.id} className={isOpen ? 'bg-row-open' : undefined}>
                <th scope="row" className={`${CELL} text-left font-normal`}>
                  <button
                    type="button"
                    aria-expanded={isOpen}
                    aria-controls={isOpen ? recap : undefined}
                    onClick={() => onToggle(session.id)}
                    className="group cursor-pointer rounded-sm text-left"
                  >
                    <span className="block font-semibold underline-offset-2 group-hover:underline">
                      {row.day}
                      <span className="sr-only">,</span>
                    </span>
                    <span className="block text-cell-sub text-text-tertiary">{row.times}</span>
                  </button>
                </th>
                {row.figures ? (
                  <>
                    <td className={FIGURE}>{row.figures.joined}</td>
                    <td className={FIGURE}>{row.figures.focus} min</td>
                    <td className={FIGURE}>{row.figures.average} min</td>
                    <td className={FIGURE}>{row.figures.silent} min</td>
                  </>
                ) : (
                  // No zeros for a session nobody joined, as its recap says (R5).
                  <td colSpan={4} className={`${CELL} text-text-secondary`}>
                    Nobody joined
                  </td>
                )}
                <td className={FIGURE}>{row.unlocks}</td>
                <td className={FIGURE}>{row.protectionOffs}</td>
              </tr>,
              isOpen ? (
                <tr key={recap} id={recap}>
                  <td colSpan={COLUMNS.length + 1} className={CELL}>
                    {/* The box's width, held at its left as the table scrolls under it. */}
                    <div className="sticky left-4 w-[calc(100cqw-2rem)]">
                      <RecapCard classId={classId} session={session} />
                    </div>
                  </td>
                </tr>
              ) : null,
            ];
          })}
        </tbody>
      </table>
    </div>
  );
}

/**
 * Each session's average focus as a bar out of its length, newest first as the table is; a
 * session nobody joined has none. Nothing at all when no session has one.
 */
export function FocusBars({ sessions }: { sessions: SessionReportSummary[] }) {
  const headingId = useId();
  const bars = sessions.flatMap((session) => {
    const bar = focusBar(session);
    return bar ? [{ session, bar }] : [];
  });
  if (bars.length === 0) return null;
  return (
    <section aria-labelledby={headingId} className="flex min-w-0 flex-[1_1_320px] flex-col gap-5">
      <h2 id={headingId} className={LABEL}>
        Average focus per session
      </h2>
      <div className={CARD_ALONE}>
        <ul className="grid grid-cols-[116px_minmax(0,1fr)_minmax(70px,max-content)] gap-3 text-bar-row">
          {bars.map(({ session, bar }) => (
            <li key={session.id} className="col-span-3 grid grid-cols-subgrid items-center">
              <span>
                {sessionWhen(session).day}
                <span className="sr-only">,</span>
              </span>
              <span
                aria-hidden="true"
                className="h-2.5 overflow-hidden rounded-full bg-surface-sunken"
              >
                <span
                  className="block h-full rounded-full bg-surface-brand"
                  style={{ width: `${bar.percent}%` }}
                />
              </span>
              <span className="text-right text-text-secondary">{bar.words}</span>
            </li>
          ))}
        </ul>
        <p className="mt-3.5 text-caption text-text-tertiary">
          Out of each session&apos;s length. Averages only: Bali never ranks students.
        </p>
      </div>
    </section>
  );
}
