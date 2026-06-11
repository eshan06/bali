'use client';

import { useState, useEffect } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { api } from '@/lib/api-client';
import { Class, SessionAttendanceSummary } from '@bali/shared';

const BRAND = '#2E5BD0';

function periodLabel(period?: string | null): string | null {
  if (!period) return null;
  const trimmed = period.trim();
  if (!trimmed) return null;
  return /^period\b/i.test(trimmed) ? trimmed : `Period ${trimmed}`;
}

function formatDuration(startedAt: string, endedAt?: string | null): string {
  if (!endedAt) return 'In progress';
  const ms = new Date(endedAt).getTime() - new Date(startedAt).getTime();
  const min = Math.max(0, Math.round(ms / 60000));
  if (min < 60) return `${min} min`;
  const hours = Math.floor(min / 60);
  const rest = min % 60;
  return rest === 0 ? `${hours}h` : `${hours}h ${rest}m`;
}

export default function SessionHistoryPage() {
  const { classId } = useParams<{ classId: string }>();
  const [sessions, setSessions] = useState<SessionAttendanceSummary[]>([]);
  const [cls, setCls] = useState<Class | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      api.get<{ sessions: SessionAttendanceSummary[] }>(
        `/classes/${classId}/sessions`
      ),
      api.get<Class>(`/classes/${classId}`).catch(() => null),
    ])
      .then(([sRes, cRes]) => {
        setSessions(sRes.sessions);
        setCls(cRes);
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [classId]);

  return (
    <div className="space-y-8">
      {/* ── HEADER ─────────────────────────────────────────────── */}
      <section className="surface-card-hero rounded-3xl p-7 md:p-9">
        <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-5">
          <div className="space-y-2 min-w-0">
            <p
              className="text-[11px] font-black uppercase tracking-[0.22em]"
              style={{ color: BRAND }}
            >
              {cls ? periodLabel(cls.period) ?? 'Class' : 'History'}
            </p>
            <h1 className="text-3xl md:text-5xl font-black tracking-tight text-gray-900 leading-[1.05]">
              Session history
            </h1>
            <p className="text-sm md:text-base text-gray-500 max-w-xl">
              {cls
                ? `Past attendance for ${cls.name}.`
                : 'Past attendance for this class.'}
            </p>
          </div>
          <Link
            href={`/dashboard/classes/${classId}/`}
            className="inline-flex items-center rounded-full border border-gray-200 bg-white px-5 py-2.5 text-sm font-bold text-gray-700 hover:bg-gray-50 transition-colors self-start"
          >
            Back to class
          </Link>
        </div>
      </section>

      {/* ── CONTENT ────────────────────────────────────────────── */}
      {loading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 animate-pulse">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="surface-card rounded-2xl h-32" />
          ))}
        </div>
      ) : sessions.length === 0 ? (
        <div className="surface-card rounded-3xl px-8 py-20 text-center space-y-3">
          <div
            className="mx-auto h-1 w-16 rounded-full"
            style={{ backgroundColor: BRAND }}
          />
          <h3 className="text-2xl md:text-3xl font-black tracking-tight text-gray-900">
            No sessions yet
          </h3>
          <p className="text-gray-500 max-w-sm mx-auto">
            Start a session to begin tracking attendance for this class.
          </p>
          <Link
            href={`/dashboard/session/?classId=${classId}`}
            className="inline-flex items-center rounded-full px-6 py-3 text-sm font-bold text-white transition-opacity hover:opacity-90 shadow-sm mt-2"
            style={{ backgroundColor: BRAND }}
          >
            Start session
          </Link>
        </div>
      ) : (
        <ul className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {sessions.map((s) => (
            <SessionCard key={s.sessionId} classId={classId} session={s} />
          ))}
        </ul>
      )}
    </div>
  );
}

function SessionCard({
  classId,
  session: s,
}: {
  classId: string;
  session: SessionAttendanceSummary;
}) {
  const dateLabel = new Date(s.startedAt).toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
  const startLabel = new Date(s.startedAt).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
  });
  const endLabel = s.endedAt
    ? new Date(s.endedAt).toLocaleTimeString([], {
        hour: '2-digit',
        minute: '2-digit',
      })
    : null;

  return (
    <li>
      <Link
        href={`/dashboard/classes/${classId}/sessions/${s.sessionId}/`}
        className="surface-card rounded-2xl p-6 flex flex-col gap-4 group transition-all hover:-translate-y-0.5 hover:shadow-md"
      >
        <header className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p
              className="text-[11px] font-black uppercase tracking-[0.18em]"
              style={{ color: BRAND }}
            >
              {dateLabel}
            </p>
            <h3 className="mt-1 text-lg md:text-xl font-black tracking-tight text-gray-900">
              {startLabel}
              {endLabel && (
                <span className="text-gray-400">
                  {' '}
                  – {endLabel}
                </span>
              )}
            </h3>
            <p className="mt-0.5 text-xs text-gray-500">
              {formatDuration(s.startedAt, s.endedAt)}
            </p>
          </div>
          <span className="text-xs font-bold text-gray-400 group-hover:text-brand transition-colors">
            View →
          </span>
        </header>

        <dl className="grid grid-cols-4 gap-2 pt-3 border-t border-gray-100 text-center">
          <SessionStat label="Present" value={s.presentCount} tint="green" />
          <SessionStat label="Late" value={s.lateCount} tint="amber" />
          <SessionStat label="Absent" value={s.absentCount} tint="red" />
          <SessionStat label="Total" value={s.totalCount} tint="muted" />
        </dl>
      </Link>
    </li>
  );
}

function SessionStat({
  label,
  value,
  tint,
}: {
  label: string;
  value: number;
  tint: 'green' | 'amber' | 'red' | 'muted';
}) {
  const cls =
    tint === 'green'
      ? 'text-green-700'
      : tint === 'amber'
      ? 'text-amber-700'
      : tint === 'red'
      ? 'text-red-700'
      : 'text-gray-700';
  return (
    <div>
      <dt className="text-[10px] font-bold uppercase tracking-wider text-gray-400">
        {label}
      </dt>
      <dd className={`mt-1 text-xl font-black tracking-tight leading-none ${cls}`}>
        {value}
      </dd>
    </div>
  );
}
