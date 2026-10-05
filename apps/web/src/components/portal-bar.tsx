'use client';

import { LogOut } from 'lucide-react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';

import { Button } from '@/components/button';
import { Mark } from '@/components/mark';
import { endSession } from '@/lib/auth';

/** The pages read without signing in (sign-in itself, the help page and the policy pages): no Sign out there. */
const SIGNED_OUT_PATHS = /^\/(login|auth|support|privacy|terms)(\/|$)/;

/**
 * The bar across every signed-in page (S4a), the invite-code screen's included: the mark and the
 * name, home, and Sign out. Sign out forgets the token and ends the Cognito session at the hosted
 * UI, which comes back to /login; if the browser can't be sent there, the token is gone all the
 * same and /login says what is left to do.
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
    <header className="border-b border-border-default">
      <div className="flex h-14 items-center justify-between px-4 sm:px-10">
        <Link
          href="/"
          translate="no"
          className="inline-flex items-center gap-2 rounded-xs text-body font-semibold text-text-primary hover:underline"
        >
          <Mark size={24} />
          Bali
        </Link>
        <Button variant="secondary" onClick={onSignOut} aria-disabled={leaving}>
          <LogOut size={16} aria-hidden="true" />
          {leaving ? 'Signing out…' : 'Sign out'}
        </Button>
      </div>
    </header>
  );
}
