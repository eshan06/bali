'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { updateUserAttributes } from 'aws-amplify/auth';
import { useAuthContext } from '@/components/auth/AuthProvider';
import type { UserRole } from '@bali/shared';

const PENDING_ROLE_KEY = 'bali:pendingSignupRole';

export default function OnboardingPage() {
  const { isAuthenticated, isLoading, role, refresh, logout } = useAuthContext();
  const router = useRouter();
  const [selected, setSelected] = useState<UserRole | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (isLoading) return;
    if (!isAuthenticated) {
      router.replace('/login/');
      return;
    }
    if (role === 'teacher') router.replace('/dashboard/');
    else if (role === 'student') router.replace('/student/');
  }, [isAuthenticated, isLoading, role, router]);

  useEffect(() => {
    try {
      const pending = window.sessionStorage.getItem(PENDING_ROLE_KEY);
      if (pending === 'teacher' || pending === 'student') {
        setSelected(pending);
      }
    } catch {}
  }, []);

  const handleContinue = async () => {
    if (!selected) return;
    setError('');
    setSaving(true);
    try {
      await updateUserAttributes({
        userAttributes: { 'custom:role': selected },
      });
      try {
        window.sessionStorage.removeItem(PENDING_ROLE_KEY);
      } catch {}
      await refresh();
      router.replace(selected === 'teacher' ? '/dashboard/' : '/student/');
    } catch (err: any) {
      setError(err.message || 'Could not save your role');
    } finally {
      setSaving(false);
    }
  };

  if (isLoading || !isAuthenticated || role !== 'unset') {
    return (
      <div className="flex h-screen items-center justify-center">
        <div className="animate-spin h-8 w-8 border-4 border-primary-500 border-t-transparent rounded-full" />
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-50 px-4 py-12">
      <div className="w-full max-w-md space-y-8">
        <div className="text-center">
          <h1 className="text-4xl font-bold text-primary-600">Bali</h1>
          <p className="mt-2 text-gray-600">One last step</p>
        </div>

        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-8">
          <h2 className="text-xl font-semibold mb-2">How will you use Bali?</h2>
          <p className="text-sm text-gray-500 mb-6">
            Tell us who you are so we can set up the right experience.
          </p>

          {error && (
            <div className="mb-4 rounded-lg bg-red-50 p-3 text-sm text-red-600">{error}</div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <button
              onClick={() => setSelected('teacher')}
              className={`rounded-lg border px-4 py-6 text-left transition-colors ${
                selected === 'teacher'
                  ? 'border-primary-600 bg-primary-50'
                  : 'border-gray-300 hover:bg-gray-50'
              }`}
            >
              <div className="text-sm font-semibold text-gray-900">Teacher</div>
              <div className="mt-1 text-xs text-gray-500">
                Run classes, track attendance, manage blocking.
              </div>
            </button>
            <button
              onClick={() => setSelected('student')}
              className={`rounded-lg border px-4 py-6 text-left transition-colors ${
                selected === 'student'
                  ? 'border-primary-600 bg-primary-50'
                  : 'border-gray-300 hover:bg-gray-50'
              }`}
            >
              <div className="text-sm font-semibold text-gray-900">Student</div>
              <div className="mt-1 text-xs text-gray-500">
                Check in to class and stay focused.
              </div>
            </button>
          </div>

          <button
            onClick={handleContinue}
            disabled={!selected || saving}
            className="mt-6 w-full rounded-lg bg-primary-600 px-4 py-2.5 text-white font-medium hover:bg-primary-700 disabled:opacity-50 transition-colors"
          >
            {saving ? 'Saving...' : 'Continue'}
          </button>

          <button
            onClick={logout}
            className="mt-3 w-full text-sm text-gray-500 hover:text-gray-700"
          >
            Sign out
          </button>
        </div>
      </div>
    </div>
  );
}
