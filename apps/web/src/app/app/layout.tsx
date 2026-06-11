'use client';

import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { Sidenav } from '@/components/shell/Sidenav';
import { useAuth } from '@/lib/auth';

export default function AppShell({ children }: { children: React.ReactNode }) {
  const { teacher, loading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!loading && !teacher) router.replace('/login');
  }, [loading, teacher, router]);

  if (loading || !teacher) {
    return <div className="flex min-h-screen items-center justify-center text-ink-tertiary">Loading…</div>;
  }

  return (
    <div className="grid min-h-screen grid-cols-[216px_1fr]">
      <Sidenav />
      <main className="min-w-0">{children}</main>
    </div>
  );
}
