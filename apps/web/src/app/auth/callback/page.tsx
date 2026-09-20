'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';

import { completeLogin } from '@/lib/auth';

export default function CallbackPage() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const query = new URLSearchParams(window.location.search);
    completeLogin(query).then(
      () => router.replace('/'),
      () => setError('Sign-in failed. Please try again.'),
    );
  }, [router]);

  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col items-center justify-center gap-4 px-4">
      {error ? (
        <>
          <p className="text-sm text-red-600">{error}</p>
          <a href="/login" className="text-sm underline">
            Back to sign in
          </a>
        </>
      ) : (
        <p className="text-sm text-slate-500">Signing in…</p>
      )}
    </main>
  );
}
