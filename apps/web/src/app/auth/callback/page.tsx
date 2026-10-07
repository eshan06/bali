'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';

import { buttonClass } from '@/components/button';
import { CARD_ALONE } from '@/components/card';
import { EntryPage } from '@/components/entry-page';
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
    <EntryPage>
      <div className={CARD_ALONE}>
        {failed ? (
          <>
            <p role="alert" className="text-body-lg text-pretty">
              Bali couldn&apos;t finish signing you in.
            </p>
            <Link href="/login" className={buttonClass('primary', 'mt-6 w-full')}>
              Back to sign in
            </Link>
          </>
        ) : (
          <p role="status" className="text-body-lg text-pretty text-text-secondary">
            Signing in…
          </p>
        )}
      </div>
    </EntryPage>
  );
}
