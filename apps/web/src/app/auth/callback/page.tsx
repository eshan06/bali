'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';

import { buttonClass } from '@/components/button';
import { Lockup } from '@/components/mark';
import { completeLogin } from '@/lib/auth';

/**
 * Where the sign-in page sends the browser back (PKCE): the code is swapped for a token, then
 * home. Drawn as /login's card, so signing in reads as one place from Sign in to the classes; a
 * failure says so there, with the way back to try again.
 */
export default function CallbackPage() {
  const router = useRouter();
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const query = new URLSearchParams(window.location.search);
    completeLogin(query).then(
      () => router.replace('/'),
      () => setFailed(true),
    );
  }, [router]);

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-4 py-10 sm:px-10">
      <div className="rounded-lg border border-transparent bg-surface-card p-6 shadow-1 dark:border-border-default">
        <Lockup />
        {failed ? (
          <>
            <p role="alert" className="mt-6 text-body-lg">
              Bali couldn&apos;t finish signing you in.
            </p>
            <Link href="/login" className={buttonClass('primary', 'mt-6 w-full')}>
              Back to sign in
            </Link>
          </>
        ) : (
          <p role="status" className="mt-6 text-body-lg text-text-secondary">
            Signing in…
          </p>
        )}
      </div>
    </main>
  );
}
