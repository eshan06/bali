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
import { Fragment, useEffect, useReducer, useRef, useState } from 'react';

import { Button } from '@/components/button';
import { NO_POPUPS, popupsAfter, unlockNews, UnlockPopups } from '@/components/unlock-popups';
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

/** A state's edge: none to see on a tint; Silent's and Unknown's dashed (Q3 A, 1.5 px). */
const SOLID = 'border-transparent';
const DASHED = 'border-dashed border-border-strong';
const EMERGENCY = `${SOLID} bg-state-emergency-bg text-state-emergency-fg`;
const REVOKED = `${SOLID} bg-state-revoked-bg text-state-revoked-fg`;

/**
 * Each state's look (DESIGN.md §2): its tint, its icon and its words, never colour alone. A tile
 * (PV8) and the class page's count of it (PV7) both draw from it, so the two always agree. The two
 * Left states take their state's colour, the flag first and the state's icon after it (Q2 A; a
 * student who left while unlocked counts under Left with an orange tile, the owner, 2026-10-14);
 * Silent is the ended pair with a dashed edge, Unknown dashed with no fill (Q3 A).
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
 * The grid's columns (ClassLive): as many tiles as fit, each at least 250 px, 10 px apart, so four
 * fill the class page beside the side menu at 1440 px; never wider than the grid (`min`). On a
 * phone (PhoneClassLive, under 640 px), two columns 8 px apart, every tile as tall as the grid's
 * tallest (PV1's pick: one size, nothing cut). Present keeps four columns from a 56 rem grid
 * (DESIGN.md §5), 12 px apart, three and then two narrower, so a 1024 px projector still shows four.
 */
export const COLUMNS =
  'grid-cols-[repeat(auto-fill,minmax(min(250px,100%),1fr))] gap-2.5 max-sm:grid-cols-2 max-sm:auto-rows-fr max-sm:gap-2';
export const PRESENT_COLUMNS = 'grid-cols-2 gap-3 @2xl:grid-cols-3 @4xl:grid-cols-4';

/** Clock off's tooltip (S9): advice, which changes no state. */
const CLOCK_OFF = "This phone's clock is set ahead. Bali records the time by its own clock.";

/** A dot between two parts of a line, after a no-break space, so a line never starts with one. */
const DOT = '\u00a0· ';

/**
 * A tile in v2's look (ClassStates): filled with its state's tint, its edge 1.5 px (dashed for
 * Silent and Unknown), 14 px corners; the state's icon, then the name, the state and one line, each
 * cut short with an ellipsis rather than wrapped, so every tile is one size: 84 px tall, 12 × 14 px
 * in. On a phone (PhoneClassLive) a short tile, 10 × 12 px in, as tall as the tallest: no icon at
 * the side, the state's icon before its words, its one detail after them, nothing cut. In Present
 * (ClassPresent), one size up: 100 px tall, 12 × 18 px in, its icon 24 px.
 */
const TILE = {
  standard:
    'grid h-21 grid-cols-[20px_minmax(0,1fr)] gap-x-2.5 px-3.5 py-3 max-sm:block max-sm:h-auto max-sm:px-3 max-sm:py-2.5',
  present: 'grid h-25 grid-cols-[24px_minmax(0,1fr)] gap-x-3 px-4.5 py-3',
};

/**
 * The tile's words, as `TILE` lays it out: the name 15/20, the state 13/18 and the line 12.5/17;
 * in Present 21/28, 17/24 and 15/22. On a phone the state and the line run on as one, wrapping,
 * on the state's own line height.
 */
const WORDS = {
  standard: {
    text: 'max-sm:block max-sm:text-caption',
    name: 'text-tile-name max-sm:whitespace-normal max-sm:wrap-anywhere',
    state: 'text-caption font-semibold max-sm:inline max-sm:whitespace-normal max-sm:wrap-anywhere',
    line: 'text-tile-line max-sm:inline max-sm:whitespace-normal',
  },
  present: {
    text: '',
    name: 'text-present-tile-name',
    state: 'text-present-tile-state',
    line: 'text-body font-medium',
  },
};

/**
 * One student's tile (ClassStates, ClassLive, PhoneClassLive, ClassPresent): the state's icon, the
 * name, the state's words (Silent's with its minutes, a Left state's after its flag), and one line:
 * an unlock's reason (`unlockNote`, never in Present, the projector the class can see), how long
 * since the phone was heard from (`lastSeenNote`) and Clock off (S9), each that applies, in that
 * order; on a phone only the detail PhoneClassLive draws (`brief`). `pulse` is `bali-softpulse`
 * (DESIGN.md §7) on the whole tile, and `onPulseEnd` hears it finish.
 */
export function Tile({
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
  const { label, icons, tone } = CHIP[display];
  // The state's own icon at the side; a Left state's flag before its words.
  const flags = icons.slice(0, -1);
  const StateIcon = icons[icons.length - 1] ?? Circle;
  const words = display === 'silent' ? `${label} · ${silentNote(s, now)}` : label;
  const note = unlockNote(s, display, present);
  const reason = note === null ? null : note.charAt(0).toUpperCase() + note.slice(1);
  const seen = lastSeenNote(s, display, now);
  const line = [
    ...(reason === null ? [] : [reason]),
    ...(seen === null ? [] : [seen]),
    ...(s.clockOff ? ['Clock off'] : []),
  ];
  // On a phone one detail at most, as PhoneClassLive draws them: an Unlocked tile's reason, a
  // Focused tile's Clock off (the owner, 2026-10-14). The rest stays on a computer until PV11.
  const brief =
    display === 'unlocked' ? reason : display === 'focused' && s.clockOff ? 'Clock off' : null;
  const look = present ? 'present' : 'standard';
  return (
    <li className="flex min-w-0">
      {/* Keyed by its unlock, so each new one pulses from the start; once it has pulsed it leaves
          the set, so a tile that turns red and back stays still. */}
      <div
        key={s.unlock?.eventId ?? 'none'}
        onAnimationEnd={pulse ? onPulseEnd : undefined}
        className={`${TILE[look]} w-full items-start rounded-md border-[1.5px] tabular-nums ${tone} ${pulse ? 'animate-softpulse' : ''}`}
      >
        <StateIcon
          size={present ? 24 : 20}
          aria-hidden="true"
          className={`mt-px ${present ? '' : 'max-sm:hidden'}`}
        />
        <span className={`flex min-w-0 flex-col ${WORDS[look].text}`}>
          <span className={`block truncate ${WORDS[look].name}`}>
            {s.displayName ?? s.studentId.slice(0, 8)}
          </span>
          <span className={`block truncate ${WORDS[look].state}`}>
            {/* On a phone the state's own icon first, then a Left state's flag, as PhoneClassLive
                draws "Left · unlocked"; on a computer the flag alone, the icon at the side. */}
            {[...(present ? [] : [StateIcon]), ...flags].map((Icon, i) => (
              <Icon
                key={i}
                size={present ? 16 : 13}
                aria-hidden="true"
                className={`mr-0.75 inline align-[-2px] ${!present && i === 0 ? 'sm:hidden' : ''}`}
              />
            ))}
            {words.replaceAll(' · ', DOT)}
          </span>
          {line.length === 0 ? null : (
            <span className={`block truncate ${WORDS[look].line}`}>
              {/* On a phone its one detail runs on after the state's words, the line hidden. */}
              {present || brief === null ? null : (
                <span className="sm:hidden">
                  <span aria-hidden="true">{DOT}</span>
                  {brief}
                </span>
              )}
              <span className={present ? undefined : 'max-sm:hidden'}>
                {line.map((part, i) => (
                  <Fragment key={part}>
                    {i === 0 ? null : DOT}
                    {part === 'Clock off' ? (
                      <span title={CLOCK_OFF}>{part}</span>
                    ) : (
                      part.replaceAll(' · ', DOT)
                    )}
                  </Fragment>
                ))}
              </span>
            </span>
          )}
        </span>
      </div>
    </li>
  );
}

/** How long the stream's first connect may take before the grid says so (the owner, 2026-10-14). */
export const FIRST_CONNECT_MS = 3000;

/**
 * The stream's state as the grid's health reads it (`staleness`), `connectingMs` after its first
 * connect began: that connect counts as open for its first `FIRST_CONNECT_MS`, since it has lost
 * nothing and the grid was just read, so no pill flashes for the 60–100 ms it takes as each page
 * loads (PV7's find); one that hangs past it, as a school's network can, is said as the pill, as a
 * lost stream is at once.
 */
export function healthOf(status: SseStatus, connectingMs: number): 'open' | 'reconnecting' {
  return status === 'reconnecting' || (status === 'connecting' && connectingMs >= FIRST_CONNECT_MS)
    ? 'reconnecting'
    : 'open';
}

/**
 * The stream lost, said as v2's floating pill (ClassStale; DESIGN.md §4): white, a strong edge,
 * `shadow-2` and a stone dot. It sits on a layer over the whole page, 14 px from its top as drawn,
 * taking no room and nobody's clicks, and stays in view as the page scrolls, so a grid scrolled to
 * its last row still says it may be out of date. The layer is placed against the nearest
 * positioned ancestor, the class page's `<main>` (its frame is 30 px in, 22 on a phone; in Present
 * it has no frame, and the pill, sticky, still rests 14 px from the screen's top).
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
   * The projector view (DESIGN.md §5; ClassPresent): four columns of tiles one size up, readable
   * from the back of a classroom; the same states and words, but never an unlock's reason: the
   * class can see it (`unlockNote`).
   */
  present?: boolean;
  /**
   * The class page's own grid while a session runs (PV7), in Present too (PV9), its said lines as
   * ClassStale and ClassStates draw them: a lost stream as the floating pill (`PILL`) in place of
   * the line over the grid, a stream open but quiet still that line, and a grid that didn't load
   * said with a small Try again; and each unlock the stream brings as a pop-up (PV10; ClassUnlock),
   * never in Present. Off, as before: How it ended until PV12.
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
  // And each opens a pop-up (PV10), kept while Present is on and shown after it, until it is closed
  // or the session's live page goes, its grid with it.
  const [popups, tell] = useReducer(popupsAfter, NO_POPUPS);
  // Any sign of life from the server: an event, a heartbeat comment, or a
  // snapshot refresh that came back. A heartbeat is freshness and not just
  // liveness — a quiet class emits no events, so nothing arriving is normal
  // and only nothing arriving FROM THE SERVER means the screen is guessing.
  // Two clocks — see `staleness`. The stream's own, and the grid's (which the
  // 15 s poll also feeds). One clock for both hid a dead stream behind a
  // working poll.
  const lastStreamActivity = useRef<number>(Date.now());
  const lastGridActivity = useRef<number>(Date.now());
  // When the stream's first connect began, for how long it has taken (`healthOf`).
  const connectStart = useRef<number>(Date.now());
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
        connectStart.current = Date.now();
        sse = createSseClient({
          url: `${config.apiUrl}/v1/sessions/${sessionId}/stream`,
          getToken: getAccessToken,
          after: snap.latestSeq,
          overlap: EVENT_RESUME_OVERLAP,
          onEvent: (e) => {
            setStudents((prev) => (prev ? applyEvent(prev, e) : prev));
            const live = landsLive(e, snap.latestSeq);
            if (live) setLiveUnlocks((prev) => new Set(prev).add(e.eventId));
            const news = unlockNews(e, live);
            if (news) tell(news);
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
    status: healthOf(status, now.getTime() - connectStart.current),
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
        // Fewer columns as the grid narrows, never smaller type (§5); the tiles straight on the page.
        <div className="@container">
          <ul className={`grid ${present ? PRESENT_COLUMNS : COLUMNS}`}>
            {rows.map((s) => {
              const unlock = s.unlock?.eventId;
              return (
                <Tile
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
      {/* The unlock pop-ups (ClassUnlock, ClassUnlocks), after the grid, never on the projector. */}
      {livePage && !present ? (
        <UnlockPopups
          unlocks={popups.open}
          students={students}
          onClose={(eventId) => tell({ kind: 'close', eventId })}
        />
      ) : null}
    </div>
  );
}
