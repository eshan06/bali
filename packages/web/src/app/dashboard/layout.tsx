'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuthContext } from '@/components/auth/AuthProvider';
import { Sidebar } from '@/components/layout/Sidebar';

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, isLoading, role } = useAuthContext();
  const router = useRouter();

  useEffect(() => {
    if (isLoading) return;
    if (!isAuthenticated) {
      router.replace('/login/');
      return;
    }
    if (role === 'student') router.replace('/student/');
    else if (role === 'unset') router.replace('/onboarding/');
  }, [isAuthenticated, isLoading, role, router]);

  if (isLoading) {
    return (
      <div className="bg-dash flex h-screen items-center justify-center">
        <div className="animate-spin h-8 w-8 border-4 border-brand border-t-transparent rounded-full" />
      </div>
    );
  }

  if (!isAuthenticated || role !== 'teacher') return null;

  return (
    <div className="bg-dash min-h-screen">
      <div className="flex h-screen">
        <Sidebar />
        <main className="flex-1 overflow-auto">
          <div className="px-6 md:px-10 py-8 md:py-10 max-w-7xl mx-auto">{children}</div>
        </main>
      </div>
    </div>
  );
}
