'use client';

import { useEffect, useState, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useAuthContext } from '@/components/auth/AuthProvider';
import { api } from '@/lib/api-client';
import type { StudentSelf } from '@bali/shared';

function StudentProfileOnboardingPageInner() {
  const { isAuthenticated, isLoading, role, user, refresh, logout } = useAuthContext();
  const router = useRouter();
  const searchParams = useSearchParams();
  const redirect = searchParams.get('redirect');

  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [grade, setGrade] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [bootstrapped, setBootstrapped] = useState(false);

  useEffect(() => {
    if (isLoading) return;
    if (!isAuthenticated) {
      const next = redirect ? `/login/?redirect=${encodeURIComponent(redirect)}` : '/login/';
      router.replace(next);
      return;
    }
    if (role === 'unset') {
      const next = redirect
        ? `/onboarding/?redirect=${encodeURIComponent(redirect)}`
        : '/onboarding/';
      router.replace(next);
      return;
    }
    if (role === 'teacher') {
      router.replace('/dashboard/');
      return;
    }
    if (role === 'student' && user?.student && !bootstrapped) {
      setFirstName(user.student.firstName);
      setLastName(user.student.lastName);
      setGrade(user.student.grade ?? '');
      setBootstrapped(true);
    }
  }, [isAuthenticated, isLoading, role, user, router, redirect, bootstrapped]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSaving(true);
    try {
      await api.post<StudentSelf>('/students/me', {
        firstName: firstName.trim(),
        lastName: lastName.trim(),
        grade: grade.trim(),
      });
      await refresh();
      router.replace(redirect || '/student/');
    } catch (err: any) {
      setError(err.message || 'Could not save your profile');
    } finally {
      setSaving(false);
    }
  };

  if (isLoading || !isAuthenticated || role !== 'student') {
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
          <p className="mt-2 text-gray-600">Tell us a bit about you</p>
        </div>

        <form
          onSubmit={handleSubmit}
          className="bg-white rounded-xl shadow-sm border border-gray-200 p-8 space-y-4"
        >
          {error && (
            <div className="rounded-lg bg-red-50 p-3 text-sm text-red-600">{error}</div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label htmlFor="firstName" className="block text-sm font-medium text-gray-700 mb-1">
                First name
              </label>
              <input
                id="firstName"
                type="text"
                required
                value={firstName}
                onChange={(e) => setFirstName(e.target.value)}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
              />
            </div>
            <div>
              <label htmlFor="lastName" className="block text-sm font-medium text-gray-700 mb-1">
                Last name
              </label>
              <input
                id="lastName"
                type="text"
                required
                value={lastName}
                onChange={(e) => setLastName(e.target.value)}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
              />
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Email</label>
            <div className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-600">
              {user?.email}
            </div>
          </div>

          <div>
            <label htmlFor="grade" className="block text-sm font-medium text-gray-700 mb-1">
              Grade <span className="text-gray-400 font-normal">(optional)</span>
            </label>
            <input
              id="grade"
              type="text"
              value={grade}
              onChange={(e) => setGrade(e.target.value)}
              placeholder="e.g. 10th, Senior, Year 11"
              className="w-full rounded-lg border border-gray-300 px-3 py-2 focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
            />
          </div>

          <button
            type="submit"
            disabled={saving || !firstName.trim() || !lastName.trim()}
            className="w-full rounded-lg bg-primary-600 px-4 py-2.5 text-white font-medium hover:bg-primary-700 disabled:opacity-50 transition-colors"
          >
            {saving ? 'Saving...' : 'Continue'}
          </button>

          <button
            type="button"
            onClick={logout}
            className="w-full text-sm text-gray-500 hover:text-gray-700"
          >
            Sign out
          </button>
        </form>
      </div>
    </div>
  );
}

// useSearchParams() needs a Suspense boundary above it or the production
// build fails when prerendering this route.
export default function StudentProfileOnboardingPage() {
  return (
    <Suspense fallback={null}>
      <StudentProfileOnboardingPageInner />
    </Suspense>
  );
}
