'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { api } from '@/lib/api-client';
import { Class, ClassSession, BlockingPreset } from '@bali/shared';

const BRAND = '#2E5BD0';

const PRESET_LABELS: Record<BlockingPreset, string> = {
  none: 'No blocking',
  full_focus: 'Full Focus',
  no_social_media: 'No Social Media',
  no_games: 'No Games',
  custom: 'Custom',
};

function periodLabel(period?: string | null): string | null {
  if (!period) return null;
  const trimmed = period.trim();
  if (!trimmed) return null;
  return /^period\b/i.test(trimmed) ? trimmed : `Period ${trimmed}`;
}

export default function ClassesPage() {
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

  useEffect(() => {
    load();
  }, [load]);

  return (
    <div className="space-y-8">
      {/* ── HEADER ─────────────────────────────────────────────── */}
      <header className="flex flex-col md:flex-row md:items-end md:justify-between gap-5">
        <div className="space-y-2 min-w-0">
          <p
            className="text-[11px] font-black uppercase tracking-[0.22em]"
            style={{ color: BRAND }}
          >
            Your roster
          </p>
          <h1 className="text-3xl md:text-5xl font-black tracking-tight text-gray-900 leading-[1.05]">
            Classes
          </h1>
          <p className="text-sm md:text-base text-gray-500 max-w-xl">
            Manage your classes, rosters, blocking policies, and live sessions.
          </p>
        </div>
        <Link
          href="/dashboard/classes/new/"
          className="inline-flex items-center gap-2 rounded-full px-6 py-3 text-sm font-bold text-white transition-opacity hover:opacity-90 shadow-sm self-start"
          style={{ backgroundColor: BRAND }}
        >
          <IconPlus className="h-4 w-4" />
          Create Class
        </Link>
      </header>

      {/* ── CONTENT ────────────────────────────────────────────── */}
      {loading ? (
        <ClassesSkeleton />
      ) : errored ? (
        <ClassesError onRetry={load} />
      ) : classes.length === 0 ? (
        <ClassesEmptyState />
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
          {classes.map((cls) => (
            <ClassCard
              key={cls.id}
              cls={cls}
              isLive={activeSession?.classId === cls.id}
            />
          ))}
        </div>
      )}
    </div>
  );
}

/* ────────────────────────────────────────────────────────────────────────── */
/*  Subcomponents                                                            */
/* ────────────────────────────────────────────────────────────────────────── */

function ClassCard({ cls, isLive }: { cls: Class; isLive: boolean }) {
  const presetLabel = PRESET_LABELS[cls.blockingPreset] ?? 'No blocking';
  const studentCount = cls.studentCount ?? 0;
  const blockingOn = cls.blockingPreset !== 'none';
  const eyebrow = periodLabel(cls.period) ?? 'Class';

  return (
    <div className="surface-card rounded-2xl p-6 flex flex-col group transition-all duration-200 hover:-translate-y-0.5 hover:shadow-lg">
      <Link href={`/dashboard/classes/${cls.id}/`} className="block min-w-0">
        <div className="flex items-start justify-between gap-3">
          <p
            className="text-[11px] font-black uppercase tracking-[0.18em]"
            style={{ color: BRAND }}
          >
            {eyebrow}
          </p>
          {isLive && (
            <span
              className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[11px] font-bold uppercase tracking-wider whitespace-nowrap"
              style={{
                backgroundColor: 'rgba(46, 91, 208, 0.10)',
                color: BRAND,
              }}
            >
              <PulseDot color={BRAND} />
              Live
            </span>
          )}
        </div>
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
          href={
            isLive
              ? '/dashboard/session/'
              : `/dashboard/session/?classId=${cls.id}`
          }
          className="flex-1 inline-flex items-center justify-center gap-1.5 rounded-full px-4 py-2.5 text-sm font-bold text-white transition-opacity hover:opacity-90 shadow-sm"
          style={{ backgroundColor: BRAND }}
        >
          {isLive ? (
            <>
              <PulseDot color="#ffffff" />
              View Session
            </>
          ) : (
            <>
              <IconPlay className="h-3.5 w-3.5" />
              Start Session
            </>
          )}
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

function ClassesSkeleton() {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5 animate-pulse">
      {[0, 1, 2, 3, 4, 5].map((i) => (
        <div key={i} className="surface-card rounded-2xl h-60" />
      ))}
    </div>
  );
}

function ClassesError({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="surface-card rounded-3xl px-8 py-20">
      <div className="max-w-md mx-auto text-center space-y-5">
        <div className="mx-auto h-16 w-16 rounded-full bg-red-50 flex items-center justify-center text-red-600">
          <svg
            className="h-7 w-7"
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
        <div className="space-y-2">
          <h3 className="text-2xl md:text-3xl font-black tracking-tight text-gray-900">
            We couldn't load your classes
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

function IconPlus({ className = 'h-4 w-4' }: { className?: string }) {
  return (
    <svg
      className={className}
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth={2.4}
    >
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 5v14M5 12h14" />
    </svg>
  );
}

function IconStudents({ className = 'h-5 w-5' }: { className?: string }) {
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

function IconArrowUpRight({ className = 'h-4 w-4' }: { className?: string }) {
  return (
    <svg
      className={className}
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth={2.2}
    >
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
