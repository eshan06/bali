'use client';

import { useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { updateUserAttributes } from 'aws-amplify/auth';
import { useAuthContext } from '@/components/auth/AuthProvider';
import type { UserRole } from '@bali/shared';

const PENDING_ROLE_KEY = 'bali:pendingSignupRole';

function withRedirect(path: string, redirect: string | null) {
  return redirect ? `${path}?redirect=${encodeURIComponent(redirect)}` : path;
}

export default function OnboardingPage() {
  const { isAuthenticated, isLoading, role, user, refresh, logout } = useAuthContext();
  const router = useRouter();
  const searchParams = useSearchParams();
  const redirect = searchParams.get('redirect');
  const [selected, setSelected] = useState<UserRole | null>(null);
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  // Pre-fill names if Cognito already has them (e.g. Google sign-in supplies
  // a real name; refreshing this page shouldn't make the user retype).
  useEffect(() => {
    const dn = user?.displayName?.trim();
    if (!dn || dn.includes('@')) return;
    if (firstName || lastName) return;
    const parts = dn.split(/\s+/);
    setFirstName(parts[0] ?? '');
    setLastName(parts.slice(1).join(' '));
  }, [user?.displayName, firstName, lastName]);

  useEffect(() => {
    if (isLoading) return;
    if (!isAuthenticated) {
      router.replace(withRedirect('/login/', redirect));
      return;
    }
    if (role === 'teacher') router.replace(redirect || '/dashboard/');
    else if (role === 'student') router.replace(withRedirect('/onboarding/profile/', redirect));
  }, [isAuthenticated, isLoading, role, router, redirect]);

  useEffect(() => {
    try {
      const pending = window.sessionStorage.getItem(PENDING_ROLE_KEY);
      if (pending === 'teacher' || pending === 'student') {
        setSelected(pending);
      }
    } catch {}
  }, []);

  const trimmedFirst = firstName.trim();
  const trimmedLast = lastName.trim();
  const fullName = [trimmedFirst, trimmedLast].filter(Boolean).join(' ');
  const canContinue = !!selected && !!trimmedFirst && !!trimmedLast;

  const handleContinue = async () => {
    if (!canContinue) return;
    setError('');
    setSaving(true);
    try {
      await updateUserAttributes({
        userAttributes: { 'custom:role': selected!, name: fullName },
      });
      try {
        window.sessionStorage.removeItem(PENDING_ROLE_KEY);
      } catch {}
      await refresh();
      if (selected === 'teacher') {
        router.replace(redirect || '/dashboard/');
      } else {
        router.replace(withRedirect('/onboarding/profile/', redirect));
      }
    } catch (err: any) {
      setError(err.message || 'Could not save your details');
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

          <div className="grid grid-cols-2 gap-3 mb-5">
            <div>
              <label htmlFor="firstName" className="block text-sm font-medium text-gray-700 mb-1">
                First name
              </label>
              <input
                id="firstName"
                type="text"
                required
                autoComplete="given-name"
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
                autoComplete="family-name"
                value={lastName}
                onChange={(e) => setLastName(e.target.value)}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
              />
            </div>
          </div>

          <p className="text-sm font-medium text-gray-700 mb-2">I am a</p>
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
            disabled={!canContinue || saving}
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
