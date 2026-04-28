'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { api } from '@/lib/api-client';
import type { StudentSelf, StudentClassSummary, PendingInvite } from '@bali/shared';

export default function StudentClassesPage() {
  const [data, setData] = useState<StudentSelf | null>(null);
  const [loadError, setLoadError] = useState('');
  const [acceptingId, setAcceptingId] = useState<string | null>(null);
  const [inviteError, setInviteError] = useState('');

  const load = useCallback(async () => {
    setLoadError('');
    try {
      const me = await api.get<StudentSelf>('/students/me');
      setData(me);
    } catch (err: any) {
      setLoadError(err.message || 'Could not load your classes');
    }
  }, []);

  useEffect(() => { load(); }, [load]);

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

  const empty = data && data.classes.length === 0 && data.pendingInvites.length === 0;

  return (
    <div className="space-y-8">
      {loadError && (
        <div className="rounded-2xl bg-red-50/80 backdrop-blur p-4 text-sm text-red-700">
          {loadError}
        </div>
      )}

      {data && data.pendingInvites.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-lg font-semibold text-gray-900">Pending invites</h2>
          {inviteError && (
            <div className="rounded-2xl bg-red-50/80 backdrop-blur p-3 text-sm text-red-700">
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

      {empty ? (
        <EmptyState />
      ) : data && data.classes.length > 0 ? (
        <section className="space-y-3">
          <h2 className="text-lg font-semibold text-gray-900">Your classes</h2>
          <div className="space-y-3">
            {data.classes.map((cls) => <ClassCard key={cls.id} cls={cls} />)}
          </div>
        </section>
      ) : null}
    </div>
  );
}

function EmptyState() {
  return (
    <div className="glass-card rounded-3xl px-8 py-14 sm:px-16">
      <div className="max-w-2xl mx-auto text-center space-y-6">
        <div className="mx-auto h-20 w-20 rounded-full bg-primary-100/60 backdrop-blur flex items-center justify-center">
          <svg
            className="h-9 w-9 text-primary-600"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={1.8}
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 14l9-5-9-5-9 5 9 5z" />
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M12 14l6.16-3.422a12.083 12.083 0 01.665 6.479A11.952 11.952 0 0012 20.055a11.952 11.952 0 00-6.824-2.998 12.078 12.078 0 01.665-6.479L12 14z"
            />
          </svg>
        </div>

        <div className="space-y-3">
          <h2 className="text-4xl sm:text-5xl font-bold text-gray-900 tracking-tight">
            No classes yet
          </h2>
          <p className="text-base text-gray-500 max-w-md mx-auto">
            Join your first class with an invite link, class code, or by scanning a QR code.
          </p>
        </div>

        <div className="pt-2">
          <Link
            href="/student/join/"
            className="inline-block rounded-2xl bg-primary-600 px-8 py-4 text-base font-semibold text-white shadow-sm hover:bg-primary-700 transition-colors"
          >
            Join a class
          </Link>
        </div>
      </div>
    </div>
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
  return (
    <div className="glass-card rounded-2xl p-5 ring-1 ring-primary-200/50">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <span className="inline-block rounded-full bg-primary-100/80 text-primary-700 px-2.5 py-0.5 text-xs font-medium mb-2">
            New invite
          </span>
          <h3 className="font-semibold text-gray-900 truncate">{invite.className}</h3>
          <p className="text-sm text-gray-500 mt-0.5">
            {invite.teacherName}
            {invite.period ? ` · Period ${invite.period}` : ''}
            {invite.schoolName ? ` · ${invite.schoolName}` : ''}
          </p>
        </div>
        <button
          onClick={onAccept}
          disabled={busy}
          className="shrink-0 rounded-xl bg-primary-600 px-5 py-2 text-sm font-semibold text-white hover:bg-primary-700 disabled:opacity-50 transition-colors"
        >
          {busy ? 'Accepting...' : 'Accept'}
        </button>
      </div>
    </div>
  );
}

function ClassCard({ cls }: { cls: StudentClassSummary }) {
  const session = cls.activeSession;
  return (
    <div className="glass-card rounded-2xl p-5">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h3 className="font-semibold text-gray-900 truncate">{cls.name}</h3>
          <p className="text-sm text-gray-500 mt-0.5">
            {cls.teacherName}
            {cls.period ? ` · Period ${cls.period}` : ''}
            {cls.schoolName ? ` · ${cls.schoolName}` : ''}
          </p>
        </div>
        {session && <SessionBadge session={session} />}
      </div>

      <div className="mt-4 flex items-center gap-6 text-sm">
        <div>
          <span className="text-gray-400">Attendance</span>{' '}
          <span className="font-medium text-gray-900">{cls.attendanceRate}%</span>
        </div>
        <div>
          <span className="text-gray-400">Sessions</span>{' '}
          <span className="font-medium text-gray-900">{cls.totalSessions}</span>
        </div>
      </div>
    </div>
  );
}

function SessionBadge({ session }: { session: NonNullable<StudentClassSummary['activeSession']> }) {
  if (session.checkedIn) {
    const label = session.attendanceStatus === 'late' ? 'Checked in (late)' : 'Checked in';
    return (
      <span className="shrink-0 rounded-full bg-green-100/80 text-green-800 px-3 py-1 text-xs font-medium">
        {label}
      </span>
    );
  }
  return (
    <span className="shrink-0 rounded-full bg-amber-100/80 text-amber-800 px-3 py-1 text-xs font-medium">
      Class in session — tap to check in
    </span>
  );
}
