'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { api } from '@/lib/api-client';
import { useAuthContext } from '@/components/auth/AuthProvider';
import type { StudentSelf, StudentClassSummary, PendingInvite } from '@bali/shared';

const BRAND = '#2E5BD0';

function periodLabel(period?: string | null): string | null {
  if (!period) return null;
  const trimmed = period.trim();
  if (!trimmed) return null;
  return /^period\b/i.test(trimmed) ? trimmed : `Period ${trimmed}`;
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

  const firstName = user?.student?.firstName ?? 'there';
  const empty =
    data && data.classes.length === 0 && data.pendingInvites.length === 0;

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
          Tap a class to see attendance and live session details. Pending
          invites from your teachers show up here too.
        </p>
      </header>

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

function ClassCard({ cls }: { cls: StudentClassSummary }) {
  const session = cls.activeSession;
  const period = periodLabel(cls.period);
  const meta = [cls.teacherName, period, cls.schoolName]
    .filter(Boolean)
    .join(' · ');

  return (
    <article className="surface-card rounded-2xl p-6 transition-all hover:-translate-y-0.5 hover:shadow-md">
      <div className="flex items-start justify-between gap-4">
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
        {session && <SessionBadge session={session} />}
      </div>

      <dl className="mt-5 grid grid-cols-2 gap-3 text-sm">
        <div className="rounded-xl border border-gray-100 bg-gray-50/60 px-4 py-3">
          <dt className="text-[11px] font-bold uppercase tracking-wider text-gray-400">
            Attendance
          </dt>
          <dd className="mt-1 text-xl font-black tracking-tight text-gray-900 leading-none">
            {cls.attendanceRate}%
          </dd>
        </div>
        <div className="rounded-xl border border-gray-100 bg-gray-50/60 px-4 py-3">
          <dt className="text-[11px] font-bold uppercase tracking-wider text-gray-400">
            Sessions
          </dt>
          <dd className="mt-1 text-xl font-black tracking-tight text-gray-900 leading-none">
            {cls.totalSessions}
          </dd>
        </div>
      </dl>
    </article>
  );
}

function SessionBadge({
  session,
}: {
  session: NonNullable<StudentClassSummary['activeSession']>;
}) {
  if (session.checkedIn) {
    const label =
      session.attendanceStatus === 'late' ? 'Checked in (late)' : 'Checked in';
    return (
      <span className="shrink-0 inline-flex items-center gap-1.5 rounded-full bg-green-50 border border-green-200 px-3 py-1 text-xs font-bold text-green-700 whitespace-nowrap">
        <span className="h-1.5 w-1.5 rounded-full bg-green-600" />
        {label}
      </span>
    );
  }
  return (
    <span className="shrink-0 inline-flex items-center gap-1.5 rounded-full bg-amber-50 border border-amber-200 px-3 py-1 text-xs font-bold text-amber-700 whitespace-nowrap">
      <PulseDot color="#b45309" />
      Tap to check in
    </span>
  );
}

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
            Join your first class with an invite link, class code, or QR code
            from your teacher.
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

function PulseDot({ color }: { color: string }) {
  return (
    <span className="relative flex h-1.5 w-1.5">
      <span
        className="absolute inline-flex h-full w-full rounded-full opacity-75 animate-ping"
        style={{ backgroundColor: color }}
      />
      <span
        className="relative inline-flex h-1.5 w-1.5 rounded-full"
        style={{ backgroundColor: color }}
      />
    </span>
  );
}
