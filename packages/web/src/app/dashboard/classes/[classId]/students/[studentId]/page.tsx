'use client';

import { useState, useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { api } from '@/lib/api-client';
import { StudentProfile } from '@bali/shared';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  Cell,
} from 'recharts';

const BRAND = '#2E5BD0';

const STATUS_COLORS: Record<string, string> = {
  present: '#15803d',
  late: '#b45309',
  absent: '#b91c1c',
  excused: '#7e22ce',
};

const STATUS_BADGE: Record<string, string> = {
  present: 'bg-green-50 text-green-700 border-green-200',
  late: 'bg-amber-50 text-amber-700 border-amber-200',
  absent: 'bg-red-50 text-red-700 border-red-200',
  excused: 'bg-purple-50 text-purple-700 border-purple-200',
};

function initials(firstName: string, lastName: string): string {
  return `${firstName[0] ?? ''}${lastName[0] ?? ''}`.toUpperCase();
}

export default function StudentProfilePage() {
  const { classId, studentId } = useParams<{
    classId: string;
    studentId: string;
  }>();
  const router = useRouter();
  const [profile, setProfile] = useState<StudentProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [notes, setNotes] = useState('');
  const [editingNotes, setEditingNotes] = useState(false);
  const [savingNotes, setSavingNotes] = useState(false);
  const [view, setView] = useState<'chart' | 'table'>('chart');

  const loadProfile = () => {
    api
      .get<StudentProfile>(`/classes/${classId}/students/${studentId}`)
      .then((data) => {
        setProfile(data);
        setNotes(data.student.notes || '');
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    loadProfile();
  }, [classId, studentId]);

  const saveNotes = async () => {
    setSavingNotes(true);
    try {
      await api.put(`/classes/${classId}/students/${studentId}/notes`, {
        notes,
      });
      setEditingNotes(false);
      loadProfile();
    } catch (err: any) {
      alert(err.message);
    } finally {
      setSavingNotes(false);
    }
  };

  if (loading) {
    return (
      <div className="space-y-8 animate-pulse">
        <div className="surface-card-hero rounded-3xl h-44" />
        <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
          {[0, 1, 2, 3, 4].map((i) => (
            <div key={i} className="surface-card rounded-2xl h-24" />
          ))}
        </div>
        <div className="surface-card rounded-2xl h-72" />
      </div>
    );
  }

  if (!profile) {
    return (
      <div className="surface-card rounded-3xl px-8 py-20 text-center space-y-3">
        <h2 className="text-2xl md:text-3xl font-black tracking-tight text-gray-900">
          Student not found
        </h2>
        <p className="text-gray-500">
          The student you're looking for has been removed or is in a different
          class.
        </p>
        <Link
          href={`/dashboard/classes/${classId}/`}
          className="inline-flex items-center rounded-full px-6 py-3 text-sm font-bold text-white transition-opacity hover:opacity-90 shadow-sm mt-2"
          style={{ backgroundColor: BRAND }}
        >
          Back to class
        </Link>
      </div>
    );
  }

  const {
    student,
    classes,
    device,
    attendanceHistory,
    attendanceStats,
    blockingStatus,
  } = profile;

  const chartData = attendanceHistory
    .slice(0, 20)
    .reverse()
    .map((r) => ({
      name: new Date(r.startedAt).toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
      }),
      status: r.status,
      value: 1,
    }));

  return (
    <div className="space-y-8">
      {/* ── HEADER ─────────────────────────────────────────────── */}
      <section className="surface-card-hero rounded-3xl p-7 md:p-9">
        <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-6">
          <div className="flex items-center gap-5 min-w-0">
            <div
              className="h-16 w-16 md:h-20 md:w-20 rounded-2xl flex items-center justify-center text-xl md:text-2xl font-black text-white shadow-sm flex-shrink-0"
              style={{ backgroundColor: BRAND }}
            >
              {initials(student.firstName, student.lastName)}
            </div>
            <div className="space-y-1.5 min-w-0">
              <p
                className="text-[11px] font-black uppercase tracking-[0.22em]"
                style={{ color: BRAND }}
              >
                Student
              </p>
              <h1 className="text-3xl md:text-5xl font-black tracking-tight text-gray-900 leading-[1.05] truncate">
                {student.firstName} {student.lastName}
              </h1>
              <p className="text-sm md:text-base text-gray-500">
                Enrolled{' '}
                {new Date(student.enrolledAt).toLocaleDateString('en-US', {
                  month: 'long',
                  day: 'numeric',
                  year: 'numeric',
                })}
              </p>
            </div>
          </div>
          <button
            onClick={() => router.push(`/dashboard/classes/${classId}/`)}
            className="inline-flex items-center rounded-full border border-gray-200 bg-white px-5 py-2.5 text-sm font-bold text-gray-700 hover:bg-gray-50 transition-colors self-start"
          >
            Back to class
          </button>
        </div>
      </section>

      {/* ── STATS ──────────────────────────────────────────────── */}
      <section className="grid grid-cols-2 md:grid-cols-5 gap-4">
        <StatTile label="Attendance" value={`${attendanceStats.rate}%`} />
        <StatTile label="Present" value={attendanceStats.present} tint="green" />
        <StatTile label="Late" value={attendanceStats.late} tint="amber" />
        <StatTile label="Absent" value={attendanceStats.absent} tint="red" />
        <StatTile label="Excused" value={attendanceStats.excused} tint="purple" />
      </section>

      {/* ── INFO CARDS ─────────────────────────────────────────── */}
      <section className="grid grid-cols-1 md:grid-cols-3 gap-5">
        <InfoCard title="Contact">
          <InfoRow label="Email" value={student.email || 'Not provided'} />
          {student.externalId && (
            <InfoRow label="External ID" value={student.externalId} mono />
          )}
        </InfoCard>

        <InfoCard title="Device">
          {device ? (
            <>
              <InfoRow label="Device ID" value={device.deviceId} mono />
              {device.friendlyName && (
                <InfoRow label="Friendly name" value={device.friendlyName} />
              )}
            </>
          ) : (
            <p className="text-sm text-gray-400">No device assigned</p>
          )}
        </InfoCard>

        <InfoCard title="Blocking">
          {blockingStatus ? (
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <span
                  className="h-2.5 w-2.5 rounded-full"
                  style={{
                    backgroundColor: blockingStatus.isBlocked
                      ? '#15803d'
                      : '#d1d5db',
                  }}
                />
                <p className="text-sm font-bold text-gray-900">
                  {blockingStatus.isBlocked
                    ? 'Active — apps blocked'
                    : 'Not blocking'}
                </p>
              </div>
              <p className="text-xs text-gray-500">
                Reported by {blockingStatus.reportedBy} at{' '}
                {new Date(blockingStatus.reportedAt).toLocaleTimeString([], {
                  hour: '2-digit',
                  minute: '2-digit',
                })}
              </p>
            </div>
          ) : (
            <p className="text-sm text-gray-400">No active session</p>
          )}
        </InfoCard>
      </section>

      {/* ── CLASSES ENROLLED ──────────────────────────────────── */}
      {classes.length > 1 && (
        <section className="surface-card rounded-2xl p-7 space-y-4">
          <header>
            <p
              className="text-[11px] font-black uppercase tracking-[0.18em]"
              style={{ color: BRAND }}
            >
              Enrolled
            </p>
            <h3 className="mt-1 text-xl font-black tracking-tight text-gray-900">
              Classes ({classes.length})
            </h3>
          </header>
          <div className="flex flex-wrap gap-2">
            {classes.map((c) => {
              const active = c.id === classId;
              return (
                <Link
                  key={c.id}
                  href={`/dashboard/classes/${c.id}/`}
                  className={`rounded-full border px-3.5 py-1.5 text-sm font-bold transition-all ${
                    active
                      ? ''
                      : 'bg-white text-gray-700 border-gray-200 hover:bg-gray-50'
                  }`}
                  style={
                    active
                      ? {
                          backgroundColor: 'rgba(46, 91, 208, 0.10)',
                          color: BRAND,
                          borderColor: BRAND,
                        }
                      : undefined
                  }
                >
                  {c.name}
                  {c.period ? ` (${c.period})` : ''}
                </Link>
              );
            })}
          </div>
        </section>
      )}

      {/* ── ATTENDANCE HISTORY ────────────────────────────────── */}
      <section className="surface-card rounded-2xl overflow-hidden">
        <header className="flex items-end justify-between gap-3 p-7 pb-5">
          <div className="space-y-1.5 min-w-0">
            <p
              className="text-[11px] font-black uppercase tracking-[0.18em]"
              style={{ color: BRAND }}
            >
              History
            </p>
            <h3 className="text-xl md:text-2xl font-black tracking-tight text-gray-900">
              Attendance history
            </h3>
          </div>
          <div className="inline-flex rounded-full border border-gray-200 overflow-hidden flex-shrink-0">
            <button
              onClick={() => setView('chart')}
              className={`px-4 py-1.5 text-xs font-bold transition-colors ${
                view === 'chart'
                  ? 'bg-gray-900 text-white'
                  : 'bg-white text-gray-600 hover:bg-gray-50'
              }`}
            >
              Chart
            </button>
            <button
              onClick={() => setView('table')}
              className={`px-4 py-1.5 text-xs font-bold transition-colors ${
                view === 'table'
                  ? 'bg-gray-900 text-white'
                  : 'bg-white text-gray-600 hover:bg-gray-50'
              }`}
            >
              Table
            </button>
          </div>
        </header>

        {attendanceHistory.length === 0 ? (
          <div className="px-8 py-12 text-center text-sm text-gray-500">
            No attendance records yet.
          </div>
        ) : view === 'chart' ? (
          <div className="px-7 pb-7">
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={chartData} barCategoryGap="20%">
                <XAxis
                  dataKey="name"
                  tick={{ fontSize: 11, fill: '#6b7280' }}
                  axisLine={false}
                  tickLine={false}
                />
                <YAxis hide />
                <Tooltip
                  content={({ active, payload }) => {
                    if (!active || !payload?.[0]) return null;
                    const d = payload[0].payload;
                    return (
                      <div className="bg-white border border-gray-100 rounded-xl px-3 py-2 shadow-md text-xs">
                        <p className="font-bold">{d.name}</p>
                        <p
                          className="capitalize font-medium"
                          style={{ color: STATUS_COLORS[d.status] }}
                        >
                          {d.status}
                        </p>
                      </div>
                    );
                  }}
                />
                <Bar dataKey="value" radius={[6, 6, 0, 0]}>
                  {chartData.map((entry, i) => (
                    <Cell
                      key={i}
                      fill={STATUS_COLORS[entry.status] || '#d1d5db'}
                    />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
            <div className="flex flex-wrap justify-center gap-4 mt-4">
              {Object.entries(STATUS_COLORS).map(([status, color]) => (
                <div key={status} className="flex items-center gap-1.5">
                  <span
                    className="h-2.5 w-2.5 rounded-full"
                    style={{ backgroundColor: color }}
                  />
                  <span className="text-xs font-medium text-gray-500 capitalize">
                    {status}
                  </span>
                </div>
              ))}
            </div>
          </div>
        ) : (
          <ul className="divide-y divide-gray-100">
            {attendanceHistory.map((r) => (
              <li
                key={r.sessionId}
                className="flex items-center gap-4 px-7 py-3 hover:bg-gray-50 transition-colors"
              >
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-bold text-gray-900">
                    {new Date(r.startedAt).toLocaleDateString('en-US', {
                      weekday: 'short',
                      month: 'short',
                      day: 'numeric',
                    })}
                  </p>
                  <p className="text-xs text-gray-500">
                    {r.checkInAt
                      ? `Checked in ${new Date(
                          r.checkInAt
                        ).toLocaleTimeString([], {
                          hour: '2-digit',
                          minute: '2-digit',
                        })}`
                      : 'No check-in'}
                    {r.isOverride && (
                      <span className="ml-2 inline-flex items-center rounded-full bg-gray-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-gray-600">
                        manual
                      </span>
                    )}
                  </p>
                </div>
                <span
                  className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-[11px] font-bold uppercase tracking-wider ${
                    STATUS_BADGE[r.status] ??
                    'bg-gray-50 text-gray-500 border-gray-200'
                  }`}
                >
                  {r.status}
                </span>
                <BlockingPill state={r.blockingStatus} />
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* ── NOTES ────────────────────────────────────────────── */}
      <section className="surface-card rounded-2xl p-7 space-y-4">
        <header className="flex items-end justify-between gap-3">
          <div className="space-y-1.5">
            <p
              className="text-[11px] font-black uppercase tracking-[0.18em]"
              style={{ color: BRAND }}
            >
              Notes
            </p>
            <h3 className="text-xl md:text-2xl font-black tracking-tight text-gray-900">
              Teacher notes
            </h3>
          </div>
          {!editingNotes && (
            <button
              onClick={() => setEditingNotes(true)}
              className="inline-flex items-center rounded-full border border-gray-200 bg-white px-4 py-1.5 text-xs font-bold text-gray-700 hover:bg-gray-50 transition-colors"
            >
              Edit
            </button>
          )}
        </header>

        {editingNotes ? (
          <div className="space-y-3">
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={5}
              placeholder="Add notes about this student…"
              className="w-full rounded-xl border border-gray-200 bg-white px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-brand/30 resize-none"
            />
            <div className="flex gap-2">
              <button
                onClick={saveNotes}
                disabled={savingNotes}
                className="rounded-full px-5 py-2 text-sm font-bold text-white transition-opacity hover:opacity-90 disabled:opacity-50 shadow-sm"
                style={{ backgroundColor: BRAND }}
              >
                {savingNotes ? 'Saving…' : 'Save notes'}
              </button>
              <button
                onClick={() => {
                  setEditingNotes(false);
                  setNotes(student.notes || '');
                }}
                className="rounded-full border border-gray-200 bg-white px-5 py-2 text-sm font-bold text-gray-700 hover:bg-gray-50 transition-colors"
              >
                Cancel
              </button>
            </div>
          </div>
        ) : student.notes ? (
          <p className="text-sm text-gray-700 whitespace-pre-wrap leading-relaxed">
            {student.notes}
          </p>
        ) : (
          <p className="text-sm text-gray-400">
            No notes yet. Add one to keep context for this student.
          </p>
        )}
      </section>
    </div>
  );
}

/* ────────────────────────────────────────────────────────────────────────── */

function StatTile({
  label,
  value,
  tint,
}: {
  label: string;
  value: string | number;
  tint?: 'green' | 'amber' | 'red' | 'purple';
}) {
  const cls =
    tint === 'green'
      ? 'text-green-700'
      : tint === 'amber'
      ? 'text-amber-700'
      : tint === 'red'
      ? 'text-red-700'
      : tint === 'purple'
      ? 'text-purple-700'
      : 'text-gray-900';
  return (
    <div className="surface-card rounded-2xl p-5">
      <p className="text-[11px] font-black uppercase tracking-[0.18em] text-gray-400">
        {label}
      </p>
      <p
        className={`mt-2 text-2xl md:text-3xl font-black tracking-tight leading-none ${cls}`}
      >
        {value}
      </p>
    </div>
  );
}

function InfoCard({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="surface-card rounded-2xl p-6 space-y-3">
      <h3 className="text-sm font-black tracking-tight text-gray-900">
        {title}
      </h3>
      <div className="space-y-2">{children}</div>
    </div>
  );
}

function InfoRow({
  label,
  value,
  mono,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div>
      <p className="text-[11px] font-bold uppercase tracking-wider text-gray-400">
        {label}
      </p>
      <p
        className={`text-sm text-gray-900 truncate ${mono ? 'font-mono' : ''}`}
      >
        {value}
      </p>
    </div>
  );
}

function BlockingPill({ state }: { state: string }) {
  if (state === 'active') {
    return (
      <span className="inline-flex items-center rounded-full border border-green-200 bg-green-50 px-2.5 py-0.5 text-[11px] font-bold uppercase tracking-wider text-green-700">
        Blocking on
      </span>
    );
  }
  if (state === 'inactive') {
    return (
      <span className="inline-flex items-center rounded-full border border-gray-200 bg-gray-50 px-2.5 py-0.5 text-[11px] font-bold uppercase tracking-wider text-gray-500">
        Off
      </span>
    );
  }
  if (state === 'student_override') {
    return (
      <span className="inline-flex items-center rounded-full border border-amber-200 bg-amber-50 px-2.5 py-0.5 text-[11px] font-bold uppercase tracking-wider text-amber-700">
        Override
      </span>
    );
  }
  return <span className="text-xs text-gray-300">—</span>;
}
