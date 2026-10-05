'use client';

import type { SessionReportSummary as Summary } from '@bali/shared';
import { useEffect, useId, useState } from 'react';

import {
  loadRecap,
  type RecapMoment,
  type RecapState,
  type RecapView,
  recapView,
  sessionTimes,
} from '@/lib/recap';
import { useApi } from '@/lib/use-api';

/**
 * The recap card (R4): the class's last session, once the server has marked it over, as R2
 * reports it. The class page shows it while no session runs, so a Start takes it away, and it
 * reads the report each time it is shown. Class aggregates only: never one student's minutes.
 * Given a `session` (R5's opened row), it reads that one's report, its heading for screen readers.
 */
export function RecapCard({ classId, session }: { classId: string; session?: Summary }) {
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
      className="rounded-lg border border-slate-200 p-4 dark:border-slate-800"
    >
      <div
        className={
          session ? 'sr-only' : 'flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1'
        }
      >
        <h2 id={headingId} className="text-lg font-medium">
          {session ? sessionTimes(session) : 'Last session'}
        </h2>
        {shown && !session ? (
          <p className="text-sm text-slate-500 tabular-nums dark:text-slate-400">
            {sessionTimes(shown)}
          </p>
        ) : null}
      </div>
      {state.kind === 'loading' ? (
        <p role="status" className="mt-3 text-sm text-slate-500 dark:text-slate-400">
          Loading {which}…
        </p>
      ) : state.kind === 'error' ? (
        <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2">
          <p role="alert" className="text-sm">
            Couldn't load {which}.{' '}
            <span className="text-slate-600 dark:text-slate-300">{state.message}</span>
          </p>
          <button
            type="button"
            onClick={retry}
            className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm transition-colors hover:bg-slate-100 motion-reduce:transition-none dark:border-slate-700 dark:hover:bg-slate-900"
          >
            Try again
          </button>
        </div>
      ) : (
        <Recap view={recapView(state.report)} />
      )}
    </section>
  );
}

function Recap({ view }: { view: RecapView }) {
  return (
    <>
      {view.stats === null ? (
        <p className="mt-3 text-sm">Nobody joined this session.</p>
      ) : (
        <>
          <dl className="mt-4 grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-4">
            <Stat label="Joined" value={view.stats.joined} />
            <Stat label="Class focus time" value={view.stats.focus} />
            <Stat label="Average per student" value={view.stats.average} />
            <Stat label="Silent" value={view.stats.silent} />
          </dl>
          <p className="mt-3 text-xs text-slate-500 dark:text-slate-400">
            A phone is silent when it stops checking in. Silent time doesn't count as focus.
          </p>
          <h3 className="mt-5 text-sm text-slate-500 dark:text-slate-400">Who joined</h3>
          <ul className="mt-1 grid grid-cols-2 gap-x-6 gap-y-1 text-sm sm:grid-cols-3">
            {view.joined.map((s) => (
              <li key={s.key} className="break-words">
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

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-sm text-slate-500 dark:text-slate-400">{label}</dt>
      <dd className="mt-0.5 text-2xl font-semibold tabular-nums">{value}</dd>
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
      <h3 className="mt-5 text-sm text-slate-500 dark:text-slate-400">{title}</h3>
      {moments.length === 0 ? (
        <p className="mt-1 text-sm">{empty}</p>
      ) : (
        <ul className="mt-1 grid grid-cols-[auto_auto_1fr] gap-x-6 gap-y-1 text-sm">
          {moments.map((m) => (
            <li key={m.key} className="col-span-3 grid grid-cols-subgrid">
              <span className="min-w-0 break-words">{m.name}</span>
              <span className="text-slate-500 tabular-nums dark:text-slate-400">{m.time}</span>
              <span className="text-slate-600 dark:text-slate-300">{m.reason}</span>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
