'use client';

import { EVENT_RESUME_OVERLAP, type SessionSnapshot, STREAM_HEARTBEAT_MS } from '@bali/shared';
import {
  Circle,
  CircleCheck,
  CircleHelp,
  Flag,
  LockOpen,
  type LucideIcon,
  ShieldOff,
  WifiOff,
} from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

import { Button } from '@/components/button';
import { CARD } from '@/components/card';
import { getAccessToken } from '@/lib/auth';
import { config } from '@/lib/config';
import { errText } from '@/lib/errors';
import {
  applyEvent,
  endsSession,
  fromSnapshot,
  gridDisplay,
  type GridDisplay,
  landsLive,
  lastSeenNote,
  mergeSnapshot,
  silentNote,
  snapshotIsFresh,
  softpulses,
  staleness,
  staleWords,
  type Student,
  type Students,
  unlockNote,
} from '@/lib/grid-state';
import { createSseClient, type SseClient, type SseStatus } from '@/lib/sse-client';
import { useApi, useSignOut } from '@/lib/use-api';

/** A state's edge: none to see on a tinted chip; Silent's and Unknown's dashed (Q3 A, 1.5 px). */
const SOLID = 'border-transparent';
const DASHED = 'border-dashed border-border-strong';
const EMERGENCY = `${SOLID} bg-state-emergency-bg text-state-emergency-fg`;
const REVOKED = `${SOLID} bg-state-revoked-bg text-state-revoked-fg`;

/**
 * Each state's chip (DESIGN.md §2 and §4): its tint, its icon and its label, never colour alone.
 * The two Left chips take their state's colour, the flag first and the state's icon after it
 * (Q2 A); Silent is the ended pair with a dashed edge, Unknown dashed with no fill (Q3 A). The class
 * page's counts take the same (PV7).
 */
export const CHIP: Record<GridDisplay, { label: string; icons: LucideIcon[]; tone: string }> = {
  focused: {
    label: 'Focused',
    icons: [CircleCheck],
    tone: `${SOLID} bg-state-focused-bg text-state-focused-fg`,
  },
  unlocked: { label: 'Unlocked', icons: [LockOpen], tone: EMERGENCY },
  protection_off: { label: 'Protection off', icons: [ShieldOff], tone: REVOKED },
  silent: {
    label: 'Silent',
    icons: [WifiOff],
    tone: `${DASHED} bg-state-ended-bg text-state-ended-fg`,
  },
  ended: { label: 'Left', icons: [Flag], tone: `${SOLID} bg-state-ended-bg text-state-ended-fg` },
  // Left the session AND unshielded, the ISSUES #2 case: it must never read as the quiet "Left".
  left_unprotected: { label: 'Left · unlocked', icons: [Flag, LockOpen], tone: EMERGENCY },
  // The same, for a phone whose Screen Time permission was off: never an unlock.
  left_protection_off: { label: 'Left · protection off', icons: [Flag, ShieldOff], tone: REVOKED },
  absent: {
    label: 'Not here',
    icons: [Circle],
    tone: `${SOLID} bg-state-notjoined-bg text-state-notjoined-fg`,
  },
  unknown: {
    label: 'Unknown · refresh',
    icons: [CircleHelp],
    tone: `${DASHED} bg-state-nodevice-bg text-text-primary`,
  },
};

/** The six states the class page counts over the grid (ClassLive), in its order. */
export const COUNTED = [
  'focused',
  'unlocked',
  'protection_off',
  'silent',
  'absent',
  'ended',
] as const;
export type Counted = (typeof COUNTED)[number];

/**
 * Where each student counts: in their tile's state, both Left tiles under Left, as ClassLive
 * counts "Left · unlocked"; Unknown under none, since this tab can't say what it is.
 */
const COUNTED_AS: Record<GridDisplay, Counted | null> = {
  focused: 'focused',
  unlocked: 'unlocked',
  protection_off: 'protection_off',
  silent: 'silent',
  absent: 'absent',
  ended: 'ended',
  left_unprotected: 'ended',
  left_protection_off: 'ended',
  unknown: null,
};

/** The grid right now, counted (ClassLive): "Live · 25 of 28 joined" and the six counts. */
export interface StateCounts {
  /** Each student the grid shows, once. */
  total: number;
  /** Those who tapped in this session: all but Not here. */
  joined: number;
  counts: Record<Counted, number>;
}

/** The grid's tiles, counted by their states (`gridDisplay`'s). */
export function stateCounts(displays: readonly GridDisplay[]): StateCounts {
  const counts = Object.fromEntries(COUNTED.map((state) => [state, 0])) as Record<Counted, number>;
  for (const display of displays) {
    const state = COUNTED_AS[display];
    if (state !== null) counts[state] += 1;
  }
  return { total: displays.length, joined: displays.length - counts.absent, counts };
}

/**
 * The grid's columns (the Class page design): as many as fit, each at least 212 px, so six fill
 * the class page's 1320 px column at the desktop width, every chip on one line but Unknown's and
 * "Left · protection off", which wrap after their dot; never wider than the grid (`min`), on a
 * phone. Present keeps its four columns (DESIGN.md §5) from a 56 rem grid, as it shipped: the
 * canvas's 320 px would leave a 1280 px projector three, a 1024 px one two.
 */
export const COLUMNS = 'grid-cols-[repeat(auto-fill,minmax(min(212px,100%),1fr))]';
export const PRESENT_COLUMNS = 'grid-cols-2 @2xl:grid-cols-3 @4xl:grid-cols-4';

/**
 * A state chip in v2's look (DESIGN.md §4): a pill in the state's tint with a 1.5 px edge, padded
 * 3 × 10 px, its 13 px icons centred on the label's first line, the label in sentence case at
 * 13/18 (`caption`, medium). It says the state alone, the same words on the teacher's screen and
 * on the projector (the Class page design); only Silent carries how long the phone has been quiet.
 * A label too long for its cell wraps balanced, after the dot ("Left ·" over "protection off", the
 * owner's ruling), at `radius-lg`, which draws the pill on one line (it is 27 px tall) and a
 * rounded box on two. `pulse` is `bali-softpulse` (§7), and `onPulseEnd` hears it finish. In
 * Present the label takes the projector's size (§5), its icons 16 px.
 */
function Chip({
  display,
  silent,
  pulse,
  onPulseEnd,
  present,
}: {
  display: GridDisplay;
  silent: string | null;
  pulse: boolean;
  onPulseEnd?: () => void;
  present: boolean;
}) {
  const chip = CHIP[display];
  return (
    <span
      onAnimationEnd={pulse ? onPulseEnd : undefined}
      className={`inline-flex max-w-full items-start gap-1.5 rounded-lg border-[1.5px] px-2.5 py-0.75 text-balance ${present ? 'text-present-label' : 'text-caption font-medium'} ${chip.tone} ${pulse ? 'animate-softpulse' : ''}`}
    >
      {chip.icons.map((Icon, i) => (
        <Icon
          key={i}
          size={present ? 16 : 13}
          aria-hidden="true"
          className={`shrink-0 ${present ? 'mt-0.5' : 'mt-[2.5px]'}`}
        />
      ))}
      {/* A no-break space before each dot, so a label breaks after it, never before. */}
      <span className="min-w-0">
        {(silent === null ? chip.label : `${chip.label} · ${silent}`).replaceAll(' · ', '\u00a0· ')}
      </span>
    </span>
  );
}

/**
 * The dot between an unlock's reason and "last seen", as wide as " · ", clipped away when "last
 * seen" wraps under the reason (the line's `overflow-hidden`), so a line never starts with it.
 */
const AFTER_REASON =
  "-ml-2.5 before:inline-block before:w-2.5 before:text-center before:content-['·']";

/**
 * The standard grid on one column (a phone, under 432 px, where a second column stops fitting):
 * the chip beside the name, the line under both, as the canvas's container rule draws it.
 */
const ONE_COLUMN =
  '@max-[432px]:grid @max-[432px]:min-h-0 @max-[432px]:grid-cols-[minmax(0,1fr)_auto] @max-[432px]:items-center @max-[432px]:gap-x-3 @max-[432px]:gap-y-1';

/**
 * One student's cell (the Class page design): the name, then the chip, then the line under it: the
 * unlock's reason (`unlockNote`, never in Present) and how long since the phone was heard from
 * (`lastSeenNote`), so a row's chips line up. Every cell is as tall as one with that line: 117 px
 * with v2's 27 px chip (`min-h-29.25`). In Present the line sits beside the chip when it fits.
 */
export function Cell({
  student: s,
  now,
  present,
  pulse,
  onPulseEnd,
}: {
  student: Student;
  now: Date;
  present: boolean;
  pulse: boolean;
  onPulseEnd?: () => void;
}) {
  const display = gridDisplay(s, now);
  const reason = unlockNote(s, display, present);
  const seen = lastSeenNote(s, display, now);
  return (
    <li
      className={`flex flex-col gap-2 ${CARD} ${present ? 'min-h-22' : `min-h-29.25 ${ONE_COLUMN}`}`}
    >
      <div className="flex items-start justify-between gap-2">
        <span
          className={`min-w-0 break-words ${present ? 'text-present-name' : 'text-body font-semibold'}`}
        >
          {s.displayName ?? s.studentId.slice(0, 8)}
        </span>
        {/* S9: advice beside the name, never a colour of its own; it changes no state. */}
        {s.clockOff ? (
          <span
            title="This phone's clock is set ahead. Bali records the time by its own clock."
            className="shrink-0 rounded-xs border border-current px-2 text-caption whitespace-nowrap text-text-tertiary"
          >
            Clock off
          </span>
        ) : null}
      </div>
      <div
        className={
          present
            ? 'flex flex-wrap items-center gap-x-3 gap-y-1'
            : 'flex flex-col items-start gap-2 @max-[432px]:contents'
        }
      >
        {/* Keyed by its unlock, so each new one pulses from the start; once it has pulsed it
            leaves the set, so a chip that turns red and back stays still. */}
        <Chip
          key={s.unlock?.eventId ?? 'none'}
          display={display}
          silent={display === 'silent' ? silentNote(s, now) : null}
          pulse={pulse}
          present={present}
          onPulseEnd={onPulseEnd}
        />
        {reason === null && seen === null ? null : (
          <p className="flex flex-wrap overflow-hidden text-caption tabular-nums @max-[432px]:col-span-full">
            {reason === null ? null : (
              <span className="mr-2.5 text-text-secondary first-letter:uppercase">{reason}</span>
            )}
            {seen === null ? null : (
              <span className={`text-text-tertiary ${reason === null ? '' : AFTER_REASON}`}>
                {seen}
              </span>
            )}
          </p>
        )}
      </div>
    </li>
  );
}

/**
 * The stream lost, said as v2's floating pill (ClassStale; DESIGN.md §4): white, a strong edge,
 * `shadow-2` and a stone dot. It sits on a layer over the whole page, 14 px from its top as drawn,
 * taking no room and nobody's clicks, and stays in view as the page scrolls, so a grid scrolled to
 * its last row still says it may be out of date. The layer is placed against the nearest
 * positioned ancestor, the class page's `<main>` (its frame is 30 px in, 22 on a phone).
 */
const PILL_LAYER = 'pointer-events-none absolute inset-x-0 -top-4 bottom-0 z-10 max-sm:-top-2';
const PILL =
  'sticky top-3.5 mx-auto flex w-fit max-w-full items-center gap-2 rounded-full border border-border-strong bg-surface-card px-3.5 py-1.5 text-caption font-medium text-text-secondary shadow-2';

export function LiveGrid({
  sessionId,
  onEnded,
  onSession,
  onCounts,
  present = false,
  livePage = false,
}: {
  sessionId: string;
  /** Called with `sessionId` once the server marks the session over: an end event, or a snapshot. */
  onEnded?: (sessionId: string) => void;
  /** Called with the session as each snapshot the grid keeps says it is: its start and bell (P10). */
  onSession?: (session: SessionSnapshot['session']) => void;
  /** Called with `sessionId` and the grid counted (`stateCounts`) whenever a count changes (PV7). */
  onCounts?: (sessionId: string, counts: StateCounts) => void;
  /**
   * The projector view (DESIGN.md §5): four columns, names 20 px, chip labels 14 px, cells at
   * least 88 px tall, readable from the back of a classroom; the same chips and words, but never
   * an unlock's reason: the class can see it (`unlockNote`).
   */
  present?: boolean;
  /**
   * The class page's own grid while a session runs (PV7), its said lines as ClassStale and
   * ClassStates draw them: a lost stream as the floating pill (`PILL`) in place of the line over
   * the grid, a stream open but quiet still that line, and a grid that didn't load said with a
   * small Try again. Off, as before: Present until PV9, How it ended until PV12.
   */
  livePage?: boolean;
}) {
  const api = useApi();
  const onUnauthorized = useSignOut();
  // The newest callbacks, read where a snapshot lands, so a new one never restarts the stream.
  const onEndedRef = useRef(onEnded);
  const onSessionRef = useRef(onSession);
  const onCountsRef = useRef(onCounts);
  useEffect(() => {
    onEndedRef.current = onEnded;
    onSessionRef.current = onSession;
    onCountsRef.current = onCounts;
  }, [onEnded, onSession, onCounts]);
  const [students, setStudents] = useState<Students | null>(null);
  // Over when it boots (R5's grid under the recap card): drawn once, holding none of the streams.
  const [over, setOver] = useState(false);
  const [now, setNow] = useState(() => new Date());
  const [status, setStatus] = useState<SseStatus>('connecting');
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0); // a boot that failed, tried again (rule 5)
  // The unlocks that landed while the grid was open, by event id: their chips pulse (§7).
  const [liveUnlocks, setLiveUnlocks] = useState<ReadonlySet<string>>(() => new Set());
  // Any sign of life from the server: an event, a heartbeat comment, or a
  // snapshot refresh that came back. A heartbeat is freshness and not just
  // liveness — a quiet class emits no events, so nothing arriving is normal
  // and only nothing arriving FROM THE SERVER means the screen is guessing.
  // Two clocks — see `staleness`. The stream's own, and the grid's (which the
  // 15 s poll also feeds). One clock for both hid a dead stream behind a
  // working poll.
  const lastStreamActivity = useRef<number>(Date.now());
  const lastGridActivity = useRef<number>(Date.now());
  // The newest event seq the grid has applied, so a stale in-flight snapshot
  // can't roll it backwards over a streamed unlock.
  const appliedSeq = useRef<number>(0);

  // Boot from the snapshot, then stream.
  useEffect(() => {
    setError(null);
    let sse: SseClient | null = null;
    let cancelled = false;
    void (async () => {
      try {
        const snap = await api.get<SessionSnapshot>(`/v1/sessions/${sessionId}`);
        if (cancelled) return;
        setStudents(fromSnapshot(snap));
        onSessionRef.current?.(snap.session);
        if (snap.ended) {
          setOver(true);
          onEndedRef.current?.(sessionId);
          return;
        }
        appliedSeq.current = snap.latestSeq;
        lastStreamActivity.current = Date.now();
        lastGridActivity.current = Date.now();
        sse = createSseClient({
          url: `${config.apiUrl}/v1/sessions/${sessionId}/stream`,
          getToken: getAccessToken,
          after: snap.latestSeq,
          overlap: EVENT_RESUME_OVERLAP,
          onEvent: (e) => {
            setStudents((prev) => (prev ? applyEvent(prev, e) : prev));
            if (landsLive(e, snap.latestSeq)) {
              setLiveUnlocks((prev) => new Set(prev).add(e.eventId));
            }
            if (e.seq > appliedSeq.current) appliedSeq.current = e.seq;
            lastStreamActivity.current = Date.now();
            lastGridActivity.current = Date.now();
            if (endsSession(e)) onEndedRef.current?.(sessionId);
          },
          onActivity: () => {
            lastStreamActivity.current = Date.now();
            lastGridActivity.current = Date.now();
          },
          onStatus: setStatus,
          onUnauthorized,
        });
      } catch (e) {
        if (!cancelled) setError(errText(e));
      }
    })();
    return () => {
      cancelled = true;
      sse?.close();
    };
  }, [api, sessionId, onUnauthorized, attempt]);

  // Local clock so the silent badge appears with zero event traffic.
  useEffect(() => {
    if (over) return;
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, [over]);

  // The grid counted, told only when a count moves: a student tapping in, unlocking or going
  // silent on this clock, not every second's tick. Never while the grid says it didn't load (the
  // 15 s refresh can still fill it then), so no count stands beside that line.
  const told = useRef<string | null>(null);
  useEffect(() => {
    if (!students || error) return;
    const counts = stateCounts(Object.values(students).map((s) => gridDisplay(s, now)));
    const key = JSON.stringify(counts);
    if (key === told.current) return;
    told.current = key;
    onCountsRef.current?.(sessionId, counts);
  }, [students, now, sessionId, error]);

  // Slow snapshot refresh keeps derived silence honest for quietly-present
  // students: heartbeats update last_seen_at server-side but emit no event
  // (decision 7), so they never reach the grid through the stream alone. It is
  // dropped when the stream has already applied something newer — a snapshot
  // read before an unlock but resolving after it would put the chip back to
  // green for an unshielded phone.
  useEffect(() => {
    if (over) return;
    const t = setInterval(() => {
      void api.get<SessionSnapshot>(`/v1/sessions/${sessionId}`).then(
        (snap) => {
          // The refresh came back, so the GRID is current whether or not it
          // changed anything — "last updated" must not keep counting up past a
          // reload that worked. Deliberately not the stream's clock: this poll
          // runs every 15 s against a 60 s threshold, so feeding it there
          // resets the counter four times per threshold and a stream that has
          // silently died never gets reported at all.
          lastGridActivity.current = Date.now();
          // Over is over, however old the read: a stream that missed the end still ends here.
          if (snap.ended) onEndedRef.current?.(sessionId);
          if (!snapshotIsFresh(snap.latestSeq, appliedSeq.current)) return;
          appliedSeq.current = snap.latestSeq;
          setStudents((cur) => (cur ? mergeSnapshot(cur, snap) : fromSnapshot(snap)));
          onSessionRef.current?.(snap.session);
        },
        () => {
          /* keep the last-known grid; the banner already shows staleness */
        },
      );
    }, 15_000);
    return () => clearInterval(t);
  }, [api, sessionId, over]);

  if (error) {
    return (
      <div className="flex flex-wrap items-center gap-x-4 gap-y-3">
        <p role="alert" className="text-body">
          {error}
        </p>
        <Button
          variant="secondary"
          size={livePage ? 'sm' : 'md'}
          onClick={() => setAttempt((n) => n + 1)}
        >
          Try again
        </Button>
      </div>
    );
  }
  if (!students) {
    return (
      <p role="status" className="text-body text-text-secondary">
        Loading grid…
      </p>
    );
  }

  const stale = staleness({
    status,
    lastStreamActivityAt: lastStreamActivity.current,
    lastGridActivityAt: lastGridActivity.current,
    now: now.getTime(),
    heartbeatMs: STREAM_HEARTBEAT_MS,
  });
  const rows = Object.values(students);

  return (
    <div className="flex flex-col gap-3">
      {/* The grid's health (§4): stone, never amber; honest, not alarmed. */}
      {stale && !over ? (
        livePage && stale.reason === 'reconnecting' ? (
          <div className={PILL_LAYER}>
            <p className={PILL}>
              <span aria-hidden="true" className="size-1.75 shrink-0 rounded-full bg-pip" />
              {staleWords(stale)}
            </p>
          </div>
        ) : (
          <p className="rounded-sm border border-border-default bg-surface-sunken px-4 py-3 text-body text-text-primary tabular-nums">
            {staleWords(stale)}
          </p>
        )
      ) : null}
      {rows.length === 0 ? (
        <p className="text-body text-text-secondary">No students enrolled yet.</p>
      ) : (
        // Fewer columns as the grid narrows, never smaller type (§5); the cells straight on the page.
        <div className="@container">
          <ul className={`grid gap-2 ${present ? PRESENT_COLUMNS : COLUMNS}`}>
            {rows.map((s) => {
              const unlock = s.unlock?.eventId;
              return (
                <Cell
                  key={s.studentId}
                  student={s}
                  now={now}
                  present={present}
                  pulse={softpulses(s, gridDisplay(s, now), liveUnlocks)}
                  onPulseEnd={() =>
                    setLiveUnlocks((prev) => {
                      const next = new Set(prev);
                      if (unlock !== undefined) next.delete(unlock);
                      return next;
                    })
                  }
                />
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}
