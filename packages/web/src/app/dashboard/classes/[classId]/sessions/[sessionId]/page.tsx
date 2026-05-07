'use client';

import { useState, useEffect, useCallback } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { api } from '@/lib/api-client';
import { AttendanceRecord, Class } from '@bali/shared';

const BRAND = '#2E5BD0';

const STATUS_BADGE: Record<string, string> = {
  present: 'bg-green-50 text-green-700 border-green-200',
  late: 'bg-amber-50 text-amber-700 border-amber-200',
  absent: 'bg-red-50 text-red-700 border-red-200',
  excused: 'bg-purple-50 text-purple-700 border-purple-200',
  pending: 'bg-gray-50 text-gray-500 border-gray-200',
};

interface SessionAttendance {
  sessionId: string;
  startedAt: string;
  endedAt?: string | null;
  students: AttendanceRecord[];
}

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

export default function SessionDetailPage() {
  const { classId, sessionId } = useParams<{
    classId: string;
    sessionId: string;
  }>();
  const [attendance, setAttendance] = useState<SessionAttendance | null>(null);
  const [cls, setCls] = useState<Class | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(() => {
    setLoading(true);
    Promise.all([
      api.get<SessionAttendance>(`/sessions/${sessionId}/attendance`),
      api.get<Class>(`/classes/${classId}`).catch(() => null),
    ])
      .then(([att, c]) => {
        setAttendance(att);
        setCls(c);
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [classId, sessionId]);

  useEffect(() => {
    load();
  }, [load]);

  const handleOverride = async (studentId: string, status: string) => {
    await api.put(`/sessions/${sessionId}/attendance/${studentId}`, { status });
    load();
  };

  if (loading) {
    return (
      <div className="space-y-8 animate-pulse">
        <div className="surface-card-hero rounded-3xl h-44" />
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="surface-card rounded-2xl h-24" />
          ))}
        </div>
        <div className="surface-card rounded-2xl h-64" />
      </div>
    );
  }

  if (!attendance) {
    return (
      <div className="surface-card rounded-3xl px-8 py-20 text-center space-y-3">
        <h2 className="text-2xl md:text-3xl font-black tracking-tight text-gray-900">
          Session not found
        </h2>
        <p className="text-gray-500">
          That session may have been removed or you don't have access.
        </p>
        <Link
          href={`/dashboard/classes/${classId}/sessions/`}
          className="inline-flex items-center rounded-full px-6 py-3 text-sm font-bold text-white transition-opacity hover:opacity-90 shadow-sm mt-2"
          style={{ backgroundColor: BRAND }}
        >
          Back to history
        </Link>
      </div>
    );
  }

  const present = attendance.students.filter((s) => s.status === 'present').length;
  const late = attendance.students.filter((s) => s.status === 'late').length;
  const absent = attendance.students.filter((s) => s.status === 'absent').length;
  const excused = attendance.students.filter((s) => s.status === 'excused').length;
  const dateLabel = new Date(attendance.startedAt).toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });
  const startLabel = new Date(attendance.startedAt).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
  });
  const endLabel = attendance.endedAt
    ? new Date(attendance.endedAt).toLocaleTimeString([], {
        hour: '2-digit',
        minute: '2-digit',
      })
    : null;

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
              {cls ? periodLabel(cls.period) ?? 'Session' : 'Session'}
            </p>
            <h1 className="text-3xl md:text-5xl font-black tracking-tight text-gray-900 leading-[1.05] truncate">
              {cls?.name ?? 'Session attendance'}
            </h1>
            <p className="text-sm md:text-base text-gray-500">
              {dateLabel} · {startLabel}
              {endLabel && ` – ${endLabel}`} ·{' '}
              {formatDuration(attendance.startedAt, attendance.endedAt)}
            </p>
          </div>
          <Link
            href={`/dashboard/classes/${classId}/sessions/`}
            className="inline-flex items-center rounded-full border border-gray-200 bg-white px-5 py-2.5 text-sm font-bold text-gray-700 hover:bg-gray-50 transition-colors self-start"
          >
            Back to history
          </Link>
        </div>
      </section>

      {/* ── SUMMARY CARDS ──────────────────────────────────────── */}
      <section className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <SummaryCard label="Present" value={present} tint="green" />
        <SummaryCard label="Late" value={late} tint="amber" />
        <SummaryCard label="Absent" value={absent} tint="red" />
        <SummaryCard label="Excused" value={excused} tint="purple" />
      </section>

      {/* ── STUDENT LIST ──────────────────────────────────────── */}
      <section className="surface-card rounded-2xl overflow-hidden">
        <header className="px-7 pt-6 pb-4">
          <h2 className="text-xl md:text-2xl font-black tracking-tight text-gray-900">
            Students
          </h2>
          <p className="mt-1 text-sm text-gray-500">
            Final attendance for this session. You can still override below.
          </p>
        </header>

        {attendance.students.length === 0 ? (
          <div className="px-8 py-12 text-center text-sm text-gray-500">
            No students were enrolled in this session.
          </div>
        ) : (
          <ul className="divide-y divide-gray-100">
            {attendance.students.map((s: any) => (
              <li
                key={s.studentId}
                className="flex items-center gap-4 px-7 py-4 hover:bg-gray-50 transition-colors"
              >
                <div className="flex-1 min-w-0">
                  <p className="font-bold text-gray-900 truncate">
                    {s.firstName} {s.lastName}
                  </p>
                  <p className="text-xs text-gray-500">
                    {s.checkInAt
                      ? `Checked in ${new Date(s.checkInAt).toLocaleTimeString(
                          [],
                          { hour: '2-digit', minute: '2-digit' }
                        )}`
                      : 'No check-in'}
                    {s.isOverride && (
                      <span className="ml-2 inline-flex items-center rounded-full bg-gray-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-gray-600">
                        manual
                      </span>
                    )}
                  </p>
                </div>
                <span
                  className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-[11px] font-bold uppercase tracking-wider ${
                    STATUS_BADGE[s.status] ?? STATUS_BADGE.pending
                  }`}
                >
                  {s.status}
                </span>
                <select
                  value={s.status}
                  onChange={(e) => handleOverride(s.studentId, e.target.value)}
                  aria-label={`Override status for ${s.firstName} ${s.lastName}`}
                  className="text-xs rounded-lg border border-gray-200 bg-white px-2.5 py-1.5 font-medium text-gray-700 focus:outline-none focus:ring-2 focus:ring-brand/30"
                >
                  <option value="present">Present</option>
                  <option value="late">Late</option>
                  <option value="absent">Absent</option>
                  <option value="excused">Excused</option>
                </select>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function SummaryCard({
  label,
  value,
  tint,
}: {
  label: string;
  value: number;
  tint: 'green' | 'amber' | 'red' | 'purple';
}) {
  const cls =
    tint === 'green'
      ? 'text-green-700'
      : tint === 'amber'
      ? 'text-amber-700'
      : tint === 'red'
      ? 'text-red-700'
      : 'text-purple-700';
  return (
    <div className="surface-card rounded-2xl p-5">
      <p className="text-[11px] font-black uppercase tracking-[0.18em] text-gray-400">
        {label}
      </p>
      <p
        className={`mt-2 text-3xl md:text-4xl font-black tracking-tight leading-none ${cls}`}
      >
        {value}
      </p>
    </div>
  );
}
