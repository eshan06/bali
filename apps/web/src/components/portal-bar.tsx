'use client';

import { LogOut } from 'lucide-react';
import Link from 'next/link';

import { Button } from '@/components/button';
import { Mark } from '@/components/mark';

/**
 * The bar over the invite-code screen (S4a), until PV15 draws that page in v2's look: the mark and
 * the name, home, and Sign out. The shell (`shell.tsx`) puts it there and signs out; every other
 * signed-in page has the side menu instead.
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
