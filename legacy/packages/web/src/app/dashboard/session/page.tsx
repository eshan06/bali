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
  present: 'bg-green-50 text-green-700 border-green-200',
  late: 'bg-amber-50 text-amber-700 border-amber-200',
  absent: 'bg-red-50 text-red-700 border-red-200',
  excused: 'bg-purple-50 text-purple-700 border-purple-200',
  pending: 'bg-gray-50 text-gray-500 border-gray-200',
};

function periodLabel(period?: string | null): string | null {
  if (!period) return null;
  const trimmed = period.trim();
  if (!trimmed) return null;
  return /^period\b/i.test(trimmed) ? trimmed : `Period ${trimmed}`;
}

export default function ActiveSessionPage() {
  const searchParams = useSearchParams();
  const preselectClassId = searchParams.get('classId');
  const [classes, setClasses] = useState<Class[]>([]);
  const [devices, setDevices] = useState<Device[]>([]);
  const [session, setSession] = useState<ClassSession | null>(null);
  const [selectedClassId, setSelectedClassId] = useState('');
  const [loading, setLoading] = useState(true);
  const [errored, setErrored] = useState(false);
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState('');
  const [ending, setEnding] = useState(false);

  const loadInitial = useCallback(() => {
    setLoading(true);
    setErrored(false);
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
      .catch(() => setErrored(true))
      .finally(() => setLoading(false));
  }, [preselectClassId]);

  useEffect(() => {
    loadInitial();
  }, [loadInitial]);

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
    setStartError('');
    try {
      const s = await api.post<ClassSession>('/sessions/start', {
        classId: selectedClassId,
      });
      setSession(s);
    } catch {
      setStartError("We couldn't start this session. Please try again.");
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
    return <StartSessionSkeleton />;
  }

  /* ── No active session — show start form ─────────────────────────── */
  if (!session) {
    if (errored) {
      return (
        <div className="space-y-6">
          <StartSessionHeader />
          <div className="surface-card rounded-3xl px-8 py-16 max-w-xl mx-auto text-center space-y-4">
            <div className="mx-auto h-14 w-14 rounded-full bg-red-50 flex items-center justify-center text-red-600">
              <svg
                className="h-6 w-6"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={1.8}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z"
                />
              </svg>
            </div>
            <div className="space-y-1.5">
              <h2 className="text-xl md:text-2xl font-black tracking-tight text-gray-900">
                We couldn't load your classes
              </h2>
              <p className="text-sm text-gray-500">
                Check your connection and try again.
              </p>
            </div>
            <button
              onClick={loadInitial}
              className="inline-flex items-center rounded-full px-6 py-2.5 text-sm font-bold text-white transition-opacity hover:opacity-90 shadow-sm"
              style={{ backgroundColor: BRAND }}
            >
              Try again
            </button>
          </div>
        </div>
      );
    }

    const selectedClass = classes.find((c) => c.id === selectedClassId);
    const selectedPreset = selectedClass?.blockingPreset ?? 'none';
    const wasPreselected =
      !!preselectClassId && preselectClassId === selectedClassId;

    return (
      <div className="space-y-6">
        <StartSessionHeader />

        <div className="grid grid-cols-1 lg:grid-cols-5 gap-6 items-start">
          {/* ── Left: choose class + action ────────────────────── */}
          <div className="lg:col-span-2 space-y-6">
            <section className="surface-card rounded-2xl p-6 md:p-7 space-y-5">
              <header className="space-y-1.5">
                <p
                  className="text-[11px] font-black uppercase tracking-[0.18em]"
                  style={{ color: BRAND }}
                >
                  Step 1
                </p>
                <h2 className="text-xl md:text-2xl font-black tracking-tight text-gray-900">
                  Choose class
                </h2>
                <p className="text-sm text-gray-500">
                  Pick the class you want to run right now.
                </p>
              </header>

              {classes.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-gray-200 bg-gray-50/60 px-5 py-8 text-center space-y-3">
                  <p className="text-sm font-bold text-gray-900">
                    No classes yet
                  </p>
                  <p className="text-xs text-gray-500 max-w-sm mx-auto">
                    Create a class first, then come back to start a session.
                  </p>
                  <Link
                    href="/dashboard/classes/new/"
                    className="inline-flex items-center rounded-full px-5 py-2 text-sm font-bold text-white transition-opacity hover:opacity-90 shadow-sm"
                    style={{ backgroundColor: BRAND }}
                  >
                    Create class
                  </Link>
                </div>
              ) : (
                <>
                  <ClassSelect
                    value={selectedClassId}
                    classes={classes}
                    onChange={setSelectedClassId}
                  />
                  {wasPreselected && selectedClass && (
                    <div className="flex items-start gap-2 rounded-xl bg-brand/[0.06] border border-brand/20 px-3 py-2 text-xs text-gray-700">
                      <span
                        className="mt-0.5 inline-flex h-4 w-4 flex-shrink-0 items-center justify-center rounded-full text-white"
                        style={{ backgroundColor: BRAND }}
                      >
                        <svg
                          className="h-2.5 w-2.5"
                          fill="none"
                          viewBox="0 0 24 24"
                          stroke="currentColor"
                          strokeWidth={3.5}
                        >
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            d="M4.5 12.75l6 6 9-13.5"
                          />
                        </svg>
                      </span>
                      <span>
                        <span className="font-bold">
                          Preselected from your dashboard.
                        </span>{' '}
                        Pick a different class if you'd like.
                      </span>
                    </div>
                  )}
                </>
              )}
            </section>

            <section className="surface-card rounded-2xl p-6 md:p-7 space-y-4">
              <header className="space-y-1.5">
                <p
                  className="text-[11px] font-black uppercase tracking-[0.18em]"
                  style={{ color: BRAND }}
                >
                  Step 2
                </p>
                <p className="text-sm md:text-base font-bold text-gray-900">
                  {selectedClass
                    ? `Ready to start ${selectedClass.name}?`
                    : 'Select a class to continue.'}
                </p>
                <p className="text-xs text-gray-500">
                  You can end the session at any time from the live session
                  page.
                </p>
              </header>

              <div className="space-y-2">
                <button
                  onClick={startSession}
                  disabled={!selectedClassId || starting}
                  className="w-full inline-flex items-center justify-center gap-2 rounded-full px-6 py-3 text-sm font-bold text-white transition-opacity hover:opacity-90 shadow-sm disabled:opacity-50 disabled:cursor-not-allowed"
                  style={{ backgroundColor: BRAND }}
                >
                  {starting ? (
                    'Starting session…'
                  ) : (
                    <>
                      <IconPlay className="h-3.5 w-3.5" />
                      Start session
                    </>
                  )}
                </button>
                <Link
                  href="/dashboard/"
                  className="w-full inline-flex items-center justify-center rounded-full border border-gray-200 bg-white px-5 py-3 text-sm font-bold text-gray-700 hover:bg-gray-50 transition-colors"
                >
                  Back to dashboard
                </Link>
              </div>

              {startError && (
                <p className="rounded-xl bg-red-50 border border-red-100 px-4 py-2.5 text-sm text-red-700">
                  {startError}
                </p>
              )}
            </section>
          </div>

          {/* ── Right: preview ─────────────────────────────────── */}
          <section className="lg:col-span-3 surface-card rounded-2xl p-6 md:p-7">
            {selectedClass ? (
              <ClassPreview
                cls={selectedClass}
                preset={selectedPreset}
              />
            ) : (
              <PreviewPlaceholder />
            )}
          </section>
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
  const sessionClass = classes.find((c) => c.id === session.classId);
  const sessionPeriod = periodLabel(sessionClass?.period);
  const startedAtLabel = new Date(session.startedAt).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
  });
  const elapsedLabel = elapsed >= 1 ? `${elapsed} min in` : 'Just started';
  const heroMeta = [sessionPeriod, `Started ${startedAtLabel}`, elapsedLabel]
    .filter(Boolean)
    .join(' · ');

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
            <p className="text-sm md:text-base text-gray-500">{heroMeta}</p>
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
              className="inline-flex items-center rounded-full border border-red-200 bg-white px-5 py-2.5 text-sm font-bold text-red-600 hover:bg-red-600 hover:text-white hover:border-red-600 disabled:opacity-50 transition-colors"
            >
              {ending ? 'Ending…' : 'End session'}
            </button>
          </div>
        </div>
      </section>

      {/* ── STATS ───────────────────────────────────────────────── */}
      <section className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <CountCard label="Present" value={presentCount} accent="green" />
        <CountCard label="Late" value={lateCount} accent="amber" />
        <CountCard label="Absent" value={absentCount} accent="red" />
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
          <div className="surface-card rounded-2xl px-8 py-16 text-center space-y-2">
            <p className="text-base font-bold text-gray-900">No students yet</p>
            <p className="text-sm text-gray-500 max-w-sm mx-auto">
              Add students to this class so attendance can populate as each
              device taps in.
            </p>
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
                          : blockStatus.reportedBy === 'student_override'
                          ? 'student_override'
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
  accent?: 'green' | 'amber' | 'red' | 'muted';
}) {
  const tint =
    accent === 'green'
      ? 'text-green-700'
      : accent === 'amber'
      ? 'text-amber-700'
      : accent === 'red'
      ? 'text-red-700'
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
  blocking: 'applied' | 'failed' | 'unknown' | 'inactive' | 'student_override';
  onOverride: (next: string) => void;
}) {
  const blockingLabel: Record<typeof blocking, string> = {
    applied: 'Blocking applied',
    failed: 'Blocking failed',
    unknown: 'Awaiting device',
    inactive: 'Blocking off',
    student_override: 'Emergency Stop',
  };
  const blockingTint: Record<typeof blocking, string> = {
    applied: 'bg-green-50 text-green-700 border-green-200',
    failed: 'bg-red-50 text-red-700 border-red-200',
    unknown: 'bg-gray-50 text-gray-500 border-gray-200',
    inactive: 'bg-gray-50 text-gray-500 border-gray-200',
    student_override: 'bg-amber-50 text-amber-700 border-amber-200',
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

/* ────────────────────────────────────────────────────────────────────────── */
/*  Start a Session — header / picker / preview / placeholder                */
/* ────────────────────────────────────────────────────────────────────────── */

const BLOCKING_DESCRIPTIONS: Record<string, string> = {
  full_focus:
    'Only essential apps stay available — Phone, Messages, Camera, and Notes.',
  no_social_media:
    'Instagram, TikTok, Snapchat, Facebook, Twitter/X, and YouTube will be blocked.',
  no_games:
    'Popular game apps will be blocked during this session.',
  custom: 'A custom set of apps will be blocked during this session.',
  none: 'No apps will be blocked during this session.',
};

function StartSessionHeader() {
  return (
    <section className="surface-card-hero rounded-3xl px-7 py-6 md:px-9 md:py-7">
      <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-4">
        <div className="space-y-1.5 min-w-0">
          <p
            className="inline-flex items-center gap-1.5 text-[11px] font-black uppercase tracking-[0.22em]"
            style={{ color: BRAND }}
          >
            <span
              className="inline-flex h-4 w-4 items-center justify-center rounded-full text-white"
              style={{ backgroundColor: BRAND }}
            >
              <IconPlay className="h-2 w-2" />
            </span>
            Live Session
          </p>
          <h1 className="text-3xl md:text-4xl font-black tracking-tight text-gray-900 leading-[1.05]">
            Start a session
          </h1>
          <p className="text-sm md:text-base text-gray-500 max-w-2xl">
            Choose a class and launch attendance tracking with its saved
            blocking policy.
          </p>
        </div>
      </div>
    </section>
  );
}

function StartSessionSkeleton() {
  return (
    <div className="space-y-6 animate-pulse">
      <div className="surface-card-hero rounded-3xl h-28" />
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
        <div className="lg:col-span-2 surface-card rounded-2xl h-56" />
        <div className="lg:col-span-3 surface-card rounded-2xl h-72" />
      </div>
      <div className="surface-card rounded-2xl h-24" />
    </div>
  );
}

function ClassSelect({
  value,
  classes,
  onChange,
}: {
  value: string;
  classes: Class[];
  onChange: (id: string) => void;
}) {
  return (
    <div className="relative">
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-label="Choose a class"
        className="appearance-none w-full rounded-2xl border border-gray-200 bg-white px-4 py-3.5 pr-10 text-sm font-bold text-gray-900 focus:outline-none focus:ring-2 focus:ring-brand/30 focus:border-brand/40 transition-colors hover:border-gray-300"
      >
        <option value="">Choose a class…</option>
        {classes.map((c) => (
          <option key={c.id} value={c.id}>
            {c.name}
            {c.period ? ` · ${c.period}` : ''}
          </option>
        ))}
      </select>
      <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-gray-400">
        <svg
          className="h-4 w-4"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2.4}
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M19 9l-7 7-7-7"
          />
        </svg>
      </span>
    </div>
  );
}

function ClassPreview({ cls, preset }: { cls: Class; preset: string }) {
  const studentCount = cls.studentCount ?? 0;
  const blockingOn = preset !== 'none';
  const presetLabel = PRESET_LABEL[preset] ?? 'No blocking';
  const blockingDescription =
    BLOCKING_DESCRIPTIONS[preset] ?? BLOCKING_DESCRIPTIONS.none;
  const period = periodLabel(cls.period);
  const noStudents = studentCount === 0;

  return (
    <div className="space-y-5">
      <header className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p
            className="text-[11px] font-black uppercase tracking-[0.18em]"
            style={{ color: BRAND }}
          >
            {period ?? 'Class preview'}
          </p>
          <h2 className="mt-1 text-2xl md:text-3xl font-black tracking-tight text-gray-900 truncate">
            {cls.name}
          </h2>
        </div>
        <span
          className="inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-bold whitespace-nowrap"
          style={{
            backgroundColor: 'rgba(46, 91, 208, 0.10)',
            color: BRAND,
          }}
        >
          <IconCheck className="h-3 w-3" />
          Ready to start
        </span>
      </header>

      <dl className="grid grid-cols-2 gap-3">
        <PreviewStat
          label="Students"
          value={studentCount}
          icon={<IconStudents className="h-4 w-4" />}
        />
        <PreviewStat
          label="Blocking"
          value={presetLabel}
          icon={
            <span
              className="h-2 w-2 rounded-full"
              style={{ backgroundColor: blockingOn ? BRAND : '#d1d5db' }}
            />
          }
        />
      </dl>

      <div className="rounded-2xl border border-gray-100 bg-gray-50/60 p-4 space-y-2">
        <p className="text-[11px] font-bold uppercase tracking-wider text-gray-500">
          Focus policy
        </p>
        <p className="text-sm text-gray-700 leading-relaxed">
          {blockingDescription}
        </p>
      </div>

      <div
        className="flex items-start gap-2 rounded-xl px-4 py-3 text-xs leading-relaxed"
        style={{
          backgroundColor: 'rgba(46, 91, 208, 0.05)',
          color: '#3a4d7a',
          border: '1px solid rgba(46, 91, 208, 0.15)',
        }}
      >
        <span
          className="mt-0.5 inline-flex h-4 w-4 flex-shrink-0 items-center justify-center rounded-full text-white"
          style={{ backgroundColor: BRAND }}
        >
          <span className="text-[9px] font-black">i</span>
        </span>
        <span>
          This session will use the class's saved focus policy. Changes to
          the class policy will apply to future sessions, not this one.
        </span>
      </div>

      {noStudents && (
        <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-xl px-4 py-2.5">
          This class has no students yet. You can still start a session, but
          attendance will be empty.
        </p>
      )}

      <Link
        href={`/dashboard/classes/${cls.id}/`}
        className="inline-flex items-center text-xs font-bold text-brand hover:underline"
      >
        Edit on class →
      </Link>
    </div>
  );
}

function PreviewPlaceholder() {
  return (
    <div className="h-full flex flex-col items-center justify-center text-center px-6 py-10 space-y-4 min-h-[280px]">
      <div
        className="h-14 w-14 rounded-2xl flex items-center justify-center"
        style={{ backgroundColor: 'rgba(46, 91, 208, 0.10)', color: BRAND }}
      >
        <IconPlay className="h-5 w-5" />
      </div>
      <div className="space-y-1.5 max-w-sm">
        <p className="text-base font-black tracking-tight text-gray-900">
          Pick a class to preview
        </p>
        <p className="text-sm text-gray-500 leading-relaxed">
          Select a class on the left and we'll show its blocking policy and
          student roster before you start the session.
        </p>
      </div>
    </div>
  );
}

function PreviewStat({
  label,
  value,
  icon,
}: {
  label: string;
  value: string | number;
  icon: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border border-gray-100 bg-white px-4 py-3">
      <dt className="text-[11px] font-bold uppercase tracking-wider text-gray-400">
        {label}
      </dt>
      <dd className="mt-1 flex items-center gap-2 text-base font-black tracking-tight text-gray-900">
        <span className="text-gray-400 flex-shrink-0">{icon}</span>
        <span className="truncate">{value}</span>
      </dd>
    </div>
  );
}

/* ────────────────────────────────────────────────────────────────────────── */
/*  Tiny atoms                                                               */
/* ────────────────────────────────────────────────────────────────────────── */

function IconPlay({ className = 'h-4 w-4' }: { className?: string }) {
  return (
    <svg className={className} fill="currentColor" viewBox="0 0 24 24">
      <path d="M8 5v14l11-7z" />
    </svg>
  );
}

function IconCheck({ className = 'h-4 w-4' }: { className?: string }) {
  return (
    <svg
      className={className}
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth={3}
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M4.5 12.75l6 6 9-13.5"
      />
    </svg>
  );
}

function IconStudents({ className = 'h-4 w-4' }: { className?: string }) {
  return (
    <svg
      className={className}
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth={1.7}
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M15 19.128a9.38 9.38 0 002.625.372 9.337 9.337 0 004.121-.952 4.125 4.125 0 00-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 018.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0111.964-3.07M12 6.375a3.375 3.375 0 11-6.75 0 3.375 3.375 0 016.75 0zm8.25 2.25a2.625 2.625 0 11-5.25 0 2.625 2.625 0 015.25 0z"
      />
    </svg>
  );
}
