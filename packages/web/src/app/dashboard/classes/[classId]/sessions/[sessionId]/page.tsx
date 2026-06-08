'use client';

import { useState, useEffect, useCallback } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { api } from '@/lib/api-client';
import {
  AttendanceRecord,
  Class,
  ClassSession,
  Device,
  DeviceBlockingStatus,
  INACTIVE_BLOCKING_SNAPSHOT,
  type BlockingSnapshot,
} from '@bali/shared';

const BRAND = '#2E5BD0';

const PRESET_LABELS: Record<string, string> = {
  full_focus: 'Full Focus',
  no_social_media: 'No Social Media',
  no_games: 'No Games',
  custom: 'Custom',
  none: 'No blocking',
};

const STATUS_BADGE: Record<string, string> = {
  present: 'bg-green-50 text-green-700 border-green-200',
  late: 'bg-amber-50 text-amber-700 border-amber-200',
  absent: 'bg-red-50 text-red-700 border-red-200',
  excused: 'bg-purple-50 text-purple-700 border-purple-200',
  pending: 'bg-gray-50 text-gray-500 border-gray-200',
};

const STATUS_LABEL: Record<string, string> = {
  present: 'Present',
  late: 'Late',
  absent: 'Absent',
  excused: 'Excused',
  pending: 'Waiting',
};

interface SessionAttendance {
  sessionId: string;
  startedAt: string;
  endedAt?: string | null;
  students: AttendanceRecord[];
}

interface EmergencyStop {
  id: string;
  studentId: string;
  firstName: string;
  lastName: string;
  reason: string | null;
  note: string | null;
  createdAt: string;
}

type BlockingState =
  | 'applied'
  | 'failed'
  | 'unknown'
  | 'inactive'
  | 'no_device'
  | 'student_override';

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
  if (min < 1) return '< 1 min';
  if (min < 60) return `${min} min`;
  const hours = Math.floor(min / 60);
  const rest = min % 60;
  return rest === 0 ? `${hours}h` : `${hours}h ${rest}m`;
}

function buildSummary(
  counts: { present: number; late: number; absent: number; excused: number; total: number },
  blockingActive: boolean
): string {
  const parts: string[] = [];
  if (counts.total === 0) {
    parts.push('No students were enrolled in this session.');
  } else {
    const presentLine =
      counts.present === 1
        ? '1 student checked in'
        : `${counts.present} students checked in`;
    parts.push(`${presentLine}.`);
    if (counts.late > 0) parts.push(`${counts.late} ${counts.late === 1 ? 'was' : 'were'} late.`);
    if (counts.absent > 0) parts.push(`${counts.absent} ${counts.absent === 1 ? 'was' : 'were'} absent.`);
    if (counts.excused > 0) parts.push(`${counts.excused} ${counts.excused === 1 ? 'was' : 'were'} excused.`);
  }
  parts.push(
    blockingActive
      ? 'Blocking was active for this session.'
      : 'Blocking was not active for this session.'
  );
  return parts.join(' ');
}

function blockingStateFor(opts: {
  blockingActive: boolean;
  hasDevice: boolean;
  status: DeviceBlockingStatus | undefined;
}): { state: BlockingState; label: string; tint: string } {
  if (!opts.blockingActive) {
    return {
      state: 'inactive',
      label: 'Not active',
      tint: 'bg-gray-50 text-gray-500 border-gray-200',
    };
  }
  if (!opts.hasDevice) {
    return {
      state: 'no_device',
      label: 'No device assigned',
      tint: 'bg-gray-50 text-gray-500 border-gray-200',
    };
  }
  if (!opts.status) {
    return {
      state: 'unknown',
      label: 'Blocking status not reported',
      tint: 'bg-gray-50 text-gray-500 border-gray-200',
    };
  }
  if (opts.status.isBlocked) {
    return {
      state: 'applied',
      label: 'Blocking applied',
      tint: 'bg-green-50 text-green-700 border-green-200',
    };
  }
  // Student-initiated Emergency Stop — an intentional unlock, not a failure.
  if (opts.status.reportedBy === 'student_override') {
    return {
      state: 'student_override',
      label: 'Emergency Stop',
      tint: 'bg-amber-50 text-amber-700 border-amber-200',
    };
  }
  return {
    state: 'failed',
    label: 'Blocking failed',
    tint: 'bg-red-50 text-red-700 border-red-200',
  };
}

function csvEscape(value: string | null | undefined): string {
  if (value === null || value === undefined) return '';
  const s = String(value);
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function fmtTime(t: string): string {
  return new Date(t).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
  });
}

/**
 * Horizontal timeline of student-initiated Emergency Stops across the session's
 * duration — a marker per stop positioned by time, plus a per-event detail list.
 * Fed by the durable emergency_stop_log via /sessions/:id/emergency-stops.
 */
function EmergencyStopTimeline({
  startedAt,
  endedAt,
  stops,
}: {
  startedAt: string;
  endedAt?: string | null;
  stops: EmergencyStop[];
}) {
  const start = new Date(startedAt).getTime();
  const end = endedAt ? new Date(endedAt).getTime() : Date.now();
  const span = Math.max(end - start, 60_000);
  const ordered = [...stops].sort(
    (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
  );

  return (
    <section className="surface-card rounded-2xl p-7 space-y-6">
      <div className="space-y-1.5">
        <p
          className="text-[11px] font-black uppercase tracking-[0.18em]"
          style={{ color: BRAND }}
        >
          Focus
        </p>
        <h2 className="text-xl md:text-2xl font-black tracking-tight text-gray-900">
          Emergency Stops
        </h2>
        <p className="text-sm text-gray-500">
          {stops.length} student-initiated{' '}
          {stops.length === 1 ? 'stop' : 'stops'} during this session. Focus
          unlocked immediately; attendance was unaffected.
        </p>
      </div>

      <div className="px-1 pt-2">
        <div className="relative h-2 rounded-full bg-gray-100">
          {ordered.map((s) => {
            const pct = Math.min(
              98,
              Math.max(
                2,
                ((new Date(s.createdAt).getTime() - start) / span) * 100
              )
            );
            return (
              <div
                key={s.id}
                className="absolute top-1/2 h-3.5 w-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-amber-500 ring-4 ring-amber-100"
                style={{ left: `${pct}%` }}
                title={`Emergency Stop · ${fmtTime(s.createdAt)}`}
              />
            );
          })}
        </div>
        <div className="mt-3 flex justify-between text-[11px] font-semibold text-gray-400">
          <span>{fmtTime(startedAt)} · started</span>
          <span>
            {endedAt ? `${fmtTime(endedAt)} · ended` : 'in progress'}
          </span>
        </div>
      </div>

      <ul className="divide-y divide-gray-100 border-t border-gray-100">
        {ordered.map((s) => (
          <li
            key={s.id}
            className="flex flex-wrap items-center gap-x-2 gap-y-1 py-2.5 text-sm"
          >
            <span className="h-2 w-2 flex-shrink-0 rounded-full bg-amber-500" />
            <span className="font-bold text-gray-900">
              {s.firstName} {s.lastName}
            </span>
            <span className="text-gray-300">·</span>
            <span className="text-gray-600">{fmtTime(s.createdAt)}</span>
            {s.reason && s.reason.toLowerCase() !== 'unspecified' && (
              <>
                <span className="text-gray-300">·</span>
                <span className="text-gray-600">{s.reason}</span>
              </>
            )}
            {s.note && (
              <span className="w-full truncate italic text-gray-500 sm:w-auto">
                “{s.note}”
              </span>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

export default function SessionDetailPage() {
  const { classId, sessionId } = useParams<{
    classId: string;
    sessionId: string;
  }>();
  const [attendance, setAttendance] = useState<SessionAttendance | null>(null);
  const [session, setSession] = useState<ClassSession | null>(null);
  const [cls, setCls] = useState<Class | null>(null);
  const [devices, setDevices] = useState<Device[]>([]);
  const [deviceStatuses, setDeviceStatuses] = useState<DeviceBlockingStatus[]>(
    []
  );
  const [emergencyStops, setEmergencyStops] = useState<EmergencyStop[]>([]);
  const [loading, setLoading] = useState(true);
  const [errored, setErrored] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    setErrored(false);
    Promise.all([
      api.get<SessionAttendance>(`/sessions/${sessionId}/attendance`),
      api.get<ClassSession>(`/sessions/${sessionId}`),
      api.get<Class>(`/classes/${classId}`).catch(() => null),
      api.get<{ devices: Device[] }>('/devices').catch(() => ({ devices: [] })),
      api
        .get<{ statuses: DeviceBlockingStatus[] }>(
          `/sessions/${sessionId}/device-status`
        )
        .catch(() => ({ statuses: [] })),
      api
        .get<{ stops: EmergencyStop[] }>(
          `/sessions/${sessionId}/emergency-stops`
        )
        .catch(() => ({ stops: [] })),
    ])
      .then(([att, sess, c, dev, ds, es]) => {
        setAttendance(att);
        setSession(sess);
        setCls(c);
        setDevices(dev.devices);
        setDeviceStatuses(ds.statuses);
        setEmergencyStops(es.stops);
      })
      .catch(() => setErrored(true))
      .finally(() => setLoading(false));
  }, [classId, sessionId]);

  useEffect(() => {
    load();
  }, [load]);

  const handleOverride = async (studentId: string, status: string) => {
    await api.put(`/sessions/${sessionId}/attendance/${studentId}`, { status });
    load();
  };

  const handleExport = () => {
    if (!attendance) return;
    const deviceByStudent = new Map(
      devices.filter((d) => d.studentId).map((d) => [d.studentId!, d])
    );
    const statusByStudent = new Map(
      deviceStatuses.map((d) => [d.studentId, d])
    );
    const snapshot: BlockingSnapshot =
      session?.blockingConfigSnapshot ?? INACTIVE_BLOCKING_SNAPSHOT;
    const blockingActive = !!session?.blockingEnabled && snapshot.blockingActive;

    const startDate = new Date(attendance.startedAt).toLocaleDateString('en-US');
    const startTime = new Date(attendance.startedAt).toLocaleTimeString([], {
      hour: '2-digit',
      minute: '2-digit',
    });
    const endTime = attendance.endedAt
      ? new Date(attendance.endedAt).toLocaleTimeString([], {
          hour: '2-digit',
          minute: '2-digit',
        })
      : '';

    const meta: string[][] = [
      ['Class', cls?.name ?? ''],
      ['Period', cls?.period ?? ''],
      ['Date', startDate],
      ['Start time', startTime],
      ['End time', endTime],
      ['Duration', formatDuration(attendance.startedAt, attendance.endedAt)],
      ['Blocking policy', PRESET_LABELS[snapshot.preset] ?? 'No blocking'],
      [],
    ];

    const header = [
      'Student',
      'Status',
      'Check-in time',
      'Device ID',
      'Blocking status',
      'Manually overridden',
    ];

    const rows = attendance.students.map((s: any) => {
      const device = deviceByStudent.get(s.studentId);
      const status = statusByStudent.get(s.studentId);
      const blocking = blockingStateFor({
        blockingActive,
        hasDevice: !!device,
        status,
      });
      return [
        `${s.firstName} ${s.lastName}`,
        STATUS_LABEL[s.status] ?? s.status,
        s.checkInAt
          ? new Date(s.checkInAt).toLocaleTimeString([], {
              hour: '2-digit',
              minute: '2-digit',
            })
          : '',
        device?.deviceId ?? '',
        blocking.label,
        s.isOverride ? 'Yes' : '',
      ];
    });

    const csv = [...meta, header, ...rows]
      .map((row) => row.map(csvEscape).join(','))
      .join('\n');

    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    const dateForFile = new Date(attendance.startedAt)
      .toISOString()
      .slice(0, 10);
    const className = (cls?.name ?? 'session').replace(/[^a-z0-9]+/gi, '_');
    a.download = `bali_${className}_${dateForFile}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  if (loading) return <SessionDetailSkeleton />;

  if (errored || !attendance) {
    return (
      <div className="surface-card rounded-3xl px-8 py-20 text-center space-y-3 max-w-xl mx-auto">
        <h2 className="text-2xl md:text-3xl font-black tracking-tight text-gray-900">
          We couldn't load this session
        </h2>
        <p className="text-gray-500">
          That session may have been removed, or your connection dropped.
        </p>
        <div className="flex flex-col sm:flex-row gap-2 justify-center pt-2">
          <button
            onClick={load}
            className="inline-flex items-center justify-center rounded-full px-6 py-2.5 text-sm font-bold text-white transition-opacity hover:opacity-90 shadow-sm"
            style={{ backgroundColor: BRAND }}
          >
            Try again
          </button>
          <Link
            href={`/dashboard/classes/${classId}/sessions/`}
            className="inline-flex items-center justify-center rounded-full border border-gray-200 bg-white px-6 py-2.5 text-sm font-bold text-gray-700 hover:bg-gray-50 transition-colors"
          >
            Back to history
          </Link>
        </div>
      </div>
    );
  }

  const students = attendance.students;
  const present = students.filter((s) => s.status === 'present').length;
  const late = students.filter((s) => s.status === 'late').length;
  const absent = students.filter((s) => s.status === 'absent').length;
  const excused = students.filter((s) => s.status === 'excused').length;
  const counts = {
    present,
    late,
    absent,
    excused,
    total: students.length,
  };

  const snapshot: BlockingSnapshot =
    session?.blockingConfigSnapshot ?? INACTIVE_BLOCKING_SNAPSHOT;
  const blockingActive = !!session?.blockingEnabled && snapshot.blockingActive;

  const deviceByStudent = new Map(
    devices.filter((d) => d.studentId).map((d) => [d.studentId!, d])
  );
  const statusByStudent = new Map(
    deviceStatuses.map((d) => [d.studentId, d])
  );

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

  const summary = buildSummary(counts, blockingActive);

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
          <div className="flex flex-wrap items-center gap-2 flex-shrink-0">
            <button
              onClick={handleExport}
              className="inline-flex items-center gap-1.5 rounded-full border border-gray-200 bg-white px-5 py-2.5 text-sm font-bold text-gray-700 hover:bg-gray-50 transition-colors"
            >
              <IconDownload className="h-3.5 w-3.5" />
              Export CSV
            </button>
            <Link
              href={`/dashboard/classes/${classId}/sessions/`}
              className="inline-flex items-center rounded-full border border-gray-200 bg-white px-5 py-2.5 text-sm font-bold text-gray-700 hover:bg-gray-50 transition-colors"
            >
              Back to history
            </Link>
          </div>
        </div>
      </section>

      {/* ── SUMMARY LINE ──────────────────────────────────────── */}
      <p className="text-sm md:text-base text-gray-600 leading-relaxed max-w-3xl">
        {summary}
      </p>

      {/* ── ATTENDANCE STATS ──────────────────────────────────── */}
      <section className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <SummaryCard label="Present" value={present} tint="green" />
        <SummaryCard label="Late" value={late} tint="amber" />
        <SummaryCard label="Absent" value={absent} tint="red" />
        <SummaryCard label="Excused" value={excused} tint="purple" />
      </section>

      {/* ── BLOCKING POLICY USED ──────────────────────────────── */}
      <BlockingPolicyCard
        snapshot={snapshot}
        blockingActive={blockingActive}
      />

      {/* ── EMERGENCY STOPS ───────────────────────────────────── */}
      {emergencyStops.length > 0 && (
        <EmergencyStopTimeline
          startedAt={attendance.startedAt}
          endedAt={attendance.endedAt}
          stops={emergencyStops}
        />
      )}

      {/* ── STUDENTS ──────────────────────────────────────────── */}
      <section className="surface-card rounded-2xl overflow-hidden">
        <header className="px-7 pt-6 pb-4 space-y-1.5">
          <p
            className="text-[11px] font-black uppercase tracking-[0.18em]"
            style={{ color: BRAND }}
          >
            Roster
          </p>
          <h2 className="text-xl md:text-2xl font-black tracking-tight text-gray-900">
            Students
          </h2>
          <p className="text-sm text-gray-500">
            Final attendance for this session. You can still override below.
          </p>
        </header>

        {students.length === 0 ? (
          <div className="px-8 py-12 text-center text-sm text-gray-500">
            No students were enrolled in this session.
          </div>
        ) : (
          <ul className="divide-y divide-gray-100">
            {students.map((s: any) => {
              const device = deviceByStudent.get(s.studentId);
              const blockStatus = statusByStudent.get(s.studentId);
              const blocking = blockingStateFor({
                blockingActive,
                hasDevice: !!device,
                status: blockStatus,
              });
              return (
                <li
                  key={s.studentId}
                  className="px-7 py-4 hover:bg-gray-50 transition-colors"
                >
                  <div className="flex items-center gap-4 flex-wrap md:flex-nowrap">
                    <div className="flex-1 min-w-0">
                      <p className="font-bold text-gray-900 truncate">
                        {s.firstName} {s.lastName}
                      </p>
                      <p className="text-xs text-gray-500 truncate">
                        {s.checkInAt ? (
                          <>
                            Checked in{' '}
                            {new Date(s.checkInAt).toLocaleTimeString([], {
                              hour: '2-digit',
                              minute: '2-digit',
                            })}
                          </>
                        ) : (
                          'No check-in'
                        )}
                        {device ? (
                          <>
                            <span className="text-gray-300 mx-1.5">·</span>
                            <span className="text-gray-400">Device</span>{' '}
                            <span className="font-mono">
                              {device.friendlyName ?? device.deviceId}
                            </span>
                          </>
                        ) : (
                          <>
                            <span className="text-gray-300 mx-1.5">·</span>
                            No device assigned
                          </>
                        )}
                      </p>
                      {s.isOverride && (
                        <p className="mt-1 inline-flex items-center gap-1 rounded-full bg-amber-50 border border-amber-200 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-amber-700">
                          Manually overridden
                        </p>
                      )}
                    </div>
                    <span
                      className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-[11px] font-bold uppercase tracking-wider whitespace-nowrap ${
                        STATUS_BADGE[s.status] ?? STATUS_BADGE.pending
                      }`}
                    >
                      {STATUS_LABEL[s.status] ?? s.status}
                    </span>
                    <span
                      className={`hidden sm:inline-flex items-center rounded-full border px-2.5 py-0.5 text-[11px] font-bold uppercase tracking-wider whitespace-nowrap ${blocking.tint}`}
                    >
                      {blocking.label}
                    </span>
                    <select
                      value={s.status}
                      onChange={(e) =>
                        handleOverride(s.studentId, e.target.value)
                      }
                      aria-label={`Override status for ${s.firstName} ${s.lastName}`}
                      className="text-xs rounded-lg border border-gray-200 bg-white px-2.5 py-1.5 font-medium text-gray-700 focus:outline-none focus:ring-2 focus:ring-brand/30"
                    >
                      <option value="present">Present</option>
                      <option value="late">Late</option>
                      <option value="absent">Absent</option>
                      <option value="excused">Excused</option>
                    </select>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}

/* ────────────────────────────────────────────────────────────────────────── */
/*  Subcomponents                                                            */
/* ────────────────────────────────────────────────────────────────────────── */

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

function BlockingPolicyCard({
  snapshot,
  blockingActive,
}: {
  snapshot: BlockingSnapshot;
  blockingActive: boolean;
}) {
  const presetLabel = PRESET_LABELS[snapshot.preset] ?? 'No blocking';
  const noPolicy = !blockingActive && snapshot.preset === 'none';

  return (
    <section className="surface-card rounded-2xl p-7 space-y-5">
      <header className="flex flex-col md:flex-row md:items-end md:justify-between gap-3">
        <div className="space-y-1.5 min-w-0">
          <p
            className="text-[11px] font-black uppercase tracking-[0.18em]"
            style={{ color: BRAND }}
          >
            Focus
          </p>
          <h2 className="text-xl md:text-2xl font-black tracking-tight text-gray-900">
            Blocking policy used
          </h2>
          <p className="text-sm text-gray-500">
            This policy was saved when the session started. Later changes to
            the class policy do not affect this session.
          </p>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <span
            className="inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-bold whitespace-nowrap"
            style={{
              backgroundColor: blockingActive
                ? 'rgba(46, 91, 208, 0.10)'
                : '#f3f4f6',
              color: blockingActive ? BRAND : '#6b7280',
            }}
          >
            <span
              className="h-1.5 w-1.5 rounded-full"
              style={{ backgroundColor: blockingActive ? BRAND : '#9ca3af' }}
            />
            {presetLabel}
          </span>
          <span
            className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-[11px] font-bold uppercase tracking-wider whitespace-nowrap ${
              blockingActive
                ? 'bg-green-50 text-green-700 border-green-200'
                : 'bg-gray-50 text-gray-500 border-gray-200'
            }`}
          >
            {blockingActive ? 'Blocking active' : 'Blocking off'}
          </span>
        </div>
      </header>

      {noPolicy ? (
        <p className="rounded-2xl border border-dashed border-gray-200 bg-gray-50/60 px-5 py-6 text-sm text-gray-500 text-center">
          No blocking policy was configured for this session.
        </p>
      ) : (
        <div className="space-y-4">
          {snapshot.blockedApps.length > 0 && (
            <AppList
              title="Blocked apps"
              apps={snapshot.blockedApps}
              tone="red"
            />
          )}
          {snapshot.allowedApps.length > 0 && (
            <AppList
              title="Allowed apps"
              apps={snapshot.allowedApps}
              tone="green"
              caption="Only essential apps were allowed during this session."
            />
          )}
          {snapshot.blockedApps.length === 0 &&
            snapshot.allowedApps.length === 0 && (
              <p className="text-sm text-gray-500">
                Blocking was active but no apps were configured.
              </p>
            )}
        </div>
      )}
    </section>
  );
}

function AppList({
  title,
  apps,
  tone,
  caption,
}: {
  title: string;
  apps: { bundleId: string; appName: string }[];
  tone: 'red' | 'green';
  caption?: string;
}) {
  const chipCls =
    tone === 'red'
      ? 'bg-red-50 text-red-700 border-red-200'
      : 'bg-green-50 text-green-700 border-green-200';
  return (
    <div className="space-y-2">
      <p className="text-[11px] font-bold uppercase tracking-wider text-gray-500">
        {title} ({apps.length})
      </p>
      <div className="flex flex-wrap gap-1.5">
        {apps.map((a) => (
          <span
            key={a.bundleId}
            className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium ${chipCls}`}
          >
            {a.appName}
          </span>
        ))}
      </div>
      {caption && <p className="text-xs text-gray-400">{caption}</p>}
    </div>
  );
}

function SessionDetailSkeleton() {
  return (
    <div className="space-y-8 animate-pulse">
      <div className="surface-card-hero rounded-3xl h-44" />
      <div className="h-4 w-2/3 bg-gray-200 rounded-full" />
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="surface-card rounded-2xl h-24" />
        ))}
      </div>
      <div className="surface-card rounded-2xl h-44" />
      <div className="surface-card rounded-2xl h-72" />
    </div>
  );
}

/* ────────────────────────────────────────────────────────────────────────── */

function IconDownload({ className = 'h-4 w-4' }: { className?: string }) {
  return (
    <svg
      className={className}
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth={2.2}
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3"
      />
    </svg>
  );
}
