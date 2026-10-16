'use client';

import type {
  FeedEvent,
  RosterStudent,
  SessionReportResponse,
  SessionReportSummary as Summary,
} from '@bali/shared';
import { ChartBar } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useId, useState } from 'react';

import { Button, buttonClass } from '@/components/button';
import { CARD_ALONE } from '@/components/card';
import { RecapLists } from '@/components/timeline';
import {
  classFigures,
  loadRecap,
  type RecapFormat,
  recapGroups,
  type RecapState,
  sessionTimes,
  type SessionWindow,
} from '@/lib/recap';
import { reportPath } from '@/lib/reports';
import { bellTime } from '@/lib/session-controls';
import { useApi } from '@/lib/use-api';

interface Props {
  classId: string;
  present?: boolean;
  /** The class page's roster (PV12b), who didn't join: null while it is read or when it failed. */
  roster?: readonly RosterStudent[] | null;
  rosterError?: string | null;
  onRetryRoster?: () => void;
  /** The session it found, for the page's line; null while none is. */
  onFound?: (session: Summary | null) => void;
}

/**
 * The recap card (R4; ClassEnded since PV12b): the class's last session, once the server has
 * marked it over, as R2 reports it and as its events tell it. The class page shows it while no
 * session runs, so a Start takes it away, and it reads the session each time it is shown. Its head
 * names the session, with Open its report, the session's own page (PV14); then its figures, who
 * wasn't focused the whole time, who was and who didn't join (`RecapBody`, who didn't join read
 * from the page's roster, whose failure it says too): class aggregates, moments and names, never
 * one student's minutes. A card standing alone (DESIGN.md §4), laid out by its own width. In
 * `present` (the projector, which the class can see) no unlock's reason is said.
 */
export function RecapCard(props: Props) {
  const api = useApi();
  const { classId, rosterError, onRetryRoster, onFound } = props;
  const [state, setState] = useState<RecapState>({ kind: 'finding' });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let live = true;
    void loadRecap(api, classId, (next) => {
      if (live) setState(next);
    });
    return () => {
      live = false;
    };
  }, [api, classId, attempt]);

  // The session found, for the page's line: none until one is, and none when its read failed.
  const found = state.kind === 'ready' || state.kind === 'loading' ? state.session : null;
  useEffect(() => {
    // A retry's read, finding its session again, changes nothing meanwhile.
    if (state.kind === 'loading' && found === null) return;
    onFound?.(found);
  }, [found, state.kind, onFound]);
  // Gone (a Start), none: the next session's end never paints with this one's.
  useEffect(() => () => onFound?.(null), [onFound]);

  // Nothing until there is a session to recap: a class that never ran one shows no card.
  if (state.kind === 'finding' || state.kind === 'none') return null;
  return (
    <RecapShown
      {...props}
      state={state}
      onRetry={() => {
        if (state.kind !== 'ready') {
          setState({ kind: 'loading', session: null });
          setAttempt((n) => n + 1);
        }
        if (rosterError) onRetryRoster?.();
      }}
    />
  );
}

/**
 * The page's line after the bell (ClassEnded), the time in "the session ended at 9:55 AM": the end
 * the server marked, when that was today on this computer's calendar. Null for none, and for an
 * older session, whose card says its day: the line then stays "no session running".
 */
export function endedToday(
  session: Summary | null,
  now = new Date(),
  format: RecapFormat = {},
): string | null {
  if (session === null) return null;
  const end = session.endedAt ?? session.endsAt;
  const day = new Intl.DateTimeFormat(format.locale, {
    dateStyle: 'short',
    timeZone: format.timeZone,
  });
  return day.format(new Date(end)) === day.format(now) ? bellTime(end, format) : null;
}

/** The card as its state draws it, rendered on its own by the tests. */
export function RecapShown({
  classId,
  present = false,
  roster = null,
  rosterError = null,
  state: read,
  onRetry,
}: Props & {
  state: Exclude<RecapState, { kind: 'finding' | 'none' }>;
  onRetry: () => void;
}) {
  const headingId = useId();
  // The card waits for the roster, and says its failure.
  const state: typeof read =
    read.kind !== 'ready' || roster !== null
      ? read
      : rosterError === null
        ? { kind: 'loading', session: read.session }
        : { kind: 'error', message: rosterError };
  const shown = state.kind === 'error' ? null : state.session;
  return (
    <section
      aria-labelledby={headingId}
      aria-busy={state.kind === 'loading'}
      className={`@container flex flex-col gap-4.5 ${CARD_ALONE}`}
    >
      {/* ClassEnded's head: the session, then Open its report beside it, under it on a phone
          (ReportPageStates, an intermediate state). */}
      <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3">
        <div className="flex flex-col gap-0.75">
          <h2 id={headingId} className="text-section-label text-text-tertiary uppercase">
            Last session
          </h2>
          {shown ? <p className="text-body font-semibold">{sessionTimes(shown)}</p> : null}
        </div>
        {state.kind === 'ready' ? (
          <Link
            href={reportPath(classId, state.session.id)}
            className={buttonClass('secondary', '', 'sm')}
          >
            <ChartBar size={16} aria-hidden="true" />
            Open its report
          </Link>
        ) : null}
      </div>
      {state.kind === 'loading' ? (
        <p role="status" className="text-body text-text-secondary">
          Loading the last session…
        </p>
      ) : state.kind === 'error' ? (
        <div>
          <div role="alert" className="text-body">
            <p className="font-semibold">Couldn&apos;t load the last session.</p>
            <p className="text-text-secondary">{state.message}</p>
          </div>
          <Button variant="secondary" onClick={onRetry} className="mt-3.5">
            Try again
          </Button>
        </div>
      ) : (
        <RecapBody
          session={state.session}
          report={state.report}
          events={state.events}
          roster={roster ?? []}
          present={present}
        />
      )}
    </section>
  );
}

/**
 * v2.css's `.stats`: each name over its figure, the unit beside the number. The recap's, and Home's
 * Last session (PV17c), each spaced as its board draws it.
 */
export function Figures({
  figures,
  className,
}: {
  figures: readonly (readonly [label: string, value: string])[];
  className: string;
}) {
  return (
    <dl className={`flex flex-wrap ${className}`}>
      {figures.map(([label, value]) => (
        <div key={label} className="flex flex-col gap-0.5">
          <dt className="text-tile-line font-normal text-text-tertiary">{label}</dt>
          <dd className="font-num text-h2">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

/**
 * A session's recap as ClassEnded and ReportOpened draw it, in the class page's card and on the
 * session's own page (PV14): the class's figures and the note on silence, then the three groups.
 * Nobody joined: that line alone, but for someone who never joined with an unlock or protection
 * off here, never hidden.
 */
export function RecapBody({
  session,
  report,
  events,
  roster,
  present = false,
}: {
  session: SessionWindow;
  report: SessionReportResponse;
  events: readonly FeedEvent[];
  roster: readonly RosterStudent[];
  present?: boolean;
}) {
  const groups = recapGroups(session, report, events, roster);
  const figures = classFigures(report.joined.length, report);
  const nobody = report.joined.length === 0;
  return (
    <>
      {nobody ? (
        <p className="text-body text-text-secondary">Nobody joined this session.</p>
      ) : (
        <>
          <Figures
            figures={[
              ['Joined', figures.joined],
              ['Class focus time', `${figures.focus} min`],
              ['Average per student', `${figures.average} min`],
              ['Silent', `${figures.silent} min`],
            ]}
            className="gap-x-10 gap-y-4"
          />
          <p className="text-caption text-text-tertiary">
            A phone is silent when it stops checking in. Silent time doesn&apos;t count as focus.
          </p>
          {report.unlocks.length === 0 ? (
            <p className="text-body text-text-secondary">No unlocks.</p>
          ) : null}
        </>
      )}
      {nobody && !groups.notJoined.some((s) => s.moments.length > 0) ? null : (
        <RecapLists groups={groups} present={present} />
      )}
    </>
  );
}
