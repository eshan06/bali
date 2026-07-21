'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { ArcMark } from '@/components/bali/ArcMark';
import { useAuth } from '@/lib/auth';

/** Cognito hosted-UI redirect target (Google sign-in). Amplify completes the code
 *  exchange on load; we wait for the profile and route in. */
export default function AuthCallback() {
  const router = useRouter();
  const { teacher, loading, reload } = useAuth();
  const [stuck, setStuck] = useState(false);

  // Poll reload() until Amplify has stored the tokens (slow links can take a few
  // seconds) rather than betting on a single fixed delay; give up after ~8s.
  useEffect(() => {
    let cancelled = false;
    const delays = [400, 800, 1200, 2000, 3000];
    const timers = delays.map((d) => setTimeout(() => !cancelled && void reload(), d));
    const giveUp = setTimeout(() => !cancelled && setStuck(true), 8000);
    return () => {
      cancelled = true;
      timers.forEach(clearTimeout);
      clearTimeout(giveUp);
    };
  }, [reload]);

  useEffect(() => {
    if (!loading && teacher) router.replace('/app');
  }, [loading, teacher, router]);

  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-4 px-6 text-center">
      <ArcMark size={32} />
      {stuck ? (
        <>
          <p className="text-[14px] text-ink-secondary">This is taking longer than expected.</p>
          <button
            type="button"
            onClick={() => router.replace('/login')}
            className="rounded-sm border border-line-strong bg-surface-card px-4 py-2 text-[13px] font-semibold text-ink-primary hover:bg-surface-sunken"
          >
            Back to sign in
          </button>
        </>
      ) : (
        <p className="text-[14px] text-ink-secondary">Signing you in…</p>
      )}
    </main>
  );
}
