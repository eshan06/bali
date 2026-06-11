'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuthContext } from '@/components/auth/AuthProvider';

const PENDING_REDIRECT_KEY = 'bali:pendingRedirect';

function consumePendingRedirect(): string | null {
  try {
    const value = window.sessionStorage.getItem(PENDING_REDIRECT_KEY);
    if (value) window.sessionStorage.removeItem(PENDING_REDIRECT_KEY);
    return value;
  } catch {
    return null;
  }
}

export default function AuthCallback() {
  const { isAuthenticated, isLoading, role, user } = useAuthContext();
  const router = useRouter();

  useEffect(() => {
    if (isLoading) return;
    if (!isAuthenticated) {
      router.replace('/login/');
      return;
    }

    const redirect = consumePendingRedirect();

    if (role === 'teacher') {
      router.replace(redirect || '/dashboard/');
    } else if (role === 'student') {
      if (!user?.student) {
        router.replace(
          redirect
            ? `/onboarding/profile/?redirect=${encodeURIComponent(redirect)}`
            : '/onboarding/profile/'
        );
      } else {
        router.replace(redirect || '/student/');
      }
    } else {
      router.replace(
        redirect
          ? `/onboarding/?redirect=${encodeURIComponent(redirect)}`
          : '/onboarding/'
      );
    }
  }, [isAuthenticated, isLoading, role, user, router]);

  return (
    <div className="bg-aurora flex h-screen items-center justify-center">
      <div className="text-center">
        <div className="animate-spin h-8 w-8 border-4 border-primary-500 border-t-transparent rounded-full mx-auto" />
        <p className="mt-4 text-gray-600">Completing sign in...</p>
      </div>
    </div>
  );
}
