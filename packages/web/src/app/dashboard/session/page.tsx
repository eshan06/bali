'use client';

import { useState, useEffect, useCallback } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { api } from '@/lib/api-client';
import { usePolling } from '@/hooks/usePolling';
import {
  Class,
  ClassSession,
  AttendanceRecord,
  DeviceBlockingStatus,
  Device,
  POLLING_INTERVAL_MS,
  INACTIVE_BLOCKING_SNAPSHOT,
  type BlockingSnapshot,
} from '@bali/shared';

const BRAND = '#2E5BD0';

const PRESET_LABEL: Record<string, string> = {
  full_focus: 'Full Focus',
  no_social_media: 'No Social Media',
  no_games: 'No Games',
  custom: 'Custom',
  none: 'No blocking',
};

const STATUS_BADGE: Record<string, string> = {
  present: 'bg-green-100 text-green-800 border-green-200',
  late: 'bg-yellow-100 text-yellow-800 border-yellow-200',
  absent: 'bg-red-50 text-red-700 border-red-200',
  excused: 'bg-blue-50 text-blue-700 border-blue-200',
  pending: 'bg-gray-50 text-gray-500 border-gray-200',
};

export default function ActiveSessionPage() {
  const searchParams = useSearchParams();
  const preselectClassId = searchParams.get('classId');
  const [classes, setClasses] = useState<Class[]>([]);
  const [devices, setDevices] = useState<Device[]>([]);
  const [session, setSession] = useState<ClassSession | null>(null);
  const [selectedClassId, setSelectedClassId] = useState('');
  const [loading, setLoading] = useState(true);
  const [starting, setStarting] = useState(false);
  const [ending, setEnding] = useState(false);

  useEffect(() => {
    Promise.all([
      api.get<{ classes: Class[] }>('/classes'),
      api.get<{ session: ClassSession | null }>('/sessions/active'),
      api.get<{ devices: Device[] }>('/devices').catch(() => ({ devices: [] })),
    ])
      .then(([classRes, sessionRes, deviceRes]) => {
        setClasses(classRes.classes);
        setSession(sessionRes.session);
        setDevices(deviceRes.devices);
        if (preselectClassId && !sessionRes.session) {
          const match = classRes.classes.find((c) => c.id === preselectClassId);
          if (match) setSelectedClassId(match.id);
        }
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [preselectClassId]);

  const fetchAttendance = useCallback(async () => {
    if (!session) return null;
    const attendance = await api.get<{ students: AttendanceRecord[] }>(
      `/sessions/${session.id}/attendance`
    );
    let deviceStatuses: DeviceBlockingStatus[] = [];
    try {
      const res = await api.get<{ statuses: DeviceBlockingStatus[] }>(
        `/sessions/${session.id}/device-status`
      );
      deviceStatuses = res.statuses;
    } catch {
      /* table missing in older deployments */
    }
    return { students: attendance.students, deviceStatuses };
  }, [session]);

  const { data: attendanceData } = usePolling(
    fetchAttendance,
    POLLING_INTERVAL_MS,
    !!session
  );

  const students = attendanceData?.students ?? [];
  const deviceStatuses = attendanceData?.deviceStatuses ?? [];
  const deviceStatusMap = new Map(
    deviceStatuses.map((d) => [d.studentId, d])
  );
  const deviceByStudent = new Map(
    devices.filter((d) => d.studentId).map((d) => [d.studentId!, d])
  );
  const presentCount = students.filter((s) => s.status === 'present').length;
  const lateCount = students.filter((s) => s.status === 'late').length;
  const absentCount = students.filter((s) => s.status === 'absent').length;
  const checkedInCount = presentCount + lateCount;
  const waitingCount = students.length - checkedInCount - absentCount;

  const startSession = async () => {
    if (!selectedClassId) return;
    setStarting(true);
    try {
      const s = await api.post<ClassSession>('/sessions/start', {
        classId: selectedClassId,
      });
      setSession(s);
    } catch (err: any) {
      alert(err.message);
    } finally {
      setStarting(false);
    }
  };

  const endSession = async () => {
    if (!session) return;
    if (!confirm('End this session? Students without check-ins stay marked as waiting.'))
      return;
    setEnding(true);
    try {
      await api.post(`/sessions/${session.id}/end`);
      setSession(null);
    } catch (err: any) {
      alert(err.message);
    } finally {
      setEnding(false);
    }
  };

  const handleOverride = async (studentId: string, status: string) => {
    if (!session) return;
    await api.put(`/sessions/${session.id}/attendance/${studentId}`, { status });
  };

  if (loading) {
    return (
      <div className="space-y-8 animate-pulse">
        <div className="surface-card-hero rounded-3xl h-32" />
        <div className="grid grid-cols-1 md:grid-cols-4 gap-5">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="surface-card rounded-2xl h-24" />
          ))}
        </div>
        <div className="surface-card rounded-2xl h-64" />
      </div>
    );
  }

  /* ── No active session — show start form ─────────────────────────── */
  if (!session) {
    const selectedClass = classes.find((c) => c.id === selectedClassId);
    const selectedPreset = selectedClass?.blockingPreset ?? 'none';

    return (
      <div className="space-y-8">
        <section className="surface-card-hero rounded-3xl p-7 md:p-9">
          <p
            className="text-[11px] font-black uppercase tracking-[0.22em]"
            style={{ color: BRAND }}
          >
            Live Session
          </p>
          <h1 className="mt-2 text-3xl md:text-4xl font-black tracking-tight text-gray-900 leading-tight">
            Start a session
          </h1>
          <p className="mt-2 text-sm md:text-base text-gray-500 max-w-xl">
            Choose a class. Bali snapshots its blocking policy at start so it
            won't change underneath you mid-session.
          </p>
        </section>

        <div className="surface-card rounded-2xl p-7 max-w-xl space-y-5">
          <div>
            <label className="block text-xs font-bold uppercase tracking-wider text-gray-500 mb-1.5">
              Class
            </label>
            <select
              value={selectedClassId}
              onChange={(e) => setSelectedClassId(e.target.value)}
              className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2.5 text-sm font-medium text-gray-900 focus:outline-none focus:ring-2 focus:ring-brand/30"
            >
              <option value="">Choose a class…</option>
              {classes.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                  {c.period ? ` · ${c.period}` : ''}
                </option>
              ))}
            </select>
          </div>

          {selectedClassId && (
            <div className="rounded-xl border border-gray-200 bg-gray-50 px-4 py-3 text-sm flex items-center justify-between gap-3">
              <span className="flex items-center gap-2.5">
                <span
                  className="h-2 w-2 rounded-full"
                  style={{
                    backgroundColor: selectedPreset === 'none' ? '#d1d5db' : BRAND,
                  }}
                />
                <span className="text-gray-700 font-medium">
                  {PRESET_LABEL[selectedPreset]}
                </span>
              </span>
              <Link
                href={`/dashboard/classes/${selectedClassId}/`}
                className="text-xs font-bold text-brand hover:underline"
              >
                Edit policy
              </Link>
            </div>
          )}

          <button
            onClick={startSession}
            disabled={!selectedClassId || starting}
            className="w-full rounded-full px-6 py-3 text-sm font-bold text-white transition-opacity hover:opacity-90 shadow-sm disabled:opacity-50"
            style={{ backgroundColor: BRAND }}
          >
            {starting ? 'Starting…' : 'Start session'}
          </button>
        </div>
      </div>
    );
  }

  /* ── Active session view ─────────────────────────────────────────── */
  const elapsed = Math.max(
    0,
    Math.floor((Date.now() - new Date(session.startedAt).getTime()) / 60000)
  );
  const snapshot: BlockingSnapshot =
    session.blockingConfigSnapshot ?? INACTIVE_BLOCKING_SNAPSHOT;
  const blockingOn = session.blockingEnabled && snapshot.blockingActive;

  return (
    <div className="space-y-8">
      {/* ── HERO ────────────────────────────────────────────────── */}
      <section className="surface-card-hero rounded-3xl p-7 md:p-9">
        <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-6">
          <div className="space-y-2.5 min-w-0">
            <p
              className="text-[11px] font-black uppercase tracking-[0.22em]"
              style={{ color: BRAND }}
            >
              Live Session
            </p>
            <h1 className="text-3xl md:text-5xl font-black tracking-tight text-gray-900 leading-[1.05] truncate">
              {session.className}
            </h1>
            <p className="text-sm md:text-base text-gray-500">
              Started {new Date(session.startedAt).toLocaleTimeString()} ·{' '}
              {elapsed} min in
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-3 flex-shrink-0">
            {blockingOn && (
              <span
                className="inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm font-bold"
                style={{
                  backgroundColor: 'rgba(46, 91, 208, 0.10)',
                  color: BRAND,
                }}
              >
                <span
                  className="h-2 w-2 rounded-full"
                  style={{ backgroundColor: BRAND }}
                />
                Blocking active · {PRESET_LABEL[snapshot.preset]}
              </span>
            )}
            <button
              onClick={endSession}
              disabled={ending}
              className="inline-flex items-center rounded-full bg-red-600 px-5 py-2.5 text-sm font-bold text-white hover:bg-red-700 disabled:opacity-50 transition-colors"
            >
              {ending ? 'Ending…' : 'End session'}
            </button>
          </div>
        </div>
      </section>

      {/* ── STATS ───────────────────────────────────────────────── */}
      <section className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <CountCard label="Total" value={students.length} />
        <CountCard label="Present" value={presentCount} accent="green" />
        <CountCard label="Late" value={lateCount} accent="amber" />
        <CountCard label="Waiting" value={waitingCount} accent="muted" />
      </section>

      {/* ── BLOCKING SUMMARY (read-only snapshot) ──────────────── */}
      {blockingOn && (
        <section className="surface-card rounded-2xl p-6">
          <header className="flex items-start justify-between gap-3 mb-4">
            <div>
              <p className="text-[11px] font-black uppercase tracking-[0.18em] text-gray-400">
                Blocking policy · snapshot
              </p>
              <h2 className="mt-1 text-lg font-black tracking-tight text-gray-900">
                {PRESET_LABEL[snapshot.preset]}
              </h2>
            </div>
            <Link
              href={`/dashboard/classes/${session.classId}/`}
              className="text-xs font-bold text-brand hover:underline whitespace-nowrap"
            >
              Edit on class →
            </Link>
          </header>

          {snapshot.blockedApps.length > 0 && (
            <div className="mb-3">
              <p className="text-xs font-bold uppercase tracking-wider text-gray-500 mb-2">
                Blocked
              </p>
              <div className="flex flex-wrap gap-1.5">
                {snapshot.blockedApps.map((app) => (
                  <span
                    key={app.bundleId}
                    className="rounded-full bg-red-50 text-red-700 border border-red-200 px-2.5 py-0.5 text-xs font-medium"
                  >
                    {app.appName}
                  </span>
                ))}
              </div>
            </div>
          )}

          {snapshot.allowedApps.length > 0 && (
            <div>
              <p className="text-xs font-bold uppercase tracking-wider text-gray-500 mb-2">
                Allowed (full focus)
              </p>
              <div className="flex flex-wrap gap-1.5">
                {snapshot.allowedApps.map((app) => (
                  <span
                    key={app.bundleId}
                    className="rounded-full bg-green-50 text-green-700 border border-green-200 px-2.5 py-0.5 text-xs font-medium"
                  >
                    {app.appName}
                  </span>
                ))}
              </div>
            </div>
          )}

          <p className="mt-4 text-xs text-gray-400">
            Snapshot is locked for the duration of this session. Edits to the
            class policy take effect on the next session.
          </p>
        </section>
      )}

      {/* ── STUDENT CARDS ──────────────────────────────────────── */}
      <section>
        <header className="mb-4">
          <h2 className="text-2xl md:text-3xl font-black tracking-tight text-gray-900">
            Students
          </h2>
          <p className="mt-1 text-sm text-gray-500">
            Tracking attendance + per-device blocking status. Status updates as
            each device taps in.
          </p>
        </header>

        {students.length === 0 ? (
          <div className="surface-card rounded-2xl px-8 py-16 text-center">
            <p className="text-gray-500">No students enrolled in this class yet.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {students.map((s: any) => {
              const dev = deviceByStudent.get(s.studentId);
              const blockStatus = deviceStatusMap.get(s.studentId);
              return (
                <StudentCard
                  key={s.studentId}
                  name={`${s.firstName} ${s.lastName}`}
                  status={s.status}
                  checkInAt={s.checkInAt}
                  deviceLabel={dev ? dev.deviceId : null}
                  blocking={
                    blockingOn
                      ? blockStatus
                        ? blockStatus.isBlocked
                          ? 'applied'
                          : blockStatus.reportedBy === 'device'
                          ? 'failed'
                          : 'unknown'
                        : 'unknown'
                      : 'inactive'
                  }
                  onOverride={(next) => handleOverride(s.studentId, next)}
                />
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}

/* ────────────────────────────────────────────────────────────────────────── */

function CountCard({
  label,
  value,
  accent,
}: {
  label: string;
  value: number;
  accent?: 'green' | 'amber' | 'muted';
}) {
  const tint =
    accent === 'green'
      ? 'text-green-700'
      : accent === 'amber'
      ? 'text-yellow-700'
      : accent === 'muted'
      ? 'text-gray-700'
      : 'text-gray-900';
  return (
    <div className="surface-card rounded-2xl p-5">
      <p className="text-[11px] font-black uppercase tracking-[0.18em] text-gray-400">
        {label}
      </p>
      <p className={`mt-2 text-3xl md:text-4xl font-black tracking-tight leading-none ${tint}`}>
        {value}
      </p>
    </div>
  );
}

function StudentCard({
  name,
  status,
  checkInAt,
  deviceLabel,
  blocking,
  onOverride,
}: {
  name: string;
  status: 'present' | 'late' | 'absent' | 'excused' | 'pending' | string;
  checkInAt?: string | null;
  deviceLabel: string | null;
  blocking: 'applied' | 'failed' | 'unknown' | 'inactive';
  onOverride: (next: string) => void;
}) {
  const blockingLabel: Record<typeof blocking, string> = {
    applied: 'Blocking applied',
    failed: 'Blocking failed',
    unknown: 'Awaiting device',
    inactive: 'Blocking off',
  };
  const blockingTint: Record<typeof blocking, string> = {
    applied: 'bg-green-50 text-green-700 border-green-200',
    failed: 'bg-red-50 text-red-700 border-red-200',
    unknown: 'bg-gray-50 text-gray-500 border-gray-200',
    inactive: 'bg-gray-50 text-gray-500 border-gray-200',
  };

  return (
    <div className="surface-card rounded-2xl p-5 flex flex-col gap-3">
      <div className="flex items-start justify-between gap-2">
        <h3 className="text-base font-bold text-gray-900 leading-tight truncate">{name}</h3>
        <span
          className={`flex-shrink-0 rounded-full border px-2.5 py-0.5 text-[11px] font-bold uppercase tracking-wider ${
            STATUS_BADGE[status] ?? STATUS_BADGE.pending
          }`}
        >
          {status}
        </span>
      </div>

      <ul className="text-xs text-gray-500 space-y-1">
        {checkInAt ? (
          <li>
            Checked in{' '}
            {new Date(checkInAt).toLocaleTimeString([], {
              hour: '2-digit',
              minute: '2-digit',
            })}
          </li>
        ) : (
          <li className="text-gray-400">Not yet checked in</li>
        )}
        <li className="truncate">
          {deviceLabel ? (
            <>
              <span className="text-gray-400">Device · </span>
              <span className="font-mono text-gray-600">{deviceLabel}</span>
            </>
          ) : (
            <span className="text-gray-400">No device assigned</span>
          )}
        </li>
      </ul>

      <span
        className={`inline-flex w-fit items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[11px] font-medium ${blockingTint[blocking]}`}
      >
        {blockingLabel[blocking]}
      </span>

      <select
        value={status}
        onChange={(e) => onOverride(e.target.value)}
        aria-label={`Override attendance for ${name}`}
        className="mt-1 w-full text-xs rounded-lg border border-gray-200 bg-white px-2.5 py-1.5 font-medium text-gray-700 focus:outline-none focus:ring-2 focus:ring-brand/30"
      >
        <option value="present">Present</option>
        <option value="late">Late</option>
        <option value="absent">Absent</option>
        <option value="excused">Excused</option>
      </select>
    </div>
  );
}
