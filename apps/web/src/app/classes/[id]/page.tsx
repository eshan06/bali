'use client';

import {
  type ClassDetail,
  MAX_SESSION_MINUTES,
  type RosterResponse,
  type SessionView,
  type StartSessionResponse,
} from '@bali/shared';
import { ArrowLeft, ArrowRight, ChartBar, Check, Presentation } from 'lucide-react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useCallback, useEffect, useId, useRef, useState } from 'react';

import { Button, buttonClass } from '@/components/button';
import { CARD_ALONE } from '@/components/card';
import { Field } from '@/components/field';
import { JoinCode } from '@/components/join-code';
import { LiveGrid } from '@/components/live-grid';
import { RecapCard } from '@/components/recap-card';
import { usePresenting } from '@/components/shell';
import { NAV_LINK } from '@/components/text-link';
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
  rememberedPresent,
  rememberMinutes,
  rememberPresent,
} from '@/lib/session-controls';
import { useApi } from '@/lib/use-api';

/**
 * The page in Present, the projector's view, with no menu (the owner's ruling, 2026-10-13, as
 * ClassPresent draws it): its own column as before the menu, 1400 px at most with 40 px gutters, so
 * a 1024 px projector keeps Present's four columns, until PV9 draws Present.
 */
const PRESENT_PAGE = 'mx-auto max-w-[1400px] px-4 pb-16 sm:px-10';

/** A hairline between the bell and the controls, 40 px tall as the buttons are. */
const DIVIDER = 'h-10 w-px shrink-0 bg-border-default';

/**
 * The length picker, v2's segmented control (ClassBefore): a grey track holding each length as a
 * segment, the radio inside it read by screen readers and clipped away, so the focus ring is drawn
 * on the label for it. The pick is white and raised, in the primary ink, with a check, never colour
 * alone.
 */
const TRACK = 'inline-flex flex-wrap gap-0.5 rounded-sm bg-surface-sunken p-0.75';
const SEGMENT =
  'relative inline-flex cursor-pointer items-center gap-1.5 rounded-item px-4 py-2.25 text-segment text-text-secondary select-none has-checked:bg-surface-card has-checked:text-text-primary has-checked:shadow-1 has-focus-visible:outline-2 has-focus-visible:outline-offset-2 has-focus-visible:outline-focus-ring';

/** A label over a part of the page (Roster, Join code): v2's section label, 12 px above its card. */
const LABEL = 'mb-3 text-section-label text-text-tertiary uppercase';

/** "28 students", "1 student". */
const students = (count: number) => `${count} ${count === 1 ? 'student' : 'students'}`;

/**
 * A class's page. While no session runs (PV6; ClassBefore, ClassNewCode, ClassStates' lines before
 * a session, CopyStates): its name over "28 students · no session running" with Reports, the length
 * picker and Start, the last session's recap and how it ended, with Present (PV12's to draw), then
 * the roster in three columns beside the join code's card. Until the class is read, a Loading or
 * Error card holds the session's place: a session may be live. While one runs, as before v2's look
 * until PV7 draws it: the class's name and join code, the session's card (the bell, Extend, and End
 * set apart), the live grid with Present, then the roster; in Present the header folds the bell, the
 * code and the controls into one row, so a class of 28 fits one 1080p screen. Each failure is said
 * where it happened. It sits in the shell's frame beside the side menu (PV5), which sets its width
 * and gutters; in Present the shell draws neither, and the page keeps its own column
 * (`PRESENT_PAGE`).
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
  // The class didn't load: said in the session's place, with Try again. Its roster didn't, or a
  // read again of the class failed: said under the header, with Try again.
  const [error, setError] = useState<string | null>(null);
  const [rosterError, setRosterError] = useState<string | null>(null);
  // Which send is under way, if any: every control holds while one is, and only a Start's own
  // button says "Starting…" (an End's answer can come after the grid already says it ended).
  const [busy, setBusy] = useState<'start' | 'end' | 'extend' | null>(null);
  // A send under way: a second press before the page redraws sends nothing.
  const sending = useRef(false);
  // The next session's length (P10): a preset, or Other with the minutes typed under it.
  const [pick, setPick] = useState<number | 'other'>(DEFAULT_MINUTES);
  const [other, setOther] = useState('');
  const [lengthSaid, setLengthSaid] = useState(false);
  const otherField = useRef<HTMLInputElement>(null);
  // A Start that failed, said under its button; the button sends it again.
  const [startSaid, setStartSaid] = useState<string | null>(null);
  // The projector view (DESIGN.md §5), toggled in the grid's header and kept for this tab, so a
  // reload or a return from Reports comes back in it; a new tab or window opens without it.
  const [present, setPresent] = useState(false);
  // On the projector, no menu: the shell draws none while Present is on.
  usePresenting(present);
  // The page opened in Present: with no session to show, the recap carries the toggle, so the
  // teacher can always leave it.
  const [openedInPresent, setOpenedInPresent] = useState(false);
  // Extend (P10): the last attempt whose answer never came, resent by Try again; and what is said
  // beside the grid: a failure (with Try again), a refusal or an End that failed (its button is
  // the retry), or a note on the session shown.
  const unanswered = useRef<ExtendAttempt | null>(null);
  const [said, setSaid] = useState<{ kind: 'failed' | 'refused' | 'note'; message: string } | null>(
    null,
  );

  const load = useCallback(() => {
    setError(null);
    setRosterError(null);
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
      .then(setRoster, (e: unknown) => setRosterError(errText(e)));
  }, [api, classId]);

  useEffect(() => {
    if (!getAccessToken()) {
      router.replace('/login');
      return;
    }
    load();
  }, [load, router]);

  // The class's last pick on this computer, and Present as this tab left it, read once the page is
  // in the browser (never at render, where the server has no storage), so before the class's read
  // can show a grid or the recap; a length that isn't a preset reopens Other with it.
  useEffect(() => {
    const remembered = pickFor(rememberedMinutes(classId));
    setPick(remembered.pick);
    setOther(remembered.other);
    const kept = rememberedPresent(classId);
    setPresent(kept);
    setOpenedInPresent(kept);
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

  /** Run `send` unless one is under way, the page busy with `kind` until it settles. */
  async function once(kind: 'start' | 'end' | 'extend', send: () => Promise<void>) {
    if (sending.current) return;
    sending.current = true;
    setBusy(kind);
    try {
      await send();
    } finally {
      sending.current = false;
      setBusy(null);
    }
  }

  function startSession(e: React.FormEvent) {
    e.preventDefault();
    if (minutes === null) {
      setLengthSaid(true);
      otherField.current?.focus();
      return;
    }
    void once('start', async () => {
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
    void once('end', async () => {
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
    void once('extend', async () => {
      setSaid(null);
      const answer = await extendSession(api, session, attempt);
      unanswered.current = keepUnanswered(attempt, answer);
      if (answer.kind === 'extended') onSession({ id: session, classId, endsAt: answer.endsAt });
      else setSaid(answer);
    });
  }

  // Present, the projector the class can see (DESIGN.md §5), in the grid's header, live or ended:
  // it reaches the recap too, so a session that ends while projected shows no unlock's reason, and
  // pressing it again shows them. Pressed is its check, with the Button's sunken fill and
  // `text-primary` edge, never colour alone.
  const presentToggle = (
    <Button
      variant="secondary"
      aria-pressed={present}
      onClick={() => {
        rememberPresent(classId, !present);
        setPresent(!present);
      }}
    >
      {present ? (
        <Check size={16} aria-hidden="true" />
      ) : (
        <Presentation size={16} aria-hidden="true" />
      )}
      Present
    </Button>
  );

  // In Present while a session runs, the projector's page (the Present board): the header folds the
  // bell, the code and the controls into one row, so a class of 28 fits one 1080p screen.
  const projecting = present && grid !== null && !grid.over;
  // The bell, the page's biggest number; "…" until an answer or a snapshot says it.
  const endsAt = (
    <p className="flex flex-col">
      <span className="text-caption text-text-tertiary">Ends at</span>
      {grid?.endsAt ? (
        <time dateTime={grid.endsAt} className="font-num text-data-lg tabular-nums">
          {bellTime(grid.endsAt)}
        </time>
      ) : (
        <span className="font-num text-data-lg text-text-tertiary">…</span>
      )}
    </p>
  );
  const extend = EXTEND_PRESETS.map((add) => (
    <Button
      key={add}
      variant="secondary"
      onClick={() => addTime(extendAttemptFor(unanswered.current, add))}
      aria-disabled={busy !== null}
      className="tabular-nums"
    >
      +{add} min
    </Button>
  ));
  const end = (className = '') => (
    <Button
      variant="secondary"
      onClick={endSession}
      aria-disabled={busy !== null}
      className={className}
    >
      End session
    </Button>
  );

  // While a session runs, the page as it was before v2's look, until PV7 draws it.
  return klass !== null && grid !== null && !grid.over ? (
    <main className={present ? `${PRESENT_PAGE} ${projecting ? 'pt-5' : 'pt-8'}` : undefined}>
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

      {/* One header in both views, so the code stays put as Present turns on. */}
      <header
        className={`flex min-h-10 flex-wrap gap-x-8 gap-y-4 ${projecting ? 'mt-4 items-center' : 'mt-5 items-start justify-between'}`}
      >
        <h1 className="min-w-0 text-h1 text-balance break-words">{klass.name}</h1>
        {projecting ? endsAt : null}
        {projecting ? <div className="grow" /> : null}
        <JoinCode classId={classId} code={klass.joinCode} onClass={setKlass} large={projecting} />
        {projecting ? <div aria-hidden="true" className={`${DIVIDER} max-lg:hidden`} /> : null}
        {projecting ? (
          <div className="flex flex-wrap items-center gap-2">
            {extend}
            {end()}
          </div>
        ) : null}
      </header>

      {/* Its roster didn't load, or a read again of the class failed: said under the header. */}
      {(error ?? rosterError) ? (
        <div className="mt-6 flex flex-wrap items-center gap-x-4 gap-y-3">
          <p role="alert" className="text-body">
            Couldn&apos;t load this class.{' '}
            <span className="text-text-secondary">{error ?? rosterError}</span>
          </p>
          <Button variant="secondary" onClick={load}>
            Try again
          </Button>
        </div>
      ) : null}

      {/* The same three places in both views, so the grid never restarts as Present turns on. */}
      <div>
        {/* The session's card: the bell, adding time, and End set apart (End sends at once). */}
        {projecting ? null : (
          <section
            aria-label="Session"
            className={`mt-6 flex flex-wrap items-center gap-x-6 gap-y-4 ${CARD_ALONE}`}
          >
            {endsAt}
            <div aria-hidden="true" className={`${DIVIDER} max-sm:hidden`} />
            <div className="flex grow flex-wrap items-center gap-2 max-sm:basis-full">
              {extend}
              {end('ml-auto')}
            </div>
          </section>
        )}
        {/* Said right under the controls, where they are. */}
        {said ? (
          <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-3">
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
                aria-disabled={busy !== null}
              >
                Try again
              </Button>
            ) : null}
          </div>
        ) : null}
        <section
          aria-labelledby={`${id}-live`}
          className={`flex flex-col ${projecting ? 'mt-5 gap-3' : 'mt-8 gap-4'}`}
        >
          <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3">
            <h2 id={`${id}-live`} className="text-h2">
              Live grid
            </h2>
            {presentToggle}
          </div>
          <LiveGrid sessionId={grid.id} onEnded={onEnded} onSession={onSession} present={present} />
        </section>
      </div>

      <section
        aria-labelledby={`${id}-roster`}
        className="mt-14 border-t border-border-default pt-8"
      >
        <h2 id={`${id}-roster`} className="text-h2">
          Roster
        </h2>
        {/* Unread, it says so under the header with Try again, never "Loading…" here. */}
        {roster === null ? (
          rosterError ? null : (
            <p role="status" className="mt-4 text-body text-text-secondary">
              Loading…
            </p>
          )
        ) : roster.students.length === 0 ? (
          <p className="mt-4 text-body text-text-secondary">No students have joined yet.</p>
        ) : (
          <ul className="mt-4 columns-2 gap-x-6 sm:columns-3 sm:gap-x-10 lg:columns-4">
            {roster.students.map((s) => (
              <li key={s.enrollmentId} className="break-inside-avoid py-2 text-body break-words">
                {s.displayName ?? s.studentId.slice(0, 8)}
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  ) : (
    // No session running (PV6), or the class not read yet: v2's look, its parts 22 px apart.
    <main className={`flex flex-col gap-5.5 ${present ? `${PRESENT_PAGE} pt-8` : ''}`}>
      {/* The name over its line, Reports at the end; on a phone the name at the card titles' size and
          Reports on a line of its own. */}
      <header className="flex flex-wrap items-center gap-x-4.5 gap-y-3.5 max-sm:gap-x-3.5">
        <div className="min-w-0 max-sm:flex-1">
          <h1
            className={`text-page-title text-balance wrap-anywhere max-sm:text-h3 ${klass ? '' : 'text-text-tertiary'}`}
          >
            {klass?.name ?? '…'}
          </h1>
          {/* Its line's place held while the class is read, so nothing under it moves. */}
          <p className="mt-0.5 text-meta text-text-secondary">
            {klass === null
              ? '\u00a0'
              : roster
                ? `${students(roster.students.length)} · no session running`
                : 'No session running'}
          </p>
        </div>
        <div className="ml-auto flex flex-wrap items-center gap-2 max-sm:ml-0 max-sm:basis-full">
          <Link href={`/classes/${classId}/reports`} className={buttonClass('secondary', '', 'sm')}>
            <ChartBar size={16} aria-hidden="true" />
            Reports
          </Link>
        </div>
      </header>

      {/* The class is read and its roster isn't (or a read again failed): said under the header. */}
      {klass && (error ?? rosterError) ? (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-3">
          <p role="alert" className="text-body">
            Couldn&apos;t load this class. {error ?? rosterError}
          </p>
          <Button variant="secondary" size="sm" onClick={load}>
            Try again
          </Button>
        </div>
      ) : null}

      {klass === null ? (
        // Until the class is read, the session's place holds no Start: one may already be live.
        error ? (
          <section className={CARD_ALONE}>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-3">
              <p role="alert" className="text-body">
                Couldn&apos;t load this class. {error}
              </p>
              <Button variant="secondary" size="sm" onClick={load}>
                Try again
              </Button>
            </div>
          </section>
        ) : (
          // As tall as the Start card it holds the place of (118 px), so nothing jumps.
          <section aria-label="Session" className={`flex min-h-29.5 items-center ${CARD_ALONE}`}>
            <p role="status" className="text-body text-text-secondary">
              Loading…
            </p>
          </section>
        )
      ) : (
        <>
          {/* noValidate: the length is checked here and said in Bali's words under the field,
              never by the browser's own bubble over the number input. */}
          <form onSubmit={startSession} noValidate className={CARD_ALONE}>
            <fieldset>
              <legend className="text-body font-medium">Session length</legend>
              {/* The lengths on the left, Start on the right; on a phone Start goes under them. */}
              <div className="mt-3 flex flex-wrap items-center justify-between gap-2.5">
                <div className={TRACK}>
                  {[...LENGTH_PRESETS, 'other' as const].map((option) => (
                    <label key={option} className={SEGMENT}>
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
                      {pick === option ? <Check size={15} aria-hidden="true" /> : null}
                      {option === 'other' ? 'Other…' : `${option} min`}
                    </label>
                  ))}
                </div>
                {/* One button throughout, so focus stays on it whatever it comes to say. */}
                <Button type="submit" aria-disabled={busy !== null} aria-busy={busy === 'start'}>
                  {busy === 'start'
                    ? 'Starting…'
                    : minutes === null
                      ? 'Start session'
                      : `Start ${minutes}-minute session`}
                </Button>
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
                    readOnly={busy === 'start'}
                    aria-invalid={lengthSaid}
                    aria-describedby={lengthSaid ? `${id}-said` : undefined}
                  />
                </div>
              ) : null}
              {/* Right under the help, as ClassStates says it. */}
              {lengthSaid ? (
                <p id={`${id}-said`} role="alert" className="text-body">
                  {NOT_A_SESSION_LENGTH}
                </p>
              ) : null}
              {/* A Start that failed, said in its card; Start sends it again. */}
              {startSaid ? (
                <p role="alert" className="mt-3.5 text-body">
                  {startSaid}
                </p>
              ) : null}
            </fieldset>
          </form>
          {/* The last session's recap (R4) until a new one starts; only once the class is read,
              so a session already running never shows it. Opened in Present with no grid under
              it, the recap carries the toggle. */}
          <RecapCard
            classId={classId}
            present={present}
            toggle={grid === null && openedInPresent ? presentToggle : null}
          />
          {/* As it ended, until the next Start (R5): who was still unlocked stays in view. */}
          {grid ? (
            <section aria-labelledby={`${id}-ended`} className="flex flex-col gap-4">
              <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3">
                <h2 id={`${id}-ended`} className="text-h2">
                  How it ended
                </h2>
                {presentToggle}
              </div>
              <LiveGrid sessionId={grid.id} present={present} />
            </section>
          ) : null}
          {/* The roster beside the join code's card; on a narrow page the card goes under it. */}
          <div className="flex flex-wrap items-start gap-5">
            <section
              aria-labelledby={`${id}-roster`}
              className="flex min-w-0 flex-[999_1_520px] flex-col gap-5"
            >
              <h2 id={`${id}-roster`} className={LABEL}>
                {roster ? `Roster · ${students(roster.students.length)}` : 'Roster'}
              </h2>
              {/* Unread, it says so under the header with Try again, never "Loading…" here. */}
              {roster === null ? (
                rosterError ? null : (
                  <p role="status" className="text-body text-text-secondary">
                    Loading…
                  </p>
                )
              ) : roster.students.length === 0 ? (
                <p className="text-body text-text-secondary">No students have joined yet.</p>
              ) : (
                <div className={CARD_ALONE}>
                  {/* ponytail: as v2.css draws it, a word wider than its column runs on into the
                      32 px gap rather than break mid-word (a long surname on a phone); one wider
                      than both (some 13 letters on a phone, 30 on a computer) reaches the next
                      column. break-words if a real roster shows one. */}
                  <ul className="columns-3 gap-x-8">
                    {roster.students.map((s) => (
                      <li key={s.enrollmentId} className="break-inside-avoid py-1.5 text-body">
                        {s.displayName ?? s.studentId.slice(0, 8)}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </section>
            <section
              aria-labelledby={`${id}-code`}
              className="flex min-w-0 flex-[1_1_320px] flex-col gap-5"
            >
              <h2 id={`${id}-code`} className={LABEL}>
                Join code
              </h2>
              <div className={CARD_ALONE}>
                <JoinCode classId={classId} code={klass.joinCode} onClass={setKlass} card />
              </div>
            </section>
          </div>
        </>
      )}
    </main>
  );
}
