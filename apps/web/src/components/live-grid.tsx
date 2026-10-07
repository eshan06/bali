'use client';

import {
  EVENT_RESUME_OVERLAP,
  type SessionSnapshot,
  type SessionView,
  STREAM_HEARTBEAT_MS,
} from '@bali/shared';
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
  type Students,
  unlockNote,
} from '@/lib/grid-state';
import { createSseClient, type SseClient, type SseStatus } from '@/lib/sse-client';
import { useApi, useSignOut } from '@/lib/use-api';

/** A state's edge: none to see on a tinted chip; Silent's and Unknown's dashed (Q3 A). */
const SOLID = 'border-transparent';
const DASHED = 'border-dashed border-border-strong';
const EMERGENCY = `${SOLID} bg-state-emergency-bg text-state-emergency-fg`;
const REVOKED = `${SOLID} bg-state-revoked-bg text-state-revoked-fg`;

/**
 * Each state's chip (DESIGN.md §2 and §4): its tint, its icon and its label, never colour alone.
 * The two Left chips take their state's colour, the flag first and the state's icon after it
 * (Q2 A); Silent is the ended pair with a dashed edge, Unknown dashed with no fill (Q3 A).
 */
const CHIP: Record<GridDisplay, { label: string; icons: LucideIcon[]; tone: string }> = {
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

/**
 * A state chip: a pill in the state's tint, padded `space-2` × `space-3`, its label in the `label`
 * style (DESIGN.md §4). What the chip carries rides after the label, never replacing it: an
 * unlock's reason (never in Present), or how long a Silent phone has been quiet. `pulse` is
 * `bali-softpulse` (§7), and `onPulseEnd` hears it finish. In Present the label takes the
 * projector's size (§5).
 */
function Chip({
  display,
  note,
  pulse,
  onPulseEnd,
  present,
}: {
  display: GridDisplay;
  note: string | null;
  pulse: boolean;
  onPulseEnd: () => void;
  present: boolean;
}) {
  const chip = CHIP[display];
  return (
    <span
      onAnimationEnd={pulse ? onPulseEnd : undefined}
      className={`inline-flex max-w-full items-center gap-2 rounded-full border px-3 py-2 uppercase ${present ? 'text-present-label' : 'text-label'} ${chip.tone} ${pulse ? 'animate-softpulse' : ''}`}
    >
      {chip.icons.map((Icon, i) => (
        <Icon key={i} size={present ? 16 : 14} aria-hidden="true" className="shrink-0" />
      ))}
      <span className="min-w-0">{note === null ? chip.label : `${chip.label} · ${note}`}</span>
    </span>
  );
}

export function LiveGrid({
  sessionId,
  onEnded,
  onSession,
  present = false,
}: {
  sessionId: string;
  /** Called with `sessionId` once the server marks the session over: an end event, or a snapshot. */
  onEnded?: (sessionId: string) => void;
  /** Called with the session as each snapshot the grid keeps says it is: its bell (P10). */
  onSession?: (session: SessionView) => void;
  /**
   * The projector view (DESIGN.md §5): four columns, names 20 px, chip labels 14 px, cells at
   * least 88 px tall, readable from the back of a classroom; the same chips and words, but never
   * an unlock's reason: the class can see it (`unlockNote`).
   */
  present?: boolean;
}) {
  const api = useApi();
  const onUnauthorized = useSignOut();
  // The newest callbacks, read where a snapshot lands, so a new one never restarts the stream.
  const onEndedRef = useRef(onEnded);
  const onSessionRef = useRef(onSession);
  useEffect(() => {
    onEndedRef.current = onEnded;
    onSessionRef.current = onSession;
  }, [onEnded, onSession]);
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
        <Button variant="secondary" onClick={() => setAttempt((n) => n + 1)}>
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
        <p className="rounded-sm border border-border-default bg-surface-sunken px-4 py-3 text-body text-text-primary tabular-nums">
          {staleWords(stale)}
        </p>
      ) : null}
      {rows.length === 0 ? (
        <p className="text-body text-text-secondary">No students enrolled yet.</p>
      ) : (
        // Six columns at the desktop width, four in Present, fewer as the grid narrows, never
        // smaller type (§5); the cells straight on the page.
        <div className="@container">
          <ul
            className={`grid gap-2 ${present ? 'grid-cols-2 @2xl:grid-cols-3 @4xl:grid-cols-4' : 'grid-cols-2 @xl:grid-cols-3 @3xl:grid-cols-4 @5xl:grid-cols-5 @6xl:grid-cols-6'}`}
          >
            {rows.map((s) => {
              const display = gridDisplay(s, now);
              const seen = lastSeenNote(s, display, now);
              const unlock = s.unlock?.eventId;
              return (
                <li
                  key={s.studentId}
                  className={`flex flex-col gap-3 ${present ? 'min-h-22' : ''} ${CARD}`}
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
                        className="shrink-0 rounded-xs border border-current px-2 text-caption text-text-tertiary"
                      >
                        Clock off
                      </span>
                    ) : null}
                  </div>
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                    {/* Keyed by its unlock, so each new one pulses from the start; once it has
                        pulsed it leaves the set, so a chip that turns red and back stays still. */}
                    <Chip
                      key={unlock ?? 'none'}
                      display={display}
                      note={
                        display === 'silent' ? silentNote(s, now) : unlockNote(s, display, present)
                      }
                      pulse={softpulses(s, display, liveUnlocks)}
                      present={present}
                      onPulseEnd={() =>
                        setLiveUnlocks((prev) => {
                          const next = new Set(prev);
                          if (unlock !== undefined) next.delete(unlock);
                          return next;
                        })
                      }
                    />
                    {seen === null ? null : (
                      <span className="text-caption text-text-tertiary tabular-nums">{seen}</span>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}
