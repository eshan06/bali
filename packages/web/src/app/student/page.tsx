'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuthContext } from '@/components/auth/AuthProvider';

export default function StudentHomePage() {
  const { isAuthenticated, isLoading, role, user, logout } = useAuthContext();
  const router = useRouter();

  useEffect(() => {
    if (isLoading) return;
    if (!isAuthenticated) {
      router.replace('/login/');
      return;
    }
    if (role === 'teacher') router.replace('/dashboard/');
    else if (role === 'unset') router.replace('/onboarding/');
  }, [isAuthenticated, isLoading, role, router]);

  if (isLoading || !isAuthenticated || role !== 'student') {
    return (
      <div className="flex h-screen items-center justify-center">
        <div className="animate-spin h-8 w-8 border-4 border-primary-500 border-t-transparent rounded-full" />
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-50 px-4">
      <div className="w-full max-w-md text-center space-y-6">
        <h1 className="text-4xl font-bold text-primary-600">Bali</h1>
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-8 space-y-4">
          <h2 className="text-xl font-semibold text-gray-900">You&apos;re signed in</h2>
          <p className="text-sm text-gray-500">
            The student experience is coming soon. For now, your teacher will handle the rest.
          </p>
          <p className="text-sm text-gray-400">
            Signed in as <span className="font-medium text-gray-600">{user?.email}</span>
          </p>
          <button
            onClick={logout}
            className="w-full rounded-lg border border-gray-300 px-4 py-2.5 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors"
          >
            Sign out
          </button>
        </div>
      </div>
    </div>
  );
}
