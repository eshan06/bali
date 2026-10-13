'use client';

import { LogOut } from 'lucide-react';
import Link from 'next/link';

import { Button } from '@/components/button';
import { Mark } from '@/components/mark';

/**
 * Today's bar (S4a): the mark and the name, home, and Sign out. The shell (`shell.tsx`) puts it
 * over a signed-in page for an account that isn't a teacher (the invite-code screen's, until PV15
 * draws it in v2's look) and after a failed account read, and signs out; a teacher's pages have the
 * side menu instead.
 */
export function PortalBar({ leaving, onSignOut }: { leaving: boolean; onSignOut: () => void }) {
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
