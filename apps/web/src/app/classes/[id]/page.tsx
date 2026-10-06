'use client';

import {
  type ClassDetail,
  MAX_SESSION_MINUTES,
  type RosterResponse,
  type SessionView,
  type StartSessionResponse,
} from '@bali/shared';
import { ArrowLeft, ArrowRight, Check, Presentation } from 'lucide-react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useCallback, useEffect, useId, useRef, useState } from 'react';

import { Button } from '@/components/button';
import { Field } from '@/components/field';
import { JoinCode } from '@/components/join-code';
import { LiveGrid } from '@/components/live-grid';
import { RecapCard } from '@/components/recap-card';
import { EMPTY_TRAY } from '@/components/tray';
import { getAccessToken } from '@/lib/auth';
import { errText, NOT_A_SESSION_LENGTH, SESSION_ALREADY_RUNNING } from '@/lib/errors';
import {
  bellTime,
  DEFAULT_MINUTES,
  EXTEND_PRESETS,
  type ExtendAttempt,
  extendAttemptFor,
  extendSession,
  keepUnanswered,
  laterBell,
  LENGTH_PRESETS,
  parseMinutes,
  pickFor,
  rememberedMinutes,
  rememberMinutes,
} from '@/lib/session-controls';
import { useApi } from '@/lib/use-api';

/**
 * The page's column: as wide as D2a's B artboard drew it (1400 px), since the live grid is its
 * main object and six columns need the room; 40 px gutters from the desktop width (§5).
 */
const PAGE = 'mx-auto max-w-[1400px] px-4 pt-10 pb-16 sm:px-10';

/** A link across the portal (back to the classes, on to reports): brand ink and an arrow. */
const NAV_LINK =
  'inline-flex items-center gap-2 rounded-xs text-body font-semibold text-text-brand underline-offset-2 hover:underline';

/**
 * A length in the picker's tray, the radio inside it read by screen readers and clipped away, so
 * the focus ring is drawn on the label for it. The pick is raised out of the sunken tray as a card
 * is, its words semibold in the primary ink: never by colour alone.
 */
const LENGTH =
  'inline-flex h-8 cursor-pointer items-center rounded-full border border-transparent px-4 text-body text-text-secondary tabular-nums transition-colors select-none hover:text-text-primary has-checked:bg-surface-card has-checked:font-semibold has-checked:text-text-primary has-checked:shadow-1 has-focus-visible:outline-2 has-focus-visible:outline-offset-2 has-focus-visible:outline-focus-ring dark:has-checked:border-border-default';

/**
 * A class's page (in Soft premium, D2f): its name and join code; while no session runs, the length
 * picker and Start, the last session's recap and how it ended; while one runs, the live grid with
 * its bell, Present, Extend and End; then the roster. Each failure is said where it happened.
 */
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
  // The class or its roster didn't load: said under the name, with Try again.
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // A Start, an End or an extend under way: a second press before the page redraws sends nothing.
  const sending = useRef(false);
  // The next session's length (P10): a preset, or Other with the minutes typed under it.
  const [pick, setPick] = useState<number | 'other'>(DEFAULT_MINUTES);
  const [other, setOther] = useState('');
  const [lengthSaid, setLengthSaid] = useState(false);
  const otherField = useRef<HTMLInputElement>(null);
  // A Start that failed, said under its button; the button sends it again.
  const [startSaid, setStartSaid] = useState<string | null>(null);
  // The projector view (DESIGN.md §5), toggled in the grid's header.
  const [present, setPresent] = useState(false);
  // Extend (P10): the last attempt whose answer never came, resent by Try again; and what is said
  // beside the grid: a failure (with Try again), a refusal or an End that failed (its button is
  // the retry), or a note on the session shown.
  const unanswered = useRef<ExtendAttempt | null>(null);
  const [said, setSaid] = useState<{ kind: 'failed' | 'refused' | 'note'; message: string } | null>(
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
    const remembered = pickFor(rememberedMinutes(classId));
    setPick(remembered.pick);
    setOther(remembered.other);
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

  // A bell that moved settles an extend whose answer never came: the lost one landed, or another
  // tab's did, and either way the truth is on screen. The failure line goes, and the next press
  // is a fresh one, never a resend that would add nothing. A refusal or a note stays said.
  const bell = grid?.endsAt ?? null;
  useEffect(() => {
    unanswered.current = null;
    setSaid((cur) => (cur?.kind === 'failed' ? null : cur));
  }, [bell]);

  const minutes = pick === 'other' ? parseMinutes(other) : pick;

  /** Run `send` unless one is under way, the page busy until it settles. */
  async function once(send: () => Promise<void>) {
    if (sending.current) return;
    sending.current = true;
    setBusy(true);
    try {
      await send();
    } finally {
      sending.current = false;
      setBusy(false);
    }
  }

  function startSession(e: React.FormEvent) {
    e.preventDefault();
    if (minutes === null) {
      setLengthSaid(true);
      otherField.current?.focus();
      return;
    }
    void once(async () => {
      rememberMinutes(classId, minutes);
      setStartSaid(null);
      try {
        const res = await api.post<StartSessionResponse>(`/v1/classes/${classId}/sessions`, {
          durationMinutes: minutes,
        });
        setGrid({ id: res.session.id, over: false, endsAt: res.session.endsAt });
        // `existing`: a session was running already (another tab's, a phone's), so the length
        // picked here set nothing; said, since the bell shown is that session's.
        setSaid(
          res.outcome === 'existing' ? { kind: 'note', message: SESSION_ALREADY_RUNNING } : null,
        );
      } catch (err) {
        setStartSaid(errText(err));
      }
    });
  }

  function endSession() {
    if (!grid) return;
    const ending = grid.id;
    void once(async () => {
      setSaid(null);
      try {
        await api.post(`/v1/sessions/${ending}/end`);
        onEnded(ending);
      } catch (err) {
        // Said beside the controls; End itself sends it again.
        setSaid({ kind: 'refused', message: errText(err) });
      }
    });
  }

  function addTime(attempt: ExtendAttempt) {
    if (!grid) return;
    const session = grid.id;
    void once(async () => {
      setSaid(null);
      const answer = await extendSession(api, session, attempt);
      unanswered.current = keepUnanswered(attempt, answer);
      if (answer.kind === 'extended') onSession({ id: session, classId, endsAt: answer.endsAt });
      else setSaid(answer);
    });
  }

  return (
    <main className={PAGE}>
      <nav aria-label="Class" className="flex justify-between gap-4">
        <Link href="/" className={NAV_LINK}>
          <ArrowLeft size={16} aria-hidden="true" />
          All classes
        </Link>
        <Link href={`/classes/${classId}/reports`} className={NAV_LINK}>
          Reports
          <ArrowRight size={16} aria-hidden="true" />
        </Link>
      </nav>

      <header className="mt-6 flex flex-wrap items-start justify-between gap-x-8 gap-y-4">
        <h1 className="min-w-0 text-h1 text-balance break-words">{klass?.name ?? '…'}</h1>
        {klass ? <JoinCode classId={classId} code={klass.joinCode} onClass={setKlass} /> : null}
      </header>

      {error ? (
        <div className="mt-6 flex flex-wrap items-center gap-x-4 gap-y-3">
          <p role="alert" className="text-body">
            Couldn&apos;t load this class. <span className="text-text-secondary">{error}</span>
          </p>
          <Button variant="secondary" onClick={load}>
            Try again
          </Button>
        </div>
      ) : null}

      <div className="mt-10">
        {grid === null || grid.over ? (
          <div className="flex flex-col gap-10">
            {/* noValidate: the length is checked here and said in Bali's words under the field,
                never by the browser's own bubble over the number input. */}
            <form onSubmit={startSession} noValidate className="flex flex-col items-start gap-6">
              <fieldset>
                <legend className="text-body font-medium">Session length</legend>
                <div className="mt-3 inline-flex gap-1 rounded-full bg-surface-sunken p-1">
                  {[...LENGTH_PRESETS, 'other' as const].map((option) => (
                    <label key={option} className={LENGTH}>
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
                  <div className="mt-4 max-w-xs">
                    <Field
                      ref={otherField}
                      id={`${id}-minutes`}
                      label="Minutes"
                      help={`A whole number from 1 to ${MAX_SESSION_MINUTES}.`}
                      name="minutes"
                      type="number"
                      inputMode="numeric"
                      autoComplete="off"
                      min={1}
                      max={MAX_SESSION_MINUTES}
                      step={1}
                      value={other}
                      onChange={(e) => {
                        setOther(e.target.value);
                        setLengthSaid(false);
                      }}
                      readOnly={busy}
                      aria-invalid={lengthSaid}
                      aria-describedby={lengthSaid ? `${id}-said` : undefined}
                    />
                  </div>
                ) : null}
                {lengthSaid ? (
                  <p id={`${id}-said`} role="alert" className="mt-3 text-body">
                    {NOT_A_SESSION_LENGTH}
                  </p>
                ) : null}
              </fieldset>
              <div>
                {/* One button throughout, so focus stays on it whatever it comes to say. */}
                <Button type="submit" aria-disabled={busy} aria-busy={busy}>
                  {busy
                    ? 'Starting…'
                    : minutes === null
                      ? 'Start session'
                      : `Start ${minutes}-minute session`}
                </Button>
                {startSaid ? (
                  <p role="alert" className="mt-3 text-body">
                    {startSaid}
                  </p>
                ) : null}
              </div>
            </form>
            {/* The last session's recap (R4) until a new one starts; only once the class is read,
                so a session already running never shows it. */}
            {klass ? <RecapCard classId={classId} /> : null}
            {/* As it ended, until the next Start (R5): who was still unlocked stays in view. */}
            {grid ? (
              <section aria-labelledby={`${id}-ended`} className="flex flex-col gap-4">
                <h2 id={`${id}-ended`} className="text-h2">
                  How it ended
                </h2>
                <LiveGrid sessionId={grid.id} />
              </section>
            ) : null}
          </div>
        ) : (
          <section aria-labelledby={`${id}-live`} className="flex flex-col gap-4">
            <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3">
              <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                <h2 id={`${id}-live`} className="text-h2">
                  Live grid
                </h2>
                {grid.endsAt ? (
                  <p className="text-body text-text-secondary tabular-nums">
                    Ends at <time dateTime={grid.endsAt}>{bellTime(grid.endsAt)}</time>
                  </p>
                ) : null}
              </div>
              <div className="flex flex-wrap gap-2">
                {/* Pressed is shown by its check and its sunken fill, never by colour alone. */}
                <Button
                  variant="secondary"
                  aria-pressed={present}
                  onClick={() => setPresent((on) => !on)}
                  className="aria-pressed:border-text-primary aria-pressed:bg-surface-sunken"
                >
                  {present ? (
                    <Check size={16} aria-hidden="true" />
                  ) : (
                    <Presentation size={16} aria-hidden="true" />
                  )}
                  Present
                </Button>
                {EXTEND_PRESETS.map((add) => (
                  <Button
                    key={add}
                    variant="secondary"
                    onClick={() => addTime(extendAttemptFor(unanswered.current, add))}
                    aria-disabled={busy}
                    className="tabular-nums"
                  >
                    +{add} min
                  </Button>
                ))}
                <Button variant="secondary" onClick={endSession} aria-disabled={busy}>
                  End session
                </Button>
              </div>
            </div>
            {said ? (
              <div className="flex flex-wrap items-center gap-x-4 gap-y-3">
                <p role={said.kind === 'note' ? 'status' : 'alert'} className="text-body">
                  {said.message}
                </p>
                {said.kind === 'failed' ? (
                  <Button
                    variant="secondary"
                    onClick={() => {
                      const again = unanswered.current;
                      if (again) addTime(again);
                    }}
                    aria-disabled={busy}
                  >
                    Try again
                  </Button>
                ) : null}
              </div>
            ) : null}
            <LiveGrid
              sessionId={grid.id}
              onEnded={onEnded}
              onSession={onSession}
              present={present}
            />
          </section>
        )}
      </div>

      <section
        aria-labelledby={`${id}-roster`}
        className="mt-12 border-t border-border-default pt-10"
      >
        <h2 id={`${id}-roster`} className="text-h2">
          Roster
        </h2>
        {roster === null ? (
          <p role="status" className="mt-4 text-body text-text-secondary">
            Loading…
          </p>
        ) : roster.students.length === 0 ? (
          <p className={`mt-6 text-body ${EMPTY_TRAY}`}>No students have joined yet.</p>
        ) : (
          <ul className="mt-4 columns-1 gap-x-10 sm:columns-2 lg:columns-3">
            {roster.students.map((s) => (
              <li
                key={s.enrollmentId}
                className="break-inside-avoid border-b border-border-default py-2 text-body break-words"
              >
                {s.displayName ?? s.studentId.slice(0, 8)}
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
