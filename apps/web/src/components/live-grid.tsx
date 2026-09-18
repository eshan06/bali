'use client';

import {
  deriveDisplayState,
  EVENT_RESUME_OVERLAP,
  type FeedEvent,
  type ParticipationState,
  type SessionSnapshot,
} from '@bali/shared';
import { useEffect, useRef, useState } from 'react';

import { getAccessToken } from '@/lib/auth';
import { config } from '@/lib/config';
import { errText } from '@/lib/errors';
import { createSseClient, type SseClient, type SseStatus } from '@/lib/sse-client';
import { useApi, useSignOut } from '@/lib/use-api';

interface Student {
  studentId: string;
  displayName: string | null;
  state: ParticipationState | null;
  joinedAt: Date | null;
  lastSeenAt: Date | null;
  endedAt: Date | null;
}
type Students = Record<string, Student>;

function fromSnapshot(snap: SessionSnapshot): Students {
  const out: Students = {};
  for (const s of snap.students) {
    out[s.studentId] = {
      studentId: s.studentId,
      displayName: s.displayName,
      state: s.state,
      joinedAt: s.joinedAt ? new Date(s.joinedAt) : null,
      lastSeenAt: s.lastSeenAt ? new Date(s.lastSeenAt) : null,
      endedAt: s.endedAt ? new Date(s.endedAt) : null,
    };
  }
  return out;
}

/** Apply one streamed event onto a copy of the roster (idempotent for the grid). */
function applyEvent(prev: Students, e: FeedEvent): Students {
  const at = new Date(e.occurredAt);
  if (e.type === 'session_ended' || e.type === 'session_expired') {
    const next: Students = {};
    for (const [id, s] of Object.entries(prev)) next[id] = s.endedAt ? s : { ...s, endedAt: at };
    return next;
  }
  const id = e.userId;
  const existing = id ? prev[id] : undefined;
  if (!id || !existing) return prev;
  const s: Student = { ...existing };
  switch (e.type) {
    case 'tap_in':
      s.state = 'focused';
      s.lastSeenAt = at;
      s.endedAt = null;
      s.joinedAt ??= at;
      break;
    case 'unlock':
      s.state = 'unlocked';
      s.lastSeenAt = at;
      break;
    case 'refocus':
      s.state = 'focused';
      s.lastSeenAt = at;
      break;
    case 'protection_off':
      s.state = 'protection_off';
      s.lastSeenAt = at;
      break;
    case 'came_back':
      s.lastSeenAt = at;
      break;
    case 'enrollment_removed':
    case 'enrollment_left':
      s.endedAt = at;
      break;
    default:
      // went_silent is reflected by deriveDisplayState from last_seen_at; other
      // types don't change a chip.
      return prev;
  }
  return { ...prev, [id]: s };
}

const CHIP: Record<string, { label: string; cls: string }> = {
  focused: { label: 'Focused', cls: 'bg-emerald-100 text-emerald-800 border-emerald-300' },
  unlocked: { label: 'Unlocked', cls: 'bg-amber-100 text-amber-900 border-amber-400' },
  protection_off: { label: 'Protection off', cls: 'bg-red-100 text-red-800 border-red-400' },
  silent: { label: 'Silent', cls: 'bg-slate-200 text-slate-600 border-slate-400' },
  ended: { label: 'Left', cls: 'bg-slate-100 text-slate-400 border-slate-200' },
  absent: { label: 'Not here', cls: 'bg-white text-slate-400 border-dashed border-slate-300' },
};

export function LiveGrid({ sessionId }: { sessionId: string }) {
  const api = useApi();
  const onUnauthorized = useSignOut();
  const [students, setStudents] = useState<Students | null>(null);
  const [now, setNow] = useState(() => new Date());
  const [status, setStatus] = useState<SseStatus>('connecting');
  const [error, setError] = useState<string | null>(null);
  const lastUpdate = useRef<number>(Date.now());

  // Boot from the snapshot, then stream.
  useEffect(() => {
    let sse: SseClient | null = null;
    let cancelled = false;
    void (async () => {
      try {
        const snap = await api.get<SessionSnapshot>(`/v1/sessions/${sessionId}`);
        if (cancelled) return;
        setStudents(fromSnapshot(snap));
        lastUpdate.current = Date.now();
        sse = createSseClient({
          url: `${config.apiUrl}/v1/sessions/${sessionId}/stream`,
          getToken: getAccessToken,
          after: snap.latestSeq,
          overlap: EVENT_RESUME_OVERLAP,
          onEvent: (e) => {
            setStudents((prev) => (prev ? applyEvent(prev, e) : prev));
            lastUpdate.current = Date.now();
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
  // (decision 7), so they never reach the grid through the stream alone.
  useEffect(() => {
    const t = setInterval(() => {
      void api.get<SessionSnapshot>(`/v1/sessions/${sessionId}`).then(
        (snap) => setStudents(fromSnapshot(snap)),
        () => {
          /* keep the last-known grid; the banner already shows staleness */
        },
      );
    }, 15_000);
    return () => clearInterval(t);
  }, [api, sessionId]);

  if (error) return <p className="text-sm text-red-600">{error}</p>;
  if (!students) return <p className="text-sm text-slate-500">Loading grid…</p>;

  const staleSec = Math.round((now.getTime() - lastUpdate.current) / 1000);
  const rows = Object.values(students);

  return (
    <div className="space-y-3">
      {status !== 'open' ? (
        <p className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-800">
          Reconnecting — last updated {staleSec}s ago
        </p>
      ) : null}
      {rows.length === 0 ? (
        <p className="text-sm text-slate-500">No students enrolled yet.</p>
      ) : (
        <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4">
          {rows.map((s) => {
            const display =
              s.state === null
                ? 'absent'
                : deriveDisplayState(
                    {
                      state: s.state,
                      joinedAt: s.joinedAt ?? now,
                      lastSeenAt: s.lastSeenAt,
                      endedAt: s.endedAt,
                    },
                    now,
                  );
            const chip = CHIP[display] ?? CHIP.absent;
            return (
              <li key={s.studentId} className={`rounded-lg border px-3 py-2 text-sm ${chip.cls}`}>
                <div className="font-medium">{s.displayName ?? s.studentId.slice(0, 8)}</div>
                <div className="text-xs opacity-80">{chip.label}</div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
