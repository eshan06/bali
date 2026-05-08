'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { api } from '@/lib/api-client';
import { useAuthContext } from '@/components/auth/AuthProvider';
import type {
  StudentSelf,
  StudentClassSummary,
  PendingInvite,
} from '@bali/shared';

const BRAND = '#2E5BD0';

function periodLabel(period?: string | null): string | null {
  if (!period) return null;
  const trimmed = period.trim();
  if (!trimmed) return null;
  return /^period\b/i.test(trimmed) ? trimmed : `Period ${trimmed}`;
}

function formatStartedAt(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

type CardState = 'idle' | 'in_session' | 'checked_in' | 'checked_in_late';

function classState(cls: StudentClassSummary): CardState {
  const s = cls.activeSession;
  if (!s) return 'idle';
  if (!s.checkedIn) return 'in_session';
  if (s.attendanceStatus === 'late') return 'checked_in_late';
  return 'checked_in';
}

export default function StudentClassesPage() {
  const { user } = useAuthContext();
  const [data, setData] = useState<StudentSelf | null>(null);
  const [loadError, setLoadError] = useState('');
  const [loading, setLoading] = useState(true);
  const [acceptingId, setAcceptingId] = useState<string | null>(null);
  const [inviteError, setInviteError] = useState('');

  const load = useCallback(async () => {
    setLoadError('');
    try {
      const me = await api.get<StudentSelf>('/students/me');
      setData(me);
    } catch (err: any) {
      setLoadError(err.message || 'Could not load your classes');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const handleAcceptInvite = async (inviteId: string) => {
    setInviteError('');
    setAcceptingId(inviteId);
    try {
      await api.post(`/invites/${inviteId}/accept`);
      await load();
    } catch (err: any) {
      setInviteError(err.message || 'Could not accept invite');
    } finally {
      setAcceptingId(null);
    }
  };

  if (loading) return <ClassesSkeleton />;

  if (loadError) {
    return (
      <div className="surface-card rounded-3xl px-8 py-16 max-w-xl mx-auto text-center space-y-4">
        <h2 className="text-2xl md:text-3xl font-black tracking-tight text-gray-900">
          We couldn't load your classes
        </h2>
        <p className="text-gray-500">Check your connection and try again.</p>
        <button
          onClick={load}
          className="inline-flex items-center justify-center rounded-full px-6 py-2.5 text-sm font-bold text-white transition-opacity hover:opacity-90 shadow-sm"
          style={{ backgroundColor: BRAND }}
        >
          Try again
        </button>
      </div>
    );
  }

  const firstName = user?.student?.firstName ?? 'there';
  const empty =
    data && data.classes.length === 0 && data.pendingInvites.length === 0;

  const needsCheckIn =
    data?.classes.some((c) => classState(c) === 'in_session') ?? false;
  const anyActive =
    data?.classes.some((c) => !!c.activeSession) ?? false;

  return (
    <div className="space-y-8">
      {/* ── HEADER ─────────────────────────────────────────────── */}
      <header className="space-y-2">
        <p
          className="text-[11px] font-black uppercase tracking-[0.22em]"
          style={{ color: BRAND }}
        >
          Your classes
        </p>
        <h1 className="text-3xl md:text-4xl font-black tracking-tight text-gray-900 leading-[1.05]">
          Hi, {firstName}.
        </h1>
        <p className="text-sm md:text-base text-gray-500 max-w-xl">
          View your classes, check your attendance, and see when focus mode is
          active.
        </p>
      </header>

      {/* ── ACTION BANNER (only when something needs attention) ── */}
      {needsCheckIn ? (
        <ActionBanner
          tone="amber"
          title="You have a class in session."
          body="Tap your Bali block to check in."
        />
      ) : anyActive ? (
        <ActionBanner
          tone="brand"
          title="A class is in session."
          body="You're already checked in. Focus mode applies until the session ends."
        />
      ) : null}

      {/* ── PENDING INVITES ───────────────────────────────────── */}
      {data && data.pendingInvites.length > 0 && (
        <section className="space-y-3">
          <div className="flex items-baseline justify-between gap-3">
            <h2 className="text-xl font-black tracking-tight text-gray-900">
              Pending invites
            </h2>
            <span className="text-xs font-bold uppercase tracking-wider text-gray-400">
              {data.pendingInvites.length}
            </span>
          </div>
          {inviteError && (
            <div className="rounded-xl bg-red-50 border border-red-100 p-3 text-sm text-red-700">
              {inviteError}
            </div>
          )}
          <div className="space-y-3">
            {data.pendingInvites.map((inv) => (
              <InviteCard
                key={inv.inviteId}
                invite={inv}
                busy={acceptingId === inv.inviteId}
                onAccept={() => handleAcceptInvite(inv.inviteId)}
              />
            ))}
          </div>
        </section>
      )}

      {/* ── CLASSES ───────────────────────────────────────────── */}
      {empty ? (
        <EmptyState />
      ) : data && data.classes.length > 0 ? (
        <section className="space-y-3">
          <h2 className="text-xl font-black tracking-tight text-gray-900">
            Your classes
          </h2>
          <div className="space-y-3">
            {data.classes.map((cls) => (
              <ClassCard key={cls.id} cls={cls} />
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}

/* ────────────────────────────────────────────────────────────────────────── */
/*  Class card                                                               */
/* ────────────────────────────────────────────────────────────────────────── */

function ClassCard({ cls }: { cls: StudentClassSummary }) {
  const session = cls.activeSession;
  const state = classState(cls);
  const period = periodLabel(cls.period);
  const meta = [cls.teacherName, cls.schoolName].filter(Boolean).join(' · ');
  const focusModeActive = !!session?.blockingEnabled;

  // Subtle accent ring on cards that need student attention.
  const accentStyle =
    state === 'in_session'
      ? { boxShadow: '0 0 0 1px rgba(180, 83, 9, 0.20)' }
      : state === 'checked_in'
      ? { boxShadow: '0 0 0 1px rgba(21, 128, 61, 0.18)' }
      : state === 'checked_in_late'
      ? { boxShadow: '0 0 0 1px rgba(180, 83, 9, 0.20)' }
      : undefined;

  return (
    <article
      className="surface-card rounded-2xl p-6 space-y-5 transition-all hover:-translate-y-0.5 hover:shadow-md"
      style={accentStyle}
    >
      <header className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <p
            className="text-[11px] font-black uppercase tracking-[0.18em]"
            style={{ color: BRAND }}
          >
            {period ?? 'Class'}
          </p>
          <h3 className="mt-1 text-lg md:text-xl font-black tracking-tight text-gray-900 truncate">
            {cls.name}
          </h3>
          {meta && (
            <p className="text-sm text-gray-500 mt-0.5 truncate">{meta}</p>
          )}
        </div>
        <StatusPill state={state} />
      </header>

      {state === 'in_session' && session && (
        <div
          className="rounded-2xl border border-amber-200 bg-amber-50/70 px-4 py-3 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2"
        >
          <div className="flex items-center gap-2.5">
            <PulseDot color="#b45309" />
            <p className="text-sm font-bold text-amber-800">
              Tap your Bali block to check in.
            </p>
          </div>
          <p className="text-xs text-amber-700">
            Started {formatStartedAt(session.startedAt)}
          </p>
        </div>
      )}

      {(state === 'checked_in' || state === 'checked_in_late') && session && (
        <div className="rounded-2xl border border-green-100 bg-green-50/70 px-4 py-3 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
          <div className="flex items-center gap-2.5">
            <span className="h-2 w-2 rounded-full bg-green-600" />
            <p className="text-sm font-bold text-green-800">
              {state === 'checked_in_late'
                ? "You're checked in (late)."
                : "You're checked in."}
            </p>
          </div>
          <p className="text-xs text-green-700">
            Started {formatStartedAt(session.startedAt)}
          </p>
        </div>
      )}

      {focusModeActive && (
        <div className="flex flex-wrap items-center gap-2">
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
          <span className="text-xs text-gray-500">
            Some apps are blocked until the session ends.
          </span>
        </div>
      )}

      <dl className="grid grid-cols-2 gap-3 text-sm">
        <Stat label="Attendance" value={`${cls.attendanceRate}%`} />
        <Stat label="Sessions" value={cls.totalSessions} />
      </dl>
    </article>
  );
}

function StatusPill({ state }: { state: CardState }) {
  if (state === 'in_session') {
    return (
      <span className="shrink-0 inline-flex items-center gap-1.5 rounded-full bg-amber-50 border border-amber-200 px-3 py-1 text-xs font-bold uppercase tracking-wider text-amber-700 whitespace-nowrap">
        <PulseDot color="#b45309" />
        Class in session
      </span>
    );
  }
  if (state === 'checked_in') {
    return (
      <span className="shrink-0 inline-flex items-center gap-1.5 rounded-full bg-green-50 border border-green-200 px-3 py-1 text-xs font-bold uppercase tracking-wider text-green-700 whitespace-nowrap">
        <span className="h-1.5 w-1.5 rounded-full bg-green-600" />
        Checked in
      </span>
    );
  }
  if (state === 'checked_in_late') {
    return (
      <span className="shrink-0 inline-flex items-center gap-1.5 rounded-full bg-amber-50 border border-amber-200 px-3 py-1 text-xs font-bold uppercase tracking-wider text-amber-700 whitespace-nowrap">
        <span className="h-1.5 w-1.5 rounded-full bg-amber-600" />
        Checked in late
      </span>
    );
  }
  return (
    <span className="shrink-0 inline-flex items-center gap-1.5 rounded-full bg-gray-50 border border-gray-200 px-3 py-1 text-xs font-bold uppercase tracking-wider text-gray-500 whitespace-nowrap">
      <span className="h-1.5 w-1.5 rounded-full bg-gray-400" />
      No active session
    </span>
  );
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-xl border border-gray-100 bg-gray-50/60 px-4 py-3">
      <dt className="text-[11px] font-bold uppercase tracking-wider text-gray-400">
        {label}
      </dt>
      <dd className="mt-1 text-xl font-black tracking-tight text-gray-900 leading-none">
        {value}
      </dd>
    </div>
  );
}

/* ────────────────────────────────────────────────────────────────────────── */
/*  Action banner                                                            */
/* ────────────────────────────────────────────────────────────────────────── */

function ActionBanner({
  tone,
  title,
  body,
}: {
  tone: 'amber' | 'brand';
  title: string;
  body: string;
}) {
  if (tone === 'amber') {
    return (
      <section className="rounded-2xl border border-amber-200 bg-amber-50 px-5 py-4 flex items-start gap-3">
        <span className="mt-0.5">
          <PulseDot color="#b45309" />
        </span>
        <div className="min-w-0">
          <p className="text-sm font-black tracking-tight text-amber-900">
            {title}
          </p>
          <p className="text-sm text-amber-800 mt-0.5">{body}</p>
        </div>
      </section>
    );
  }
  return (
    <section
      className="rounded-2xl border px-5 py-4 flex items-start gap-3"
      style={{
        backgroundColor: 'rgba(46, 91, 208, 0.06)',
        borderColor: 'rgba(46, 91, 208, 0.20)',
      }}
    >
      <span className="mt-0.5">
        <PulseDot color={BRAND} />
      </span>
      <div className="min-w-0">
        <p
          className="text-sm font-black tracking-tight"
          style={{ color: '#1e3a8a' }}
        >
          {title}
        </p>
        <p className="text-sm mt-0.5" style={{ color: '#3a4d7a' }}>
          {body}
        </p>
      </div>
    </section>
  );
}

/* ────────────────────────────────────────────────────────────────────────── */
/*  Invites + empty                                                          */
/* ────────────────────────────────────────────────────────────────────────── */

function InviteCard({
  invite,
  busy,
  onAccept,
}: {
  invite: PendingInvite;
  busy: boolean;
  onAccept: () => void;
}) {
  const period = periodLabel(invite.period);
  const meta = [invite.teacherName, period, invite.schoolName]
    .filter(Boolean)
    .join(' · ');

  return (
    <article
      className="surface-card rounded-2xl p-6"
      style={{
        boxShadow:
          '0 1px 2px rgba(46, 91, 208, 0.05), 0 0 0 1px rgba(46, 91, 208, 0.15)',
      }}
    >
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <span
            className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[11px] font-bold uppercase tracking-wider"
            style={{
              backgroundColor: 'rgba(46, 91, 208, 0.10)',
              color: BRAND,
            }}
          >
            New invite
          </span>
          <h3 className="mt-2 text-lg font-black tracking-tight text-gray-900 truncate">
            {invite.className}
          </h3>
          {meta && (
            <p className="text-sm text-gray-500 mt-0.5 truncate">{meta}</p>
          )}
        </div>
        <button
          onClick={onAccept}
          disabled={busy}
          className="shrink-0 inline-flex items-center justify-center rounded-full px-5 py-2 text-sm font-bold text-white transition-opacity hover:opacity-90 shadow-sm disabled:opacity-50"
          style={{ backgroundColor: BRAND }}
        >
          {busy ? 'Accepting…' : 'Accept'}
        </button>
      </div>
    </article>
  );
}

function EmptyState() {
  return (
    <div className="surface-card rounded-3xl px-8 py-16 sm:px-12">
      <div className="max-w-lg mx-auto text-center space-y-6">
        <div
          className="mx-auto h-16 w-16 rounded-2xl flex items-center justify-center"
          style={{ backgroundColor: 'rgba(46, 91, 208, 0.10)', color: BRAND }}
        >
          <svg
            className="h-7 w-7"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={1.8}
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M12 14l9-5-9-5-9 5 9 5z"
            />
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M12 14l6.16-3.422a12.083 12.083 0 01.665 6.479A11.952 11.952 0 0012 20.055a11.952 11.952 0 00-6.824-2.998 12.078 12.078 0 01.665-6.479L12 14z"
            />
          </svg>
        </div>
        <div className="space-y-2">
          <h2 className="text-2xl md:text-3xl font-black tracking-tight text-gray-900">
            No classes yet
          </h2>
          <p className="text-gray-500 max-w-sm mx-auto leading-relaxed">
            Join your first class using a link, class code, or QR code from
            your teacher.
          </p>
        </div>
        <Link
          href="/student/join/"
          className="inline-flex items-center justify-center rounded-full px-7 py-3 text-sm font-bold text-white transition-opacity hover:opacity-90 shadow-sm"
          style={{ backgroundColor: BRAND }}
        >
          Join a class
        </Link>
      </div>
    </div>
  );
}

function ClassesSkeleton() {
  return (
    <div className="space-y-8 animate-pulse">
      <div className="space-y-3">
        <div className="h-3 w-24 bg-gray-200 rounded-full" />
        <div className="h-9 w-48 bg-gray-200 rounded-xl" />
        <div className="h-4 w-2/3 bg-gray-200 rounded-full" />
      </div>
      <div className="space-y-3">
        {[0, 1, 2].map((i) => (
          <div key={i} className="surface-card rounded-2xl h-40" />
        ))}
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
