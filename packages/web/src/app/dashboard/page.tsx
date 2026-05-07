'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { api } from '@/lib/api-client';
import { useAuthContext } from '@/components/auth/AuthProvider';
import { Class, ClassSession, BlockingPreset } from '@bali/shared';

const BRAND = '#2E5BD0';

const PRESET_LABELS: Record<BlockingPreset, string> = {
  none: 'No blocking',
  full_focus: 'Full Focus',
  no_social_media: 'No Social Media',
  no_games: 'No Games',
  custom: 'Custom',
};

function formatToday() {
  return new Date().toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  });
}

function firstNameFrom(displayName?: string | null): string {
  if (!displayName) return 'there';
  const first = displayName.trim().split(/\s+/)[0];
  return first || 'there';
}

export default function DashboardPage() {
  const { user } = useAuthContext();
  const [classes, setClasses] = useState<Class[]>([]);
  const [activeSession, setActiveSession] = useState<ClassSession | null>(null);
  const [loading, setLoading] = useState(true);
  const [errored, setErrored] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setErrored(false);
    try {
      const [classRes, sessionRes] = await Promise.all([
        api.get<{ classes: Class[] }>('/classes'),
        api.get<{ session: ClassSession | null }>('/sessions/active'),
      ]);
      setClasses(classRes.classes);
      setActiveSession(sessionRes.session);
    } catch {
      setErrored(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  if (loading) return <DashboardSkeleton />;
  if (errored) return <DashboardError onRetry={load} />;

  const totalStudents = classes.reduce((sum, c) => sum + (c.studentCount || 0), 0);
  const sessionClass = activeSession
    ? classes.find((c) => c.id === activeSession.classId) ?? null
    : null;
  const elapsedMin = activeSession
    ? Math.max(0, Math.floor((Date.now() - new Date(activeSession.startedAt).getTime()) / 60000))
    : 0;
  const firstName = firstNameFrom(user?.displayName);

  return (
    <div className="space-y-8">
      {/* ── HERO ────────────────────────────────────────────────────────── */}
      <section className="glass-card-soft rounded-3xl p-8 md:p-10">
        <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-6">
          <div className="space-y-3 min-w-0">
            <p className="text-xs font-semibold uppercase tracking-widest text-gray-500">
              {formatToday()}
            </p>
            <h1 className="text-4xl md:text-5xl font-bold tracking-tight text-gray-900">
              Welcome back, {firstName}
            </h1>
            <p className="text-base md:text-lg text-gray-600 max-w-xl">
              Manage your classes, sessions, and student focus from one place.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-3 flex-shrink-0">
            {activeSession && (
              <Link
                href="/dashboard/session/"
                className="inline-flex items-center gap-2.5 rounded-full bg-white/85 backdrop-blur border border-white px-5 py-3 text-sm font-semibold transition-colors hover:bg-white shadow-sm"
                style={{ color: BRAND }}
              >
                <PulseDot color={BRAND} />
                View Active Session
              </Link>
            )}
            <Link
              href="/dashboard/classes/new/"
              className="inline-flex items-center rounded-full px-6 py-3 text-sm font-bold text-white transition-opacity hover:opacity-90 shadow-sm"
              style={{ backgroundColor: BRAND }}
            >
              Create Class
            </Link>
          </div>
        </div>
      </section>

      {/* ── ACTIVE SESSION BANNER ───────────────────────────────────────── */}
      {activeSession && (
        <ActiveSessionBanner
          session={activeSession}
          period={sessionClass?.period}
          elapsedMin={elapsedMin}
        />
      )}

      {/* ── STATS ───────────────────────────────────────────────────────── */}
      <section className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <StatCard
          icon={<IconClasses />}
          title="Total Classes"
          value={classes.length}
          helper="Classes you manage"
        />
        <StatCard
          icon={<IconStudents />}
          title="Total Students"
          value={totalStudents}
          helper="Across all classes"
        />
        <StatCard
          icon={<IconSession active={!!activeSession} />}
          title="Session Status"
          value={activeSession ? 'Active' : 'No active session'}
          helper={
            activeSession
              ? 'A class session is currently running'
              : 'Start a session from any class'
          }
        />
      </section>

      {/* ── YOUR CLASSES ────────────────────────────────────────────────── */}
      <section className="space-y-5">
        <header>
          <h2 className="text-2xl font-bold tracking-tight text-gray-900">Your Classes</h2>
          <p className="text-sm text-gray-500 mt-1">
            Open a class to manage students and blocking policies, or start a live session.
          </p>
        </header>

        {classes.length === 0 ? (
          <ClassesEmptyState />
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {classes.map((cls) => (
              <ClassCard key={cls.id} cls={cls} />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

/* ────────────────────────────────────────────────────────────────────────── */
/*  Subcomponents                                                            */
/* ────────────────────────────────────────────────────────────────────────── */

function ActiveSessionBanner({
  session,
  period,
  elapsedMin,
}: {
  session: ClassSession;
  period?: string;
  elapsedMin: number;
}) {
  const blockingLabel = session.blockingEnabled ? 'Blocking active' : 'Blocking off';
  const elapsedLabel = elapsedMin >= 1 ? `${elapsedMin} min in` : 'Just started';
  const meta = [period && `Period ${period}`, blockingLabel, elapsedLabel].filter(Boolean).join(' · ');

  return (
    <section
      className="rounded-3xl p-6 md:p-7 text-white shadow-lg"
      style={{
        background: `linear-gradient(135deg, ${BRAND} 0%, #1d3fa8 100%)`,
      }}
    >
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-5">
        <div className="min-w-0">
          <div className="flex items-center gap-2.5 text-[11px] font-bold uppercase tracking-[0.18em] text-white/80">
            <PulseDot color="#ffffff" />
            Active session running
          </div>
          <h3 className="mt-2.5 text-2xl md:text-3xl font-bold tracking-tight truncate">
            {session.className || 'Class in session'}
          </h3>
          <p className="mt-1 text-sm md:text-base text-white/85">{meta}</p>
        </div>
        <Link
          href="/dashboard/session/"
          className="inline-flex items-center justify-center rounded-full bg-white px-6 py-3 text-sm font-bold transition-opacity hover:opacity-90 shadow-sm whitespace-nowrap"
          style={{ color: BRAND }}
        >
          View Session
          <span className="ml-1.5">→</span>
        </Link>
      </div>
    </section>
  );
}

function StatCard({
  icon,
  title,
  value,
  helper,
}: {
  icon: React.ReactNode;
  title: string;
  value: string | number;
  helper: string;
}) {
  return (
    <div className="glass-card rounded-2xl p-6 transition-shadow hover:shadow-md">
      <div className="flex items-start gap-4">
        <div
          className="flex-shrink-0 h-11 w-11 rounded-xl flex items-center justify-center"
          style={{ backgroundColor: 'rgba(46, 91, 208, 0.10)', color: BRAND }}
        >
          {icon}
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-gray-500">{title}</p>
          <p className="mt-1 text-3xl font-bold tracking-tight text-gray-900 truncate">{value}</p>
          <p className="mt-1 text-xs text-gray-500">{helper}</p>
        </div>
      </div>
    </div>
  );
}

function ClassCard({ cls }: { cls: Class }) {
  const presetLabel = PRESET_LABELS[cls.blockingPreset] ?? 'No blocking';
  const studentCount = cls.studentCount ?? 0;
  const blockingOn = cls.blockingPreset !== 'none';

  return (
    <div className="glass-card rounded-2xl p-6 flex flex-col transition-all duration-200 hover:-translate-y-0.5 hover:shadow-lg">
      <Link href={`/dashboard/classes/${cls.id}/`} className="group block min-w-0">
        <h3 className="text-xl font-bold tracking-tight text-gray-900 group-hover:text-brand line-clamp-2 transition-colors">
          {cls.name}
        </h3>
        <p className="mt-1 text-sm text-gray-500">
          {cls.period ? `Period ${cls.period}` : <span className="opacity-0">.</span>}
        </p>
      </Link>

      <ul className="mt-4 space-y-2 text-sm text-gray-600">
        <li className="flex items-center gap-2.5">
          <IconStudents className="h-4 w-4 text-gray-400" />
          <span>
            {studentCount} {studentCount === 1 ? 'student' : 'students'}
          </span>
        </li>
        <li className="flex items-center gap-2.5">
          <span
            className="h-2 w-2 rounded-full"
            style={{ backgroundColor: blockingOn ? BRAND : '#d1d5db' }}
          />
          <span>
            <span className="text-gray-400">Blocking:</span> {presetLabel}
          </span>
        </li>
      </ul>

      <div className="mt-6 pt-5 border-t border-white/70 flex gap-2">
        <Link
          href={`/dashboard/classes/${cls.id}/`}
          className="flex-1 text-center rounded-xl border border-gray-200 bg-white/70 px-4 py-2 text-sm font-semibold text-gray-700 hover:bg-white transition-colors"
        >
          Open Class
        </Link>
        <Link
          href={`/dashboard/session/?classId=${cls.id}`}
          className="flex-1 text-center rounded-xl px-4 py-2 text-sm font-semibold text-white transition-opacity hover:opacity-90"
          style={{ backgroundColor: BRAND }}
        >
          Start Session
        </Link>
      </div>
    </div>
  );
}

function ClassesEmptyState() {
  return (
    <div className="glass-card rounded-3xl px-8 py-14 sm:px-16">
      <div className="max-w-lg mx-auto text-center space-y-5">
        <div
          className="mx-auto h-20 w-20 rounded-full flex items-center justify-center"
          style={{ backgroundColor: 'rgba(46, 91, 208, 0.10)', color: BRAND }}
        >
          <svg className="h-9 w-9" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.6}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 6.75A2.25 2.25 0 0114.25 9h5.25a.75.75 0 01.75.75v9.75a.75.75 0 01-.75.75h-5.25A2.25 2.25 0 0012 22.5m0-15.75A2.25 2.25 0 009.75 9H4.5a.75.75 0 00-.75.75v9.75c0 .414.336.75.75.75h5.25A2.25 2.25 0 0112 22.5m0-15.75v15.75" />
          </svg>
        </div>
        <div className="space-y-2">
          <h3 className="text-3xl font-bold tracking-tight text-gray-900">No classes yet</h3>
          <p className="text-gray-500 max-w-sm mx-auto">
            Create your first class to start managing attendance and app blocking.
          </p>
        </div>
        <Link
          href="/dashboard/classes/new/"
          className="inline-block rounded-full px-7 py-3 text-sm font-bold text-white transition-opacity hover:opacity-90 shadow-sm"
          style={{ backgroundColor: BRAND }}
        >
          Create Class
        </Link>
      </div>
    </div>
  );
}

function DashboardSkeleton() {
  return (
    <div className="space-y-8 animate-pulse">
      <div className="glass-card-soft rounded-3xl h-48" />
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {[0, 1, 2].map((i) => (
          <div key={i} className="glass-card rounded-2xl h-28" />
        ))}
      </div>
      <div className="space-y-5">
        <div className="h-7 w-48 bg-white/55 rounded-xl" />
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {[0, 1, 2].map((i) => (
            <div key={i} className="glass-card rounded-2xl h-56" />
          ))}
        </div>
      </div>
    </div>
  );
}

function DashboardError({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="glass-card rounded-3xl px-8 py-16">
      <div className="max-w-md mx-auto text-center space-y-5">
        <div className="mx-auto h-16 w-16 rounded-full bg-red-100/70 flex items-center justify-center text-red-600">
          <svg className="h-7 w-7" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" />
          </svg>
        </div>
        <div className="space-y-2">
          <h3 className="text-2xl font-bold tracking-tight text-gray-900">
            We couldn't load your dashboard
          </h3>
          <p className="text-gray-500">Check your connection and try again.</p>
        </div>
        <button
          onClick={onRetry}
          className="inline-flex items-center rounded-full px-6 py-2.5 text-sm font-bold text-white transition-opacity hover:opacity-90 shadow-sm"
          style={{ backgroundColor: BRAND }}
        >
          Try Again
        </button>
      </div>
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

function IconClasses({ className = 'h-5 w-5' }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.7}>
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M12 6.75A2.25 2.25 0 0114.25 9h5.25a.75.75 0 01.75.75v9.75a.75.75 0 01-.75.75h-5.25A2.25 2.25 0 0012 22.5m0-15.75A2.25 2.25 0 009.75 9H4.5a.75.75 0 00-.75.75v9.75c0 .414.336.75.75.75h5.25A2.25 2.25 0 0112 22.5m0-15.75v15.75"
      />
    </svg>
  );
}

function IconStudents({ className = 'h-5 w-5' }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.7}>
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M15 19.128a9.38 9.38 0 002.625.372 9.337 9.337 0 004.121-.952 4.125 4.125 0 00-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 018.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0111.964-3.07M12 6.375a3.375 3.375 0 11-6.75 0 3.375 3.375 0 016.75 0zm8.25 2.25a2.625 2.625 0 11-5.25 0 2.625 2.625 0 015.25 0z"
      />
    </svg>
  );
}

function IconSession({ active, className = 'h-5 w-5' }: { active: boolean; className?: string }) {
  if (active) {
    return (
      <svg className={className} fill="currentColor" viewBox="0 0 24 24">
        <path d="M8 5v14l11-7z" />
      </svg>
    );
  }
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.7}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
    </svg>
  );
}
