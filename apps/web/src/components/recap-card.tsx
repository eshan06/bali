'use client';

import type { SessionReportSummary as Summary } from '@bali/shared';
import { type ReactNode, useEffect, useId, useState } from 'react';

import { Button } from '@/components/button';
import { CARD_ALONE } from '@/components/card';
import { Timeline } from '@/components/timeline';
import { loadRecap, type RecapState, recapView, sessionTimes } from '@/lib/recap';
import { useApi } from '@/lib/use-api';

interface Props {
  classId: string;
  session?: Summary;
  present?: boolean;
  toggle?: ReactNode;
}

/**
 * The recap card (R4; the Recap & reports design): the class's last session, once the server has
 * marked it over, as R2 reports it and as its events tell it. The class page shows it while no
 * session runs, so a Start takes it away, and it reads the session each time it is shown. Its
 * figures, then the session as a timeline (`Timeline`): class aggregates and marks, never one
 * student's minutes. A card standing alone (DESIGN.md §4), laid out by its own width. Given a
 * `session` (R5's opened row), it reads that one inside the row's card, so it draws no card or
 * figures of its own (the row says them), and its heading is for screen readers. In `present` (the
 * class page's Present, which the class can see) every unlock is marked, never with its reason;
 * `toggle`, Present's own, goes at the end of its header.
 */
export function RecapCard(props: Props) {
  const api = useApi();
  const { classId, session } = props;
  const [state, setState] = useState<RecapState>({ kind: 'finding' });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let live = true;
    void loadRecap(api, classId, session, (next) => {
      if (live) setState(next);
    });
    return () => {
      live = false;
    };
  }, [api, classId, session, attempt]);

  // Nothing until there is a session to recap: a class that never ran one shows no card.
  if (state.kind === 'finding' || state.kind === 'none') return null;
  return (
    <RecapShown
      {...props}
      state={state}
      onRetry={() => {
        setState({ kind: 'loading', session: null });
        setAttempt((n) => n + 1);
      }}
    />
  );
}

/** The card as its state draws it, rendered on its own by the tests. */
export function RecapShown({
  session,
  present = false,
  toggle = null,
  state,
  onRetry,
}: Omit<Props, 'classId'> & {
  state: Exclude<RecapState, { kind: 'finding' | 'none' }>;
  onRetry: () => void;
}) {
  const headingId = useId();
  const which = session ? 'this session' : 'the last session';
  const shown = state.kind === 'error' ? null : state.session;
  return (
    <section
      aria-labelledby={headingId}
      aria-busy={state.kind === 'loading'}
      className={`@container ${session ? '' : CARD_ALONE}`}
    >
      {session ? (
        <h2 id={headingId} className="sr-only">
          {sessionTimes(session)}
        </h2>
      ) : (
        <div className="mb-5 flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
          <div className="flex flex-col gap-1">
            <h2 id={headingId} className="text-h3">
              Last session
            </h2>
            {shown ? <p className="text-body text-text-secondary">{sessionTimes(shown)}</p> : null}
          </div>
          {toggle}
        </div>
      )}
      {state.kind === 'loading' ? (
        <p role="status" className="text-body text-text-secondary">
          Loading {which}…
        </p>
      ) : state.kind === 'error' ? (
        <>
          <div role="alert" className="text-body">
            <p className="font-semibold">Couldn&apos;t load {which}.</p>
            <p className="text-text-secondary">{state.message}</p>
          </div>
          <Button variant="secondary" onClick={onRetry} className="mt-4">
            Try again
          </Button>
        </>
      ) : (
        <Recap state={state} opened={session !== undefined} present={present} />
      )}
    </section>
  );
}

function Recap({
  state,
  opened,
  present,
}: {
  state: Extract<RecapState, { kind: 'ready' }>;
  opened: boolean;
  present: boolean;
}) {
  const view = recapView(state.session, state.report, state.events, {}, present);
  return (
    <>
      {view.stats === null ? (
        <p className="text-body">Nobody joined this session.</p>
      ) : (
        <>
          {/* Two figures a row on a narrow card, four from the width where each label fits. */}
          {opened ? null : (
            <dl className="mb-3 grid grid-cols-2 gap-x-6 gap-y-4 @min-[40rem]:grid-cols-4">
              <Stat label="Joined" value={view.stats.joined} />
              <Stat label="Class focus time" value={view.stats.focus} unit="min" />
              <Stat label="Average per student" value={view.stats.average} unit="min" />
              <Stat label="Silent" value={view.stats.silent} unit="min" />
            </dl>
          )}
          <p className="text-caption text-text-tertiary dark:text-text-secondary">
            A phone is silent when it stops checking in. Silent time doesn&apos;t count as focus.
          </p>
        </>
      )}
      {/* Every unlock R2 lists has a row, so a session nobody joined still shows one. */}
      {view.timeline.rows.length > 0 ? (
        <Timeline view={view.timeline} label={`Timeline, ${sessionTimes(state.session)}`} />
      ) : null}
    </>
  );
}

/**
 * One of the class's figures, with no grey tile behind it (the owner, 2026-10-06): its name, then
 * the figure in `data-lg` at its foot, its unit beside it in `body`, so a row's figures line up
 * when one name wraps.
 */
function Stat({ label, value, unit }: { label: string; value: string; unit?: string }) {
  return (
    <div className="flex flex-col justify-between gap-1">
      <dt className="text-label text-text-tertiary dark:text-text-secondary uppercase">{label}</dt>
      <dd>
        <span className="font-num text-data-lg">{value}</span>
        {unit ? (
          <span className="ml-1 text-body font-medium text-text-secondary">{unit}</span>
        ) : null}
      </dd>
    </div>
  );
}
