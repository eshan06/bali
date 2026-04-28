'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuthContext } from '@/components/auth/AuthProvider';
import { api } from '@/lib/api-client';
import type { StudentSelf, StudentClassSummary, PendingInvite } from '@bali/shared';

const JOIN_PATH_RE = /\/join\/([0-9a-f-]{36})/i;

function extractClassId(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;
  const m = trimmed.match(JOIN_PATH_RE);
  if (m) return m[1];
  if (/^[0-9a-f-]{36}$/i.test(trimmed)) return trimmed;
  return null;
}

export default function StudentHomePage() {
  const { isAuthenticated, isLoading, role, user, logout } = useAuthContext();
  const router = useRouter();

  const [data, setData] = useState<StudentSelf | null>(null);
  const [loadError, setLoadError] = useState('');
  const [joinInput, setJoinInput] = useState('');
  const [joinError, setJoinError] = useState('');
  const [acceptingId, setAcceptingId] = useState<string | null>(null);
  const [inviteError, setInviteError] = useState('');

  const load = useCallback(async () => {
    setLoadError('');
    try {
      const me = await api.get<StudentSelf>('/students/me');
      setData(me);
    } catch (err: any) {
      const msg = err.message || '';
      if (msg.toLowerCase().includes('profile not created')) {
        router.replace('/onboarding/profile/');
        return;
      }
      setLoadError(msg || 'Could not load your account');
    }
  }, [router]);

  useEffect(() => {
    if (isLoading) return;
    if (!isAuthenticated) {
      router.replace('/login/');
      return;
    }
    if (role === 'teacher') {
      router.replace('/dashboard/');
      return;
    }
    if (role === 'unset') {
      router.replace('/onboarding/');
      return;
    }
    if (role === 'student' && !user?.student) {
      router.replace('/onboarding/profile/');
      return;
    }
    if (role === 'student') {
      load();
    }
  }, [isAuthenticated, isLoading, role, user, router, load]);

  const handleJoin = async (e: React.FormEvent) => {
    e.preventDefault();
    setJoinError('');
    const classId = extractClassId(joinInput);
    if (!classId) {
      setJoinError("That doesn't look like a Bali invite link.");
      return;
    }
    router.push(`/join/${classId}/`);
  };

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

  if (isLoading || !isAuthenticated || role !== 'student' || !user?.student) {
    return (
      <div className="flex h-screen items-center justify-center">
        <div className="animate-spin h-8 w-8 border-4 border-primary-500 border-t-transparent rounded-full" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white border-b border-gray-200">
        <div className="max-w-4xl mx-auto flex items-center justify-between px-6 py-4">
          <div className="flex items-baseline gap-3">
            <span className="text-2xl font-bold text-primary-600">Bali</span>
            <span className="text-sm text-gray-500">
              {user.student.firstName} {user.student.lastName}
              {user.student.grade ? ` · ${user.student.grade}` : ''}
            </span>
          </div>
          <button
            onClick={logout}
            className="text-sm text-gray-600 hover:text-gray-900"
          >
            Sign out
          </button>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-6 py-8 space-y-6">
        {loadError && (
          <div className="rounded-lg bg-red-50 p-3 text-sm text-red-600">{loadError}</div>
        )}

        {data && data.pendingInvites.length > 0 && (
          <section>
            <h2 className="text-lg font-semibold text-gray-900 mb-3">Pending invites</h2>
            {inviteError && (
              <div className="mb-3 rounded-lg bg-red-50 p-3 text-sm text-red-600">{inviteError}</div>
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

        {data && data.classes.length === 0 && data.pendingInvites.length === 0 ? (
          <EmptyState
            joinInput={joinInput}
            setJoinInput={setJoinInput}
            joinError={joinError}
            onJoin={handleJoin}
          />
        ) : (
          <>
            {data && data.classes.length > 0 && (
              <section>
                <h2 className="text-lg font-semibold text-gray-900 mb-3">Your classes</h2>
                <div className="space-y-3">
                  {data.classes.map((cls) => <ClassCard key={cls.id} cls={cls} />)}
                </div>
              </section>
            )}

            <section className="bg-white rounded-xl border border-gray-200 p-5">
              <h3 className="font-semibold text-gray-900">Join another class</h3>
              <p className="text-sm text-gray-500 mt-1">
                Paste the invite link your teacher shared with you.
              </p>
              <form onSubmit={handleJoin} className="mt-3 flex gap-2">
                <input
                  type="text"
                  value={joinInput}
                  onChange={(e) => setJoinInput(e.target.value)}
                  placeholder="https://.../join/..."
                  className="flex-1 rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
                />
                <button
                  type="submit"
                  className="rounded-lg bg-primary-600 px-4 py-2 text-sm font-medium text-white hover:bg-primary-700 transition-colors"
                >
                  Join
                </button>
              </form>
              {joinError && (
                <p className="mt-2 text-sm text-red-600">{joinError}</p>
              )}
            </section>
          </>
        )}
      </main>
    </div>
  );
}

function EmptyState({
  joinInput,
  setJoinInput,
  joinError,
  onJoin,
}: {
  joinInput: string;
  setJoinInput: (v: string) => void;
  joinError: string;
  onJoin: (e: React.FormEvent) => void;
}) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 p-8 text-center space-y-4">
      <h2 className="text-xl font-semibold text-gray-900">No classes yet</h2>
      <p className="text-sm text-gray-500">
        Ask your teacher for an invite link, then paste it below to join your first class.
      </p>
      <form onSubmit={onJoin} className="flex gap-2 max-w-md mx-auto pt-2">
        <input
          type="text"
          value={joinInput}
          onChange={(e) => setJoinInput(e.target.value)}
          placeholder="https://.../join/..."
          className="flex-1 rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
        />
        <button
          type="submit"
          className="rounded-lg bg-primary-600 px-4 py-2 text-sm font-medium text-white hover:bg-primary-700 transition-colors"
        >
          Join
        </button>
      </form>
      {joinError && (
        <p className="text-sm text-red-600">{joinError}</p>
      )}
    </div>
  );
}

function ClassCard({ cls }: { cls: StudentClassSummary }) {
  const session = cls.activeSession;
  return (
    <div className="bg-white rounded-xl border border-gray-200 p-5">
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
    <div className="bg-white rounded-xl border border-primary-200 ring-1 ring-primary-100 p-5">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <span className="rounded-full bg-primary-50 text-primary-700 px-2 py-0.5 text-xs font-medium">
              New invite
            </span>
          </div>
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
          className="shrink-0 rounded-lg bg-primary-600 px-4 py-2 text-sm font-medium text-white hover:bg-primary-700 disabled:opacity-50 transition-colors"
        >
          {busy ? 'Accepting...' : 'Accept'}
        </button>
      </div>
    </div>
  );
}

function SessionBadge({ session }: { session: NonNullable<StudentClassSummary['activeSession']> }) {
  if (session.checkedIn) {
    const label = session.attendanceStatus === 'late' ? 'Checked in (late)' : 'Checked in';
    return (
      <span className="shrink-0 rounded-full bg-green-50 text-green-700 px-3 py-1 text-xs font-medium">
        {label}
      </span>
    );
  }
  return (
    <span className="shrink-0 rounded-full bg-amber-50 text-amber-700 px-3 py-1 text-xs font-medium">
      Class in session — tap to check in
    </span>
  );
}
