'use client';

import { EVENT_RESUME_OVERLAP, type SessionSnapshot, STREAM_HEARTBEAT_MS } from '@bali/shared';
import { useEffect, useRef, useState } from 'react';

import { getAccessToken } from '@/lib/auth';
import { config } from '@/lib/config';
import { errText } from '@/lib/errors';
import {
  applyEvent,
  fromSnapshot,
  gridDisplay,
  type GridDisplay,
  mergeSnapshot,
  snapshotIsFresh,
  staleness,
  type Students,
  unlockNote,
} from '@/lib/grid-state';
import { createSseClient, type SseClient, type SseStatus } from '@/lib/sse-client';
import { useApi, useSignOut } from '@/lib/use-api';

/**
 * The server's own heartbeat interval (`apps/api/src/sse/hub.ts`). The grid
 * measures silence against it rather than a number of its own, so the two
 * cannot drift into a banner that flaps or one that never fires.
 */

const CHIP: Record<GridDisplay, { label: string; cls: string }> = {
  focused: { label: 'Focused', cls: 'bg-emerald-100 text-emerald-800 border-emerald-300' },
  unlocked: { label: 'Unlocked', cls: 'bg-amber-100 text-amber-900 border-amber-400' },
  protection_off: { label: 'Protection off', cls: 'bg-red-100 text-red-800 border-red-400' },
  silent: { label: 'Silent', cls: 'bg-slate-200 text-slate-600 border-slate-400' },
  ended: { label: 'Left', cls: 'bg-slate-100 text-slate-400 border-slate-200' },
  // Left the session AND unshielded — the ISSUES #2 case. Loud on purpose: it
  // must not read as the quiet "Left" chip.
  left_unprotected: { label: 'Left · unlocked', cls: 'bg-red-100 text-red-800 border-red-400' },
  // The same, for a phone whose Screen Time permission was off: never an unlock.
  left_protection_off: {
    label: 'Left · protection off',
    cls: 'bg-red-100 text-red-800 border-red-400',
  },
  absent: { label: 'Not here', cls: 'bg-white text-slate-400 border-dashed border-slate-300' },
  unknown: {
    label: 'Unknown · refresh',
    cls: 'bg-white text-slate-700 border-dashed border-slate-500',
  },
};

export function LiveGrid({ sessionId }: { sessionId: string }) {
  const api = useApi();
  const onUnauthorized = useSignOut();
  const [students, setStudents] = useState<Students | null>(null);
  const [now, setNow] = useState(() => new Date());
  const [status, setStatus] = useState<SseStatus>('connecting');
  const [error, setError] = useState<string | null>(null);
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
    let sse: SseClient | null = null;
    let cancelled = false;
    void (async () => {
      try {
        const snap = await api.get<SessionSnapshot>(`/v1/sessions/${sessionId}`);
        if (cancelled) return;
        setStudents(fromSnapshot(snap));
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
            if (e.seq > appliedSeq.current) appliedSeq.current = e.seq;
            lastStreamActivity.current = Date.now();
            lastGridActivity.current = Date.now();
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
  }, [api, sessionId, onUnauthorized]);

  // Local clock so the silent badge appears with zero event traffic.
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  // Slow snapshot refresh keeps derived silence honest for quietly-present
  // students: heartbeats update last_seen_at server-side but emit no event
  // (decision 7), so they never reach the grid through the stream alone. It is
  // dropped when the stream has already applied something newer — a snapshot
  // read before an unlock but resolving after it would put the chip back to
  // green for an unshielded phone.
  useEffect(() => {
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
          if (!snapshotIsFresh(snap.latestSeq, appliedSeq.current)) return;
          appliedSeq.current = snap.latestSeq;
          setStudents((cur) => (cur ? mergeSnapshot(cur, snap) : fromSnapshot(snap)));
        },
        () => {
          /* keep the last-known grid; the banner already shows staleness */
        },
      );
    }, 15_000);
    return () => clearInterval(t);
  }, [api, sessionId]);

  if (error) return <p className="text-sm text-red-600">{error}</p>;
  if (!students) return <p className="text-sm text-slate-500">Loading grid…</p>;

  const stale = staleness({
    status,
    lastStreamActivityAt: lastStreamActivity.current,
    lastGridActivityAt: lastGridActivity.current,
    now: now.getTime(),
    heartbeatMs: STREAM_HEARTBEAT_MS,
  });
  const rows = Object.values(students);

  return (
    <div className="space-y-3">
      {stale ? (
        <p className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-800">
          {stale.reason === 'reconnecting' ? 'Reconnecting' : 'Live feed has gone quiet'} — last
          updated {stale.secondsAgo}s ago
        </p>
      ) : null}
      {rows.length === 0 ? (
        <p className="text-sm text-slate-500">No students enrolled yet.</p>
      ) : (
        <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4">
          {rows.map((s) => {
            const display = gridDisplay(s, now);
            const chip = CHIP[display];
            // The unlock the chip carries — its reason, or on a protection-off
            // chip the unlock itself — rides after the label, never replacing it.
            const note = unlockNote(s, display);
            return (
              <li key={s.studentId} className={`rounded-lg border px-3 py-2 text-sm ${chip.cls}`}>
                <div className="font-medium">{s.displayName ?? s.studentId.slice(0, 8)}</div>
                <div className="text-xs opacity-80">
                  {note === null ? chip.label : `${chip.label} · ${note}`}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
