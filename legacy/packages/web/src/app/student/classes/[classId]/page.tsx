'use client';

import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { api } from '@/lib/api-client';
import type {
  StudentClassDetail,
  StudentActiveSessionInfo,
  StudentSessionHistoryEntry,
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
};

const STATUS_LABEL: Record<string, string> = {
  present: 'Present',
  late: 'Late',
  absent: 'Absent',
  excused: 'Excused',
};

type CardState = 'idle' | 'in_session' | 'checked_in' | 'checked_in_late';

function classState(active: StudentActiveSessionInfo | null): CardState {
  if (!active) return 'idle';
  if (!active.checkedIn) return 'in_session';
  if (active.attendanceStatus === 'late') return 'checked_in_late';
  return 'checked_in';
}

function periodLabel(period?: string | null): string | null {
  if (!period) return null;
  const trimmed = period.trim();
  if (!trimmed) return null;
  return /^period\b/i.test(trimmed) ? trimmed : `Period ${trimmed}`;
}

function formatTime(iso: string | null | undefined): string {
  if (!iso) return '';
  return new Date(iso).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  });
}

export default function StudentClassDetailPage() {
  const { classId } = useParams<{ classId: string }>();
  const [data, setData] = useState<StudentClassDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [errored, setErrored] = useState(false);
  const [simulating, setSimulating] = useState(false);
  const [simulateError, setSimulateError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setErrored(false);
    try {
      const res = await api.get<StudentClassDetail>(
        `/students/me/classes/${classId}`
      );
      setData(res);
    } catch {
      setErrored(true);
    } finally {
      setLoading(false);
    }
  }, [classId]);

  useEffect(() => {
    load();
  }, [load]);

  const handleSimulateCheckIn = async () => {
    setSimulating(true);
    setSimulateError('');
    try {
      await api.post(`/students/me/classes/${classId}/simulate-check-in`);
      await load();
    } catch (err: any) {
      setSimulateError(
        err.message || "We couldn't check you in. Try again in a moment."
      );
    } finally {
      setSimulating(false);
    }
  };

  if (loading) return <DetailSkeleton />;

  if (errored || !data) {
    return (
      <div className="surface-card rounded-3xl px-8 py-16 max-w-xl mx-auto text-center space-y-4">
        <h2 className="text-2xl md:text-3xl font-black tracking-tight text-gray-900">
          We couldn't load this class
        </h2>
        <p className="text-gray-500">Check your connection and try again.</p>
        <div className="flex flex-col sm:flex-row gap-2 justify-center pt-2">
          <button
            onClick={load}
            className="inline-flex items-center justify-center rounded-full px-6 py-2.5 text-sm font-bold text-white transition-opacity hover:opacity-90 shadow-sm"
            style={{ backgroundColor: BRAND }}
          >
            Try again
          </button>
          <Link
            href="/student/"
            className="inline-flex items-center justify-center rounded-full border border-gray-200 bg-white px-6 py-2.5 text-sm font-bold text-gray-700 hover:bg-gray-50 transition-colors"
          >
            Back to classes
          </Link>
        </div>
      </div>
    );
  }

  const { class: cls, attendance, activeSession, recentSessions, device } = data;
  const period = periodLabel(cls.period);
  const state = classState(activeSession);

  return (
    <div className="space-y-8">
      {/* ── BACK LINK ─────────────────────────────────────────── */}
      <Link
        href="/student/"
        className="inline-flex items-center gap-1 text-xs font-bold text-gray-500 hover:text-gray-900 transition-colors"
      >
        <span>←</span>
        Back to classes
      </Link>

      {/* ── HEADER ────────────────────────────────────────────── */}
      <header className="space-y-3">
        <p
          className="text-[11px] font-black uppercase tracking-[0.22em]"
          style={{ color: BRAND }}
        >
          {period ?? 'Class'}
        </p>
        <h1 className="text-3xl md:text-4xl font-black tracking-tight text-gray-900 leading-[1.05]">
          {cls.name}
        </h1>
        <p className="text-sm text-gray-500">
          {[cls.teacherName, cls.schoolName].filter(Boolean).join(' · ')}
        </p>
        <div className="pt-1">
          <StatusPill state={state} />
        </div>
      </header>

      {/* ── ATTENDANCE SUMMARY ───────────────────────────────── */}
      <section className="space-y-3">
        <h2 className="text-xl font-black tracking-tight text-gray-900">
          Your attendance
        </h2>
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
          <Stat label="Attendance" value={`${attendance.rate}%`} />
          <Stat label="Sessions" value={attendance.total} />
          <Stat label="Present" value={attendance.present} tint="green" />
          <Stat label="Late" value={attendance.late} tint="amber" />
          <Stat label="Absent" value={attendance.absent} tint="red" />
        </div>
      </section>

      {/* ── CURRENT SESSION ──────────────────────────────────── */}
      <section className="space-y-3">
        <h2 className="text-xl font-black tracking-tight text-gray-900">
          Current session
        </h2>
        <CurrentSession
          state={state}
          session={activeSession}
          simulating={simulating}
          simulateError={simulateError}
          onSimulateCheckIn={handleSimulateCheckIn}
        />
      </section>

      {/* ── FOCUS MODE ───────────────────────────────────────── */}
      {activeSession && activeSession.blockingSnapshot.blockingActive && (
        <section className="space-y-3">
          <h2 className="text-xl font-black tracking-tight text-gray-900">
            Focus mode
          </h2>
          <FocusModeCard session={activeSession} />
        </section>
      )}

      {/* ── DEVICE ───────────────────────────────────────────── */}
      {device && (
        <section className="space-y-3">
          <h2 className="text-xl font-black tracking-tight text-gray-900">
            Your Bali block
          </h2>
          <div className="surface-card rounded-2xl p-5 flex items-center gap-4">
            <div
              className="h-11 w-11 rounded-2xl flex items-center justify-center flex-shrink-0"
              style={{
                backgroundColor: 'rgba(46, 91, 208, 0.10)',
                color: BRAND,
              }}
            >
              <IconChip className="h-5 w-5" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="font-bold text-gray-900 truncate">
                {device.friendlyName ?? device.deviceId}
              </p>
              {device.friendlyName && (
                <p className="text-xs text-gray-500 font-mono truncate">
                  {device.deviceId}
                </p>
              )}
            </div>
          </div>
        </section>
      )}

      {/* ── RECENT SESSIONS ──────────────────────────────────── */}
      <section className="space-y-3">
        <h2 className="text-xl font-black tracking-tight text-gray-900">
          Recent sessions
        </h2>
        <RecentSessions sessions={recentSessions} />
      </section>
    </div>
  );
}

/* ────────────────────────────────────────────────────────────────────────── */
/*  Current session state                                                    */
/* ────────────────────────────────────────────────────────────────────────── */

function CurrentSession({
  state,
  session,
  simulating,
  simulateError,
  onSimulateCheckIn,
}: {
  state: CardState;
  session: StudentActiveSessionInfo | null;
  simulating: boolean;
  simulateError: string;
  onSimulateCheckIn: () => void;
}) {
  if (state === 'idle' || !session) {
    return (
      <div className="surface-card rounded-2xl p-6 sm:p-7 text-center space-y-2">
        <p className="text-base font-black tracking-tight text-gray-900">
          No active session
        </p>
        <p className="text-sm text-gray-500 max-w-md mx-auto">
          When your teacher starts class, you'll see check-in and focus mode
          details here.
        </p>
      </div>
    );
  }

  if (state === 'in_session') {
    const preset = PRESET_LABELS[session.blockingSnapshot.preset] ?? 'No blocking';
    return (
      <div className="surface-card rounded-2xl p-6 sm:p-7 space-y-5">
        <div className="flex items-start gap-3">
          <span className="mt-1">
            <PulseDot color="#b45309" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-lg md:text-xl font-black tracking-tight text-gray-900">
              Class in session
            </p>
            <p className="text-sm text-gray-700 mt-0.5">
              Tap your Bali block to check in.
            </p>
            <p className="text-xs text-gray-500 mt-1">
              Started {formatTime(session.startedAt)}
            </p>
          </div>
        </div>

        {session.blockingSnapshot.blockingActive && (
          <div
            className="rounded-2xl border px-4 py-3 flex items-center gap-2.5"
            style={{
              backgroundColor: 'rgba(46, 91, 208, 0.05)',
              borderColor: 'rgba(46, 91, 208, 0.20)',
            }}
          >
            <span
              className="inline-flex h-7 w-7 rounded-full items-center justify-center flex-shrink-0"
              style={{ backgroundColor: 'rgba(46, 91, 208, 0.10)', color: BRAND }}
            >
              <IconLock className="h-3.5 w-3.5" />
            </span>
            <p className="text-sm">
              <span className="font-bold" style={{ color: BRAND }}>
                {preset}
              </span>{' '}
              <span className="text-gray-600">
                will activate once you check in.
              </span>
            </p>
          </div>
        )}

        <div className="rounded-2xl bg-gray-50 border border-gray-100 p-4 space-y-3">
          <div className="flex items-start gap-2">
            <span className="text-[11px] font-bold uppercase tracking-wider text-gray-500 mt-0.5">
              Web prototype
            </span>
          </div>
          <p className="text-xs text-gray-500 leading-relaxed">
            On iOS, you'll tap your Bali block. For now, this button mimics
            the same flow.
          </p>
          <button
            onClick={onSimulateCheckIn}
            disabled={simulating}
            className="w-full inline-flex items-center justify-center gap-2 rounded-full px-6 py-3 text-sm font-bold text-white transition-opacity hover:opacity-90 shadow-sm disabled:opacity-50"
            style={{ backgroundColor: BRAND }}
          >
            {simulating ? 'Checking in…' : 'Simulate check in'}
          </button>
          {simulateError && (
            <p className="text-sm text-red-600">{simulateError}</p>
          )}
        </div>
      </div>
    );
  }

  // checked_in or checked_in_late
  const late = state === 'checked_in_late';
  return (
    <div className="surface-card rounded-2xl p-6 sm:p-7 space-y-4">
      <div className="flex items-start gap-3">
        <span
          className="mt-1.5 inline-flex h-2.5 w-2.5 rounded-full flex-shrink-0"
          style={{ backgroundColor: late ? '#b45309' : '#15803d' }}
        />
        <div className="min-w-0 flex-1">
          <p className="text-lg md:text-xl font-black tracking-tight text-gray-900">
            {late ? "You're checked in (late)." : "You're checked in."}
          </p>
          <p className="text-sm text-gray-500 mt-0.5">
            {session.checkInAt
              ? `Checked in at ${formatTime(session.checkInAt)}`
              : 'Attendance recorded.'}
            {' · '}Started {formatTime(session.startedAt)}
          </p>
        </div>
        <span
          className={`hidden sm:inline-flex items-center rounded-full border px-2.5 py-0.5 text-[11px] font-bold uppercase tracking-wider whitespace-nowrap ${
            STATUS_BADGE[late ? 'late' : 'present']
          }`}
        >
          {late ? 'Late' : 'Present'}
        </span>
      </div>

      {session.blockingSnapshot.blockingActive && (
        <BlockingStatusInline session={session} />
      )}
    </div>
  );
}

function BlockingStatusInline({ session }: { session: StudentActiveSessionInfo }) {
  const reported = session.deviceBlockingStatus;
  let label = 'Blocking pending';
  let tint = 'bg-gray-50 text-gray-500 border-gray-200';
  if (reported) {
    if (reported.isBlocked) {
      label = 'Blocking applied';
      tint = 'bg-green-50 text-green-700 border-green-200';
    } else if (reported.reportedBy === 'student_override') {
      label = 'Student override';
      tint = 'bg-amber-50 text-amber-700 border-amber-200';
    } else {
      label = 'Blocking failed';
      tint = 'bg-red-50 text-red-700 border-red-200';
    }
  }
  return (
    <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-gray-100">
      <span
        className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[11px] font-bold uppercase tracking-wider"
        style={{
          backgroundColor: 'rgba(46, 91, 208, 0.10)',
          color: BRAND,
        }}
      >
        <IconLock className="h-3 w-3" />
        Focus mode active
      </span>
      <span
        className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-[11px] font-bold uppercase tracking-wider ${tint}`}
      >
        {label}
      </span>
    </div>
  );
}

/* ────────────────────────────────────────────────────────────────────────── */
/*  Focus mode card                                                          */
/* ────────────────────────────────────────────────────────────────────────── */

function FocusModeCard({ session }: { session: StudentActiveSessionInfo }) {
  const snapshot = session.blockingSnapshot;
  const presetLabel = PRESET_LABELS[snapshot.preset] ?? 'No blocking';

  return (
    <div className="surface-card rounded-2xl p-6 space-y-4">
      <header className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p
            className="text-[11px] font-black uppercase tracking-[0.18em]"
            style={{ color: BRAND }}
          >
            Focus mode
          </p>
          <h3 className="mt-1 text-lg md:text-xl font-black tracking-tight text-gray-900">
            {presetLabel}
          </h3>
        </div>
        <span
          className="inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-bold whitespace-nowrap"
          style={{
            backgroundColor: 'rgba(46, 91, 208, 0.10)',
            color: BRAND,
          }}
        >
          <IconLock className="h-3 w-3" />
          Active
        </span>
      </header>

      {snapshot.blockedApps.length > 0 && (
        <AppList title="Blocked apps" apps={snapshot.blockedApps} tone="red" />
      )}
      {snapshot.allowedApps.length > 0 && (
        <AppList
          title="Allowed apps"
          apps={snapshot.allowedApps}
          tone="green"
          caption="Only these stay open during the session."
        />
      )}
      {snapshot.blockedApps.length === 0 && snapshot.allowedApps.length === 0 && (
        <p className="text-sm text-gray-500">
          Focus mode is active for this session.
        </p>
      )}
    </div>
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

/* ────────────────────────────────────────────────────────────────────────── */
/*  Recent sessions                                                          */
/* ────────────────────────────────────────────────────────────────────────── */

function RecentSessions({
  sessions,
}: {
  sessions: StudentSessionHistoryEntry[];
}) {
  if (sessions.length === 0) {
    return (
      <div className="surface-card rounded-2xl px-6 py-8 text-center space-y-1">
        <p className="text-sm font-bold text-gray-900">No sessions yet</p>
        <p className="text-xs text-gray-500">
          Past attendance shows up here once your teacher ends a class
          session.
        </p>
      </div>
    );
  }
  return (
    <ul className="surface-card rounded-2xl divide-y divide-gray-100 overflow-hidden">
      {sessions.map((s) => (
        <li key={s.sessionId} className="px-5 py-3">
          <div className="flex items-center gap-3">
            <div className="flex-1 min-w-0">
              <p className="text-sm font-bold text-gray-900">
                {formatDate(s.startedAt)}
              </p>
              <p className="text-xs text-gray-500">
                {s.checkInAt
                  ? `Checked in ${formatTime(s.checkInAt)}`
                  : 'No check-in'}
                {s.isOverride && (
                  <span className="ml-2 text-amber-700">
                    · manually changed
                  </span>
                )}
              </p>
            </div>
            <span
              className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-[11px] font-bold uppercase tracking-wider whitespace-nowrap ${
                STATUS_BADGE[s.status] ?? 'bg-gray-50 text-gray-500 border-gray-200'
              }`}
            >
              {STATUS_LABEL[s.status] ?? s.status}
            </span>
            <BlockingHistoryPill state={s.blockingStatus} />
          </div>
        </li>
      ))}
    </ul>
  );
}

function BlockingHistoryPill({ state }: { state: string }) {
  if (state === 'active') {
    return (
      <span className="hidden sm:inline-flex items-center rounded-full border border-green-200 bg-green-50 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-green-700">
        Focus on
      </span>
    );
  }
  if (state === 'student_override') {
    return (
      <span className="hidden sm:inline-flex items-center rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-amber-700">
        Override
      </span>
    );
  }
  if (state === 'inactive') {
    return (
      <span className="hidden sm:inline-flex items-center rounded-full border border-gray-200 bg-gray-50 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-gray-500">
        Off
      </span>
    );
  }
  return null;
}

/* ────────────────────────────────────────────────────────────────────────── */
/*  Pieces                                                                   */
/* ────────────────────────────────────────────────────────────────────────── */

function StatusPill({ state }: { state: CardState }) {
  if (state === 'in_session') {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-50 border border-amber-200 px-3 py-1 text-xs font-bold uppercase tracking-wider text-amber-700 whitespace-nowrap">
        <PulseDot color="#b45309" />
        Class in session
      </span>
    );
  }
  if (state === 'checked_in') {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-green-50 border border-green-200 px-3 py-1 text-xs font-bold uppercase tracking-wider text-green-700 whitespace-nowrap">
        <span className="h-1.5 w-1.5 rounded-full bg-green-600" />
        Checked in
      </span>
    );
  }
  if (state === 'checked_in_late') {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-50 border border-amber-200 px-3 py-1 text-xs font-bold uppercase tracking-wider text-amber-700 whitespace-nowrap">
        <span className="h-1.5 w-1.5 rounded-full bg-amber-600" />
        Checked in late
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-gray-50 border border-gray-200 px-3 py-1 text-xs font-bold uppercase tracking-wider text-gray-500 whitespace-nowrap">
      <span className="h-1.5 w-1.5 rounded-full bg-gray-400" />
      No active session
    </span>
  );
}

function Stat({
  label,
  value,
  tint,
}: {
  label: string;
  value: string | number;
  tint?: 'green' | 'amber' | 'red';
}) {
  const cls =
    tint === 'green'
      ? 'text-green-700'
      : tint === 'amber'
      ? 'text-amber-700'
      : tint === 'red'
      ? 'text-red-700'
      : 'text-gray-900';
  return (
    <div className="surface-card rounded-2xl px-4 py-3">
      <p className="text-[11px] font-bold uppercase tracking-wider text-gray-400">
        {label}
      </p>
      <p
        className={`mt-1 text-xl md:text-2xl font-black tracking-tight leading-none ${cls}`}
      >
        {value}
      </p>
    </div>
  );
}

function DetailSkeleton() {
  return (
    <div className="space-y-8 animate-pulse">
      <div className="h-3 w-24 bg-gray-200 rounded-full" />
      <div className="space-y-3">
        <div className="h-3 w-20 bg-gray-200 rounded-full" />
        <div className="h-9 w-2/3 bg-gray-200 rounded-xl" />
        <div className="h-4 w-1/2 bg-gray-200 rounded-full" />
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
        {[0, 1, 2, 3, 4].map((i) => (
          <div key={i} className="surface-card rounded-2xl h-20" />
        ))}
      </div>
      <div className="surface-card rounded-2xl h-44" />
      <div className="surface-card rounded-2xl h-32" />
    </div>
  );
}

/* ────────────────────────────────────────────────────────────────────────── */
/*  Tiny atoms                                                               */
/* ────────────────────────────────────────────────────────────────────────── */

function PulseDot({ color }: { color: string }) {
  return (
    <span className="relative flex h-2 w-2">
      <span
        className="absolute inline-flex h-full w-full rounded-full opacity-75 animate-ping"
        style={{ backgroundColor: color }}
      />
      <span
        className="relative inline-flex h-2 w-2 rounded-full"
        style={{ backgroundColor: color }}
      />
    </span>
  );
}

function IconLock({ className = 'h-4 w-4' }: { className?: string }) {
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
        d="M16.5 10.5V6.75a4.5 4.5 0 10-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H6.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z"
      />
    </svg>
  );
}

function IconChip({ className = 'h-5 w-5' }: { className?: string }) {
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
        d="M5.25 8.25H3m18 0h-2.25M5.25 12H3m18 0h-2.25M5.25 15.75H3m18 0h-2.25M8.25 21v-2.25m0-13.5V3m3.75 18v-2.25m0-13.5V3m3.75 18v-2.25m0-13.5V3M5.25 5.25h13.5a.75.75 0 01.75.75v13.5a.75.75 0 01-.75.75H5.25a.75.75 0 01-.75-.75V6a.75.75 0 01.75-.75z"
      />
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M9 9h6v6H9z"
      />
    </svg>
  );
}
