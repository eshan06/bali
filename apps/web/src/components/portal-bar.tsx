'use client';

import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';

import { endSession } from '@/lib/auth';

/** The pages nobody is signed in on: no Sign out there. */
const SIGNED_OUT_PATHS = /^\/(login|auth)(\/|$)/;

/**
 * The bar across every signed-in page (S4a), the invite-code screen's included: the name, and
 * Sign out. Sign out forgets the token and ends the Cognito session at the hosted UI, which comes
 * back to /login; if the browser can't be sent there, the token is gone all the same and /login
 * says what is left to do.
 */
export function PortalBar() {
  const router = useRouter();
  const path = usePathname();
  const [leaving, setLeaving] = useState(false);

  // Back here from the hosted UI by the back button (the page kept whole): Sign out works again.
  useEffect(() => {
    const back = (e: PageTransitionEvent) => e.persisted && setLeaving(false);
    window.addEventListener('pageshow', back);
    return () => window.removeEventListener('pageshow', back);
  }, []);

  if (SIGNED_OUT_PATHS.test(path)) return null;

  function onSignOut() {
    if (leaving) return;
    setLeaving(true);
    if (endSession() === 'local') router.replace('/login');
  }

  return (
    <header className="border-b border-slate-200 dark:border-slate-800">
      <div className="flex items-center justify-between px-4 py-3 sm:px-10">
        <span className="text-sm font-semibold">Bali</span>
        <button
          type="button"
          onClick={onSignOut}
          aria-disabled={leaving}
          className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm transition-colors hover:bg-slate-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-600 aria-disabled:opacity-60 motion-reduce:transition-none dark:border-slate-700 dark:hover:bg-slate-900"
        >
          {leaving ? 'Signing out…' : 'Sign out'}
        </button>
      </div>
    </header>
  );
}
