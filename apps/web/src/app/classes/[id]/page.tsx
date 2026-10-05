'use client';

import type { ClassDetail, RosterResponse, SessionView, StartSessionResponse } from '@bali/shared';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useCallback, useEffect, useId, useRef, useState } from 'react';

import { getAccessToken } from '@/lib/auth';
import { errText, NOT_A_SESSION_LENGTH } from '@/lib/errors';
import {
  bellTime,
  DEFAULT_MINUTES,
  EXTEND_PRESETS,
  type ExtendAnswer,
  type ExtendAttempt,
  extendAttemptFor,
  extendSession,
  laterBell,
  LENGTH_PRESETS,
  parseMinutes,
  rememberedMinutes,
  rememberMinutes,
} from '@/lib/session-controls';
import { useApi } from '@/lib/use-api';
import { LiveGrid } from '@/components/live-grid';
import { RecapCard } from '@/components/recap-card';

const SECONDARY =
  'rounded-lg border border-slate-300 px-3 py-1.5 text-sm transition-colors hover:bg-slate-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-600 disabled:opacity-50 motion-reduce:transition-none dark:border-slate-700 dark:hover:bg-slate-900';

/** A length's pill: the radio inside it is read by screen readers, the label shows its state. */
const PILL =
  'cursor-pointer rounded-lg border border-slate-300 px-3 py-1.5 text-sm tabular-nums transition-colors select-none hover:bg-slate-100 has-checked:border-emerald-700 has-checked:bg-emerald-50 has-checked:font-semibold has-checked:text-emerald-900 has-focus-visible:outline-2 has-focus-visible:outline-offset-2 has-focus-visible:outline-emerald-600 motion-reduce:transition-none dark:border-slate-700 dark:hover:bg-slate-900 dark:has-checked:border-emerald-500 dark:has-checked:bg-emerald-950 dark:has-checked:text-emerald-100';

export default function ClassDetailPage() {
  const api = useApi();
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const classId = params.id;
  const id = useId();

  const [klass, setKlass] = useState<ClassDetail | null>(null);
  const [roster, setRoster] = useState<RosterResponse | null>(null);
  // The session the grid shows: running, or over, kept under the recap card until the next Start.
  // Its bell comes with the Start's answer, an extend's, or the grid's snapshots (a reload).
  const [grid, setGrid] = useState<{ id: string; over: boolean; endsAt: string | null } | null>(
    null,
  );
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // The next session's length (P10): a preset, or Other with the minutes typed under it.
  const [pick, setPick] = useState<number | 'other'>(DEFAULT_MINUTES);
  const [other, setOther] = useState('');
  const [lengthSaid, setLengthSaid] = useState(false);
  const otherField = useRef<HTMLInputElement>(null);
  // Extend (P10): the last attempt whose answer never came, resent by Try again; what was said.
  const unanswered = useRef<ExtendAttempt | null>(null);
  const [extendSaid, setExtendSaid] = useState<Exclude<ExtendAnswer, { kind: 'extended' }> | null>(
    null,
  );

  const load = useCallback(() => {
    setError(null);
    api.get<ClassDetail>(`/v1/classes/${classId}`).then(
      (c) => {
        setKlass(c);
        // Recover the live grid across a reload. `grid` is otherwise seeded
        // only by the Start response, so refreshing mid-lesson dropped the grid
        // and offered to start a session that was already running — which reads
        // as the session having ended.
        setGrid(
          (cur) =>
            cur ?? (c.liveSessionId ? { id: c.liveSessionId, over: false, endsAt: null } : null),
        );
      },
      (e: unknown) => setError(errText(e)),
    );
    api
      .get<RosterResponse>(`/v1/classes/${classId}/roster`)
      .then(setRoster, (e: unknown) => setError(errText(e)));
  }, [api, classId]);

  useEffect(() => {
    if (!getAccessToken()) {
      router.replace('/login');
      return;
    }
    load();
  }, [load, router]);

  // The class's last pick on this computer, read once the page is in the browser (never at render,
  // where the server has no storage); a length that isn't a preset reopens Other with it.
  useEffect(() => {
    const minutes = rememberedMinutes(classId);
    if (minutes === null) return;
    if (LENGTH_PRESETS.some((preset) => preset === minutes)) setPick(minutes);
    else {
      setPick('other');
      setOther(String(minutes));
    }
  }, [classId]);

  // The grid says when the server marks its session over (the bell's sweep, an End from another
  // tab or a phone), and the recap card goes above it. Only that session's end changes anything.
  const onEnded = useCallback((ended: string) => {
    setGrid((cur) => (cur?.id === ended ? { ...cur, over: true } : cur));
  }, []);

  // The bell, from an answer or a snapshot: only later, never back (the window never shrinks).
  const onSession = useCallback((session: SessionView) => {
    setGrid((cur) => {
      if (cur?.id !== session.id) return cur;
      const endsAt = laterBell(cur.endsAt, session.endsAt);
      return endsAt === cur.endsAt ? cur : { ...cur, endsAt };
    });
  }, []);

  const minutes = pick === 'other' ? parseMinutes(other) : pick;

  function startSession(e: React.FormEvent) {
    e.preventDefault();
    if (minutes === null) {
      setLengthSaid(true);
      otherField.current?.focus();
      return;
    }
    rememberMinutes(classId, minutes);
    setBusy(true);
    api
      .post<StartSessionResponse>(`/v1/classes/${classId}/sessions`, { durationMinutes: minutes })
      .then(
        (res) => {
          setBusy(false);
          unanswered.current = null;
          setExtendSaid(null);
          setGrid({ id: res.session.id, over: false, endsAt: res.session.endsAt });
        },
        (e: unknown) => {
          setBusy(false);
          setError(errText(e));
        },
      );
  }

  function endSession() {
    if (!grid) return;
    const ending = grid.id;
    setBusy(true);
    api.post(`/v1/sessions/${ending}/end`).then(
      () => {
        setBusy(false);
        onEnded(ending);
      },
      (e: unknown) => {
        setBusy(false);
        setError(errText(e));
      },
    );
  }

  async function addTime(attempt: ExtendAttempt) {
    if (!grid) return;
    const session = grid.id;
    setBusy(true);
    setExtendSaid(null);
    const answer = await extendSession(api, session, attempt);
    unanswered.current = answer.kind === 'failed' ? attempt : null;
    setBusy(false);
    if (answer.kind === 'extended') onSession({ id: session, classId, endsAt: answer.endsAt });
    else setExtendSaid(answer);
  }

  return (
    <main className="mx-auto max-w-3xl px-4 py-10">
      <nav className="flex justify-between gap-4 text-sm">
        <Link href="/" className="text-slate-500 hover:underline">
          ← All classes
        </Link>
        <Link
          href={`/classes/${classId}/reports`}
          className="font-medium text-emerald-700 hover:underline dark:text-emerald-400"
        >
          Reports →
        </Link>
      </nav>

      <div className="mt-4 flex flex-wrap items-baseline justify-between gap-2">
        <h1 className="text-2xl font-semibold">{klass?.name ?? '…'}</h1>
        {klass ? (
          <p className="text-sm text-slate-500">
            Join code: <span className="font-mono font-medium">{klass.joinCode}</span>
          </p>
        ) : null}
      </div>

      {error ? <p className="mt-4 text-sm text-red-600">{error}</p> : null}

      <div className="mt-6">
        {grid === null || grid.over ? (
          <div className="space-y-6">
            {/* noValidate: the length is checked here and said in Bali's words under the field,
                never by the browser's own bubble over the number input. */}
            <form onSubmit={startSession} noValidate className="space-y-4">
              <fieldset>
                <legend className="text-sm font-medium">Session length</legend>
                <div className="mt-2 flex flex-wrap gap-2">
                  {[...LENGTH_PRESETS, 'other' as const].map((option) => (
                    <label key={option} className={PILL}>
                      <input
                        type="radio"
                        name="session-length"
                        value={option}
                        checked={pick === option}
                        onChange={() => {
                          setPick(option);
                          setLengthSaid(false);
                        }}
                        className="sr-only"
                      />
                      {option === 'other' ? 'Other…' : `${option} min`}
                    </label>
                  ))}
                </div>
                {pick === 'other' ? (
                  <div className="mt-3">
                    <label htmlFor={`${id}-minutes`} className="block text-sm font-medium">
                      Minutes
                    </label>
                    <input
                      ref={otherField}
                      id={`${id}-minutes`}
                      name="minutes"
                      type="number"
                      inputMode="numeric"
                      autoComplete="off"
                      min={1}
                      max={480}
                      step={1}
                      value={other}
                      onChange={(e) => {
                        setOther(e.target.value);
                        setLengthSaid(false);
                      }}
                      readOnly={busy}
                      aria-invalid={lengthSaid}
                      aria-describedby={`${id}-help${lengthSaid ? ` ${id}-said` : ''}`}
                      className="mt-2 w-28 rounded-lg border border-slate-300 px-3 py-2 text-sm tabular-nums focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-600 aria-[invalid=true]:border-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:aria-[invalid=true]:border-slate-100"
                    />
                    <p
                      id={`${id}-help`}
                      className="mt-2 text-sm text-slate-500 dark:text-slate-400"
                    >
                      A whole number from 1 to 480.
                    </p>
                  </div>
                ) : null}
                {lengthSaid ? (
                  <p id={`${id}-said`} role="alert" className="mt-3 text-sm font-medium">
                    {NOT_A_SESSION_LENGTH}
                  </p>
                ) : null}
              </fieldset>
              <button
                type="submit"
                disabled={busy}
                className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
              >
                {minutes === null ? 'Start session' : `Start ${minutes}-minute session`}
              </button>
            </form>
            {/* The last session's recap (R4) until a new one starts; only once the class is read,
                so a session already running never shows it. */}
            {klass ? <RecapCard classId={classId} /> : null}
            {/* As it ended, until the next Start (R5): who was still unlocked stays in view. */}
            {grid ? (
              <section className="space-y-4">
                <h2 className="text-lg font-medium">How it ended</h2>
                <LiveGrid sessionId={grid.id} />
              </section>
            ) : null}
          </div>
        ) : (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2">
              <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                <h2 className="text-lg font-medium">Live grid</h2>
                {grid.endsAt ? (
                  <p className="text-sm text-slate-500 tabular-nums dark:text-slate-400">
                    Ends at <time dateTime={grid.endsAt}>{bellTime(grid.endsAt)}</time>
                  </p>
                ) : null}
              </div>
              <div className="flex flex-wrap gap-2">
                {EXTEND_PRESETS.map((add) => (
                  <button
                    key={add}
                    type="button"
                    onClick={() => void addTime(extendAttemptFor(unanswered.current, add))}
                    disabled={busy}
                    className={`${SECONDARY} tabular-nums`}
                  >
                    +{add} min
                  </button>
                ))}
                <button type="button" onClick={endSession} disabled={busy} className={SECONDARY}>
                  End session
                </button>
              </div>
            </div>
            {extendSaid ? (
              <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                <p role="alert" className="text-sm font-medium">
                  {extendSaid.message}
                </p>
                {extendSaid.kind === 'failed' ? (
                  <button
                    type="button"
                    onClick={() => {
                      const again = unanswered.current;
                      if (again) void addTime(again);
                    }}
                    disabled={busy}
                    className={SECONDARY}
                  >
                    Try again
                  </button>
                ) : null}
              </div>
            ) : null}
            <LiveGrid sessionId={grid.id} onEnded={onEnded} onSession={onSession} />
          </div>
        )}
      </div>

      <section className="mt-10">
        <h2 className="mb-2 text-lg font-medium">Roster</h2>
        {roster === null ? (
          <p className="text-sm text-slate-500">Loading…</p>
        ) : roster.students.length === 0 ? (
          <p className="text-sm text-slate-500">No students have joined yet.</p>
        ) : (
          <ul className="divide-y divide-slate-200 text-sm dark:divide-slate-800">
            {roster.students.map((s) => (
              <li key={s.enrollmentId} className="py-2">
                {s.displayName ?? s.studentId.slice(0, 8)}
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
