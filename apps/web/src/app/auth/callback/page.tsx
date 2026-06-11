'use client';

import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { ArcMark } from '@/components/bali/ArcMark';
import { useAuth } from '@/lib/auth';

/** Cognito hosted-UI redirect target (Google sign-in). Amplify completes the code
 *  exchange on load; we wait for the profile and route in. */
export default function AuthCallback() {
  const router = useRouter();
  const { teacher, loading, reload } = useAuth();

  useEffect(() => {
    const t = setTimeout(() => void reload(), 600); // give Amplify the tick to store tokens
    return () => clearTimeout(t);
  }, [reload]);

  useEffect(() => {
    if (!loading && teacher) router.replace('/app');
  }, [loading, teacher, router]);

  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-4">
      <ArcMark size={32} />
      <p className="text-[14px] text-ink-secondary">Signing you in…</p>
    </main>
  );
}
