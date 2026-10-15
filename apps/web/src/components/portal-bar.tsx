'use client';

import { LogOut } from 'lucide-react';
import Link from 'next/link';

import { Button } from '@/components/button';
import { LOCKUP, Mark, TOP_BAR } from '@/components/mark';

/**
 * The bar over a signed-in page with no side menu (S4a; the Invite board's, PV15): Bali, a link
 * home in the brand's ink as every board renders it, and Sign out, small, with its icon. The shell
 * (`shell.tsx`) puts it over the invite page, over any page of an account that doesn't teach, and
 * over an account read that failed, and signs out; a teacher's pages have the side menu instead.
 */
export function PortalBar({ leaving, onSignOut }: { leaving: boolean; onSignOut: () => void }) {
  return (
    <header className={TOP_BAR}>
      <Link href="/" translate="no" className={`${LOCKUP} rounded-item text-text-brand`}>
        <Mark size={20} />
        Bali
      </Link>
      <Button variant="secondary" size="sm" onClick={onSignOut} aria-disabled={leaving}>
        <LogOut size={16} aria-hidden="true" />
        {leaving ? 'Signing out…' : 'Sign out'}
      </Button>
    </header>
  );
}
