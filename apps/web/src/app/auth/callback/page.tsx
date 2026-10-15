'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';

import { buttonClass } from '@/components/button';
import { CARD_ENTRY } from '@/components/card';
import { EntryPage } from '@/components/entry-page';
import { completeLogin } from '@/lib/auth';

/**
 * Where the sign-in page sends the browser back (PKCE): the code is swapped for a token, then
 * home. On sign-in's own stage (AuthCallback, AuthCallbackFailed; PV1, built in PV15), so signing
 * in reads as one place from Sign in to the classes; a failure says so there, with the way back to
 * try again.
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
    <EntryPage>
      <section aria-label="Signing in" className={CARD_ENTRY}>
        {failed ? (
          <>
            <p role="alert" className="text-body text-pretty">
              Bali couldn&apos;t finish signing you in.
            </p>
            <Link href="/login" className={buttonClass('primary', 'w-full', 'lg')}>
              Back to sign in
            </Link>
          </>
        ) : (
          <p role="status" className="text-body text-pretty text-text-secondary">
            Signing in…
          </p>
        )}
      </section>
    </EntryPage>
  );
}
