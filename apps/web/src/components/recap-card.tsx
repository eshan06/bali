'use client';

import type { SessionReportSummary as Summary } from '@bali/shared';
import { useEffect, useId, useState } from 'react';

import { Button } from '@/components/button';
import {
  loadRecap,
  type RecapMoment,
  type RecapState,
  type RecapView,
  recapView,
  sessionTimes,
} from '@/lib/recap';
import { useApi } from '@/lib/use-api';

/** A figure's name and a list's heading: the `label` style, in the captions' ink. */
const LABEL = 'text-label text-text-tertiary uppercase';

/**
 * The recap card (R4; in Soft premium, D2g): the class's last session, once the server has marked
 * it over, as R2 reports it. The class page shows it while no session runs, so a Start takes it
 * away, and it reads the report each time it is shown. Class aggregates only: never one student's
 * minutes. A card standing alone (DESIGN.md §4): `radius-lg`, `space-6` padding, its figures in
 * `data-lg` on sunken tiles, laid out by the card's own width. Given a `session` (R5's opened row),
 * it reads that one's report inside the row's card, so it draws no card of its own, and its
 * heading is for screen readers. In `present` (the class page's Present, which the class can see)
 * it lists each unlock by who and when, never with its reason.
 */
export function RecapCard({
  classId,
  session,
  present = false,
}: {
  classId: string;
  session?: Summary;
  present?: boolean;
}) {
  const api = useApi();
  const headingId = useId();
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

  function retry() {
    setState({ kind: 'loading', session: null });
    setAttempt((n) => n + 1);
  }

  const which = session ? 'this session' : 'the last session';
  const shown = state.kind === 'error' ? null : state.session;
  return (
    <section
      aria-labelledby={headingId}
      aria-busy={state.kind === 'loading'}
      className={`@container ${session ? '' : 'rounded-lg border border-transparent bg-surface-card p-6 shadow-1 dark:border-border-default'}`}
    >
      <div
        className={
          session ? 'sr-only' : 'flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1'
        }
      >
        <h2 id={headingId} className="text-h3">
          {session ? sessionTimes(session) : 'Last session'}
        </h2>
        {shown && !session ? (
          <p className="text-caption text-text-tertiary tabular-nums">{sessionTimes(shown)}</p>
        ) : null}
      </div>
      {state.kind === 'loading' ? (
        <p role="status" className="mt-4 text-body text-text-secondary">
          Loading {which}…
        </p>
      ) : state.kind === 'error' ? (
        <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-3">
          <p role="alert" className="text-body">
            Couldn&apos;t load {which}. <span className="text-text-secondary">{state.message}</span>
          </p>
          <Button variant="secondary" onClick={retry}>
            Try again
          </Button>
        </div>
      ) : (
        <Recap view={recapView(state.report, {}, present)} />
      )}
    </section>
  );
}

function Recap({ view }: { view: RecapView }) {
  return (
    <>
      {view.stats === null ? (
        <p className="mt-4 text-body">Nobody joined this session.</p>
      ) : (
        <>
          {/* Two tiles a row on a narrow card, four from the width where each label fits. */}
          <dl className="mt-4 grid grid-cols-2 gap-3 @2xl:grid-cols-4">
            <Stat label="Joined" value={view.stats.joined} />
            <Stat label="Class focus time" value={view.stats.focus} />
            <Stat label="Average per student" value={view.stats.average} />
            <Stat label="Silent" value={view.stats.silent} />
          </dl>
          <p className="mt-3 text-caption text-text-tertiary">
            A phone is silent when it stops checking in. Silent time doesn&apos;t count as focus.
          </p>
          <h3 className={`mt-6 ${LABEL}`}>Who joined</h3>
          <ul className="mt-2 grid grid-cols-2 gap-x-6 gap-y-1 text-body @lg:grid-cols-3 @4xl:grid-cols-4 @6xl:grid-cols-6">
            {view.joined.map((s) => (
              <li key={s.key} className="min-w-0 break-words">
                {s.name}
              </li>
            ))}
          </ul>
        </>
      )}
      {/* Every unlock R2 lists is shown; "No unlocks." only where someone joined to have one. */}
      {view.stats !== null || view.unlocks.length > 0 ? (
        <Moments title="Unlocks" empty="No unlocks." moments={view.unlocks} />
      ) : null}
      {view.protectionOffs.length > 0 ? (
        <Moments title="Protection off" moments={view.protectionOffs} />
      ) : null}
    </>
  );
}

/**
 * One of the class's figures on its sunken tile: its name, then the figure in `data-lg`, at the
 * tile's foot, so a row's figures line up when one name wraps.
 */
function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col justify-between rounded-md bg-surface-sunken px-4 py-3">
      <dt className={LABEL}>{label}</dt>
      <dd className="mt-1 font-num text-data-lg tabular-nums">{value}</dd>
    </div>
  );
}

/** A list of moments, its columns lined up across rows: who, when, and an unlock's reason. */
function Moments({
  title,
  empty,
  moments,
}: {
  title: string;
  empty?: string;
  moments: RecapMoment[];
}) {
  return (
    <>
      <h3 className={`mt-6 ${LABEL}`}>{title}</h3>
      {moments.length === 0 ? (
        <p className="mt-2 text-body text-text-secondary">{empty}</p>
      ) : (
        <ul className="mt-1 grid grid-cols-[auto_auto_1fr] gap-x-6 text-body">
          {moments.map((m) => (
            <li
              key={m.key}
              className="col-span-3 grid grid-cols-subgrid border-b border-border-default py-2"
            >
              <span className="min-w-0 break-words">{m.name}</span>
              <span className="text-text-tertiary tabular-nums">{m.time}</span>
              <span className="text-text-secondary">{m.reason}</span>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
