'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { api } from '@/lib/api-client';
import { useAuthContext } from '@/components/auth/AuthProvider';
import { Class, ClassSession, BlockingPreset } from '@bali/shared';

const BRAND = '#2E5BD0';

// Classroom hero image. Reuses the lead image from the landing page slideshow
// so the dashboard hero feels like a natural continuation of the brand.
const HERO_IMG =
  'https://images.unsplash.com/photo-1588072432836-e10032774350?w=1920';

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
  const trimmed = displayName.trim();
  // If the display name is actually an email, fall back to the local part —
  // and strip anything that isn't a clean first name.
  if (trimmed.includes('@')) {
    const local = trimmed.split('@')[0].replace(/[._-].*$/, '');
    return capitalize(local) || 'there';
  }
  const first = trimmed.split(/\s+/)[0];
  return first || 'there';
}

function capitalize(s: string): string {
  if (!s) return s;
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function periodLabel(period?: string | null): string | null {
  if (!period) return null;
  const trimmed = period.trim();
  if (!trimmed) return null;
  // Don't double-prefix if the value already starts with "Period".
  return /^period\b/i.test(trimmed) ? trimmed : `Period ${trimmed}`;
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
    <div className="space-y-10">
      {/* ── HERO ────────────────────────────────────────────────────────── */}
      <section className="relative rounded-3xl overflow-hidden shadow-lg">
        {/* classroom photo bg — extended past the container with negative
            inset so the blur doesn't show hard edges, scaled up slightly so
            we see a wider classroom scene (less concentrated on one face). */}
        <div
          aria-hidden
          className="absolute"
          style={{
            inset: '-16px',
            backgroundImage: `url(${HERO_IMG})`,
            backgroundSize: 'auto 125%',
            backgroundPosition: 'right center',
            backgroundRepeat: 'no-repeat',
            filter: 'blur(4px)',
          }}
        />
        {/* solid dark left half + gradient that fades the dark out toward
            the right, leaving the (blurred) photo visible on the right
            with a subtle navy tint for legibility/cohesion. */}
        <div
          aria-hidden
          className="absolute inset-0"
          style={{
            background:
              'linear-gradient(90deg, rgba(8, 14, 36, 1.0) 0%, rgba(8, 14, 36, 0.96) 30%, rgba(10, 18, 46, 0.55) 55%, rgba(10, 18, 46, 0.25) 80%, rgba(10, 18, 46, 0.15) 100%)',
          }}
        />

        <div className="relative px-7 md:px-10 py-7 md:py-9 flex flex-col gap-5 max-w-2xl">
          <div className="space-y-2.5">
            <p
              className="text-[11px] font-black uppercase tracking-[0.22em]"
              style={{ color: '#7FA3F5' }}
            >
              {formatToday()}
            </p>
            <h1 className="text-3xl md:text-5xl font-black tracking-tight text-white leading-[1.05]">
              Welcome back, {firstName}.
            </h1>
            <p className="text-sm md:text-base text-white/80 max-w-xl leading-relaxed">
              Manage your classes, sessions, and student focus from one place.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <Link
              href="/dashboard/classes/new/"
              className="inline-flex items-center gap-2 rounded-full px-5 py-2.5 text-sm font-bold text-white transition-opacity hover:opacity-90 shadow-md"
              style={{ backgroundColor: BRAND }}
            >
              <IconPlus className="h-4 w-4" />
              Create Class
            </Link>
            {activeSession && (
              <Link
                href="/dashboard/session/"
                className="inline-flex items-center gap-2.5 rounded-full border border-white/30 bg-white/10 backdrop-blur px-4 py-2.5 text-sm font-bold text-white transition-colors hover:bg-white/20"
              >
                <PulseDot color="#ffffff" />
                View Active Session
              </Link>
            )}
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
      <section className="grid grid-cols-1 md:grid-cols-3 gap-5">
        <StatCard
          icon={<IconClasses className="h-7 w-7" />}
          title="Total Classes"
          value={classes.length}
          helper="Classes you manage"
        />
        <StatCard
          icon={<IconStudents className="h-7 w-7" />}
          title="Total Students"
          value={totalStudents}
          helper="Across all classes"
        />
        <StatCard
          icon={<IconSession active={!!activeSession} className="h-7 w-7" />}
          title="Session Status"
          value={activeSession ? 'Active' : 'Idle'}
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
          <h2 className="text-3xl md:text-4xl font-black tracking-tight text-gray-900">
            Your Classes
          </h2>
          <p className="mt-1.5 text-sm text-gray-500 max-w-2xl">
            Open a class to manage students and blocking policies, or start a live session.
          </p>
        </header>

        {classes.length === 0 ? (
          <ClassesEmptyState />
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
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
  const meta = [periodLabel(period), blockingLabel, elapsedLabel].filter(Boolean).join(' · ');

  return (
    <section
      className="rounded-3xl p-7 md:p-9 text-white shadow-lg relative overflow-hidden"
      style={{
        background: `linear-gradient(135deg, ${BRAND} 0%, #1d3fa8 100%)`,
      }}
    >
      <div
        aria-hidden
        className="pointer-events-none absolute -top-24 -right-24 h-72 w-72 rounded-full bg-white/10"
      />
      <div className="relative flex flex-col md:flex-row md:items-center md:justify-between gap-5">
        <div className="min-w-0">
          <div className="flex items-center gap-2.5 text-[11px] font-black uppercase tracking-[0.22em] text-white/85">
            <PulseDot color="#ffffff" />
            Live Session
          </div>
          <h3 className="mt-3 text-2xl md:text-3xl font-black tracking-tight truncate">
            {session.className || 'Class in session'}
          </h3>
          <p className="mt-1.5 text-sm md:text-base text-white/85">{meta}</p>
        </div>
        <Link
          href="/dashboard/session/"
          className="inline-flex items-center justify-center rounded-full bg-white px-7 py-3 text-sm font-bold transition-opacity hover:opacity-90 shadow-sm whitespace-nowrap"
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
    <div className="surface-card rounded-2xl p-6 flex items-center gap-5 transition-all hover:-translate-y-0.5 hover:shadow-md">
      <div
        className="flex-shrink-0 h-16 w-16 rounded-2xl flex items-center justify-center"
        style={{ backgroundColor: 'rgba(46, 91, 208, 0.10)', color: BRAND }}
      >
        {icon}
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-[11px] font-black uppercase tracking-[0.18em] text-gray-400">
          {title}
        </p>
        <p className="mt-1 text-3xl md:text-4xl font-black tracking-tight text-gray-900 truncate leading-none">
          {value}
        </p>
        <p className="mt-1.5 text-sm text-gray-500 truncate">{helper}</p>
      </div>
    </div>
  );
}

function ClassCard({ cls }: { cls: Class }) {
  const presetLabel = PRESET_LABELS[cls.blockingPreset] ?? 'No blocking';
  const studentCount = cls.studentCount ?? 0;
  const blockingOn = cls.blockingPreset !== 'none';
  const eyebrow = periodLabel(cls.period) ?? 'Class';

  return (
    <div className="surface-card rounded-2xl p-6 flex flex-col group transition-all duration-200 hover:-translate-y-0.5 hover:shadow-lg">
      <Link href={`/dashboard/classes/${cls.id}/`} className="block min-w-0">
        <p
          className="text-[11px] font-black uppercase tracking-[0.18em]"
          style={{ color: BRAND }}
        >
          {eyebrow}
        </p>
        <h3 className="mt-2 text-xl md:text-2xl font-black tracking-tight text-gray-900 line-clamp-2 group-hover:text-brand transition-colors">
          {cls.name}
        </h3>
      </Link>

      <ul className="mt-5 space-y-2.5 text-sm text-gray-600">
        <li className="flex items-center gap-2.5">
          <IconStudents className="h-4 w-4 text-gray-400" />
          <span className="font-medium text-gray-700">
            {studentCount} {studentCount === 1 ? 'student' : 'students'}
          </span>
        </li>
        <li className="flex items-center gap-2.5">
          <span
            className="h-2 w-2 rounded-full"
            style={{ backgroundColor: blockingOn ? BRAND : '#d1d5db' }}
          />
          <span className="text-gray-600">
            <span className="text-gray-400">Blocking · </span>
            <span className="font-medium text-gray-700">{presetLabel}</span>
          </span>
        </li>
      </ul>

      <div className="mt-7 pt-5 border-t border-gray-100 flex gap-2">
        <Link
          href={`/dashboard/classes/${cls.id}/`}
          className="flex-1 inline-flex items-center justify-center gap-1.5 rounded-full border border-gray-200 bg-white px-4 py-2.5 text-sm font-bold text-gray-700 hover:bg-gray-50 transition-colors"
        >
          Open Class
          <IconArrowUpRight className="h-3.5 w-3.5" />
        </Link>
        <Link
          href={`/dashboard/session/?classId=${cls.id}`}
          className="flex-1 inline-flex items-center justify-center gap-1.5 rounded-full px-4 py-2.5 text-sm font-bold text-white transition-opacity hover:opacity-90 shadow-sm"
          style={{ backgroundColor: BRAND }}
        >
          <IconPlay className="h-3.5 w-3.5" />
          Start Session
        </Link>
      </div>
    </div>
  );
}

function ClassesEmptyState() {
  return (
    <div className="surface-card rounded-3xl px-8 py-20 sm:px-16">
      <div className="max-w-lg mx-auto text-center space-y-6">
        <div
          className="mx-auto h-1 w-16 rounded-full"
          style={{ backgroundColor: BRAND }}
        />
        <div className="space-y-3">
          <h3 className="text-3xl md:text-4xl font-black tracking-tight text-gray-900">
            No classes yet
          </h3>
          <p className="text-gray-500 max-w-sm mx-auto leading-relaxed">
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
    <div className="space-y-10 animate-pulse">
      <div className="surface-card-hero rounded-3xl h-56" />
      <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
        {[0, 1, 2].map((i) => (
          <div key={i} className="surface-card rounded-2xl h-36" />
        ))}
      </div>
      <div className="space-y-6">
        <div className="space-y-2">
          <div className="h-3 w-24 bg-gray-200 rounded-full" />
          <div className="h-9 w-48 bg-gray-200 rounded-xl" />
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
          {[0, 1, 2].map((i) => (
            <div key={i} className="surface-card rounded-2xl h-60" />
          ))}
        </div>
      </div>
    </div>
  );
}

function DashboardError({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="surface-card rounded-3xl px-8 py-20">
      <div className="max-w-md mx-auto text-center space-y-5">
        <div className="mx-auto h-16 w-16 rounded-full bg-red-50 flex items-center justify-center text-red-600">
          <svg className="h-7 w-7" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" />
          </svg>
        </div>
        <div className="space-y-2">
          <h3 className="text-2xl md:text-3xl font-black tracking-tight text-gray-900">
            We couldn't load your dashboard
          </h3>
          <p className="text-gray-500">Check your connection and try again.</p>
        </div>
        <button
          onClick={onRetry}
          className="inline-flex items-center rounded-full px-7 py-3 text-sm font-bold text-white transition-opacity hover:opacity-90 shadow-sm"
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

function IconPlus({ className = 'h-4 w-4' }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.4}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 5v14M5 12h14" />
    </svg>
  );
}

function IconArrowUpRight({ className = 'h-4 w-4' }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M7 17L17 7M9 7h8v8" />
    </svg>
  );
}

function IconPlay({ className = 'h-4 w-4' }: { className?: string }) {
  return (
    <svg className={className} fill="currentColor" viewBox="0 0 24 24">
      <path d="M8 5v14l11-7z" />
    </svg>
  );
}
