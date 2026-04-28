'use client';

import { useCallback, useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useAuthContext } from '@/components/auth/AuthProvider';
import { api } from '@/lib/api-client';
import type { ClassJoinPreview } from '@bali/shared';

const PENDING_REDIRECT_KEY = 'bali:pendingRedirect';

export default function JoinClassPage() {
  const params = useParams<{ classId: string }>();
  const classId = params?.classId;
  const router = useRouter();
  const { isAuthenticated, isLoading, role, user } = useAuthContext();

  const [preview, setPreview] = useState<ClassJoinPreview | null>(null);
  const [error, setError] = useState('');
  const [joining, setJoining] = useState(false);

  const redirectTarget = `/join/${classId}/`;

  // Stash the redirect for the Google OAuth round-trip and route signed-out
  // users through the appropriate signup/onboarding step.
  useEffect(() => {
    if (isLoading) return;
    if (!classId) return;

    if (!isAuthenticated) {
      try {
        window.sessionStorage.setItem(PENDING_REDIRECT_KEY, redirectTarget);
      } catch {}
      router.replace(`/signup/?redirect=${encodeURIComponent(redirectTarget)}`);
      return;
    }
    if (role === 'unset') {
      router.replace(`/onboarding/?redirect=${encodeURIComponent(redirectTarget)}`);
      return;
    }
    if (role === 'teacher') {
      // Teachers can't join a class as a student.
      return;
    }
    if (role === 'student' && !user?.student) {
      router.replace(`/onboarding/profile/?redirect=${encodeURIComponent(redirectTarget)}`);
      return;
    }
  }, [isAuthenticated, isLoading, role, user, classId, redirectTarget, router]);

  const loadPreview = useCallback(async () => {
    if (!classId) return;
    setError('');
    try {
      const p = await api.get<ClassJoinPreview>(`/classes/${classId}/preview`);
      setPreview(p);
    } catch (err: any) {
      setError(err.message || 'Could not load class');
    }
  }, [classId]);

  useEffect(() => {
    if (isLoading) return;
    if (!isAuthenticated || role !== 'student' || !user?.student) return;
    loadPreview();
  }, [isLoading, isAuthenticated, role, user, loadPreview]);

  const handleJoin = async () => {
    if (!classId) return;
    setJoining(true);
    setError('');
    try {
      await api.post(`/classes/${classId}/join`);
      router.replace('/student/');
    } catch (err: any) {
      setError(err.message || 'Could not join class');
      setJoining(false);
    }
  };

  if (isLoading || !isAuthenticated || role === 'unset' || (role === 'student' && !user?.student)) {
    return (
      <div className="flex h-screen items-center justify-center">
        <div className="animate-spin h-8 w-8 border-4 border-primary-500 border-t-transparent rounded-full" />
      </div>
    );
  }

  if (role === 'teacher') {
    return (
      <CenteredCard title="Teacher account">
        <p className="text-sm text-gray-600">
          You&apos;re signed in as a teacher. Invite links are for students.
        </p>
        <button
          onClick={() => router.push('/dashboard/')}
          className="mt-4 w-full rounded-lg bg-primary-600 px-4 py-2.5 text-white font-medium hover:bg-primary-700 transition-colors"
        >
          Back to dashboard
        </button>
      </CenteredCard>
    );
  }

  return (
    <CenteredCard title="Join class">
      {error && (
        <div className="rounded-lg bg-red-50 p-3 text-sm text-red-600">{error}</div>
      )}

      {preview ? (
        <>
          <div className="space-y-1">
            <h3 className="text-lg font-semibold text-gray-900">{preview.className}</h3>
            <p className="text-sm text-gray-500">
              {preview.teacherName}
              {preview.period ? ` · Period ${preview.period}` : ''}
              {preview.schoolName ? ` · ${preview.schoolName}` : ''}
            </p>
          </div>

          {preview.alreadyEnrolled ? (
            <button
              onClick={() => router.replace('/student/')}
              className="w-full rounded-lg bg-primary-600 px-4 py-2.5 text-white font-medium hover:bg-primary-700 transition-colors"
            >
              Already joined — go to your classes
            </button>
          ) : (
            <button
              onClick={handleJoin}
              disabled={joining}
              className="w-full rounded-lg bg-primary-600 px-4 py-2.5 text-white font-medium hover:bg-primary-700 disabled:opacity-50 transition-colors"
            >
              {joining ? 'Joining...' : 'Join class'}
            </button>
          )}
        </>
      ) : !error ? (
        <div className="flex justify-center py-4">
          <div className="animate-spin h-6 w-6 border-4 border-primary-500 border-t-transparent rounded-full" />
        </div>
      ) : null}
    </CenteredCard>
  );
}

function CenteredCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-50 px-4 py-12">
      <div className="w-full max-w-md space-y-6">
        <div className="text-center">
          <h1 className="text-4xl font-bold text-primary-600">Bali</h1>
          <p className="mt-2 text-gray-600">{title}</p>
        </div>
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-8 space-y-4">
          {children}
        </div>
      </div>
    </div>
  );
}
