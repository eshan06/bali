'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';

import { type SignedOut, signedOut, startLogin } from '@/lib/auth';

/** What a Sign out in this tab (S4a) left behind, said once on the way back here. */
const SIGNED_OUT: Record<SignedOut, string> = {
  ended: "You're signed out.",
  local:
    "You're signed out of Bali in this tab, but the sign-in page may still remember you. Close the browser before someone else uses this computer.",
};

/** The pages read without signing in: the help page (P4) and the policy pages (C2a). */
const PUBLIC_PAGES = [
  { href: '/support', label: 'Help and questions' },
  { href: '/privacy', label: 'Privacy policy' },
  { href: '/terms', label: 'Terms' },
];

const PUBLIC_LINK =
  'text-slate-600 underline underline-offset-2 hover:text-slate-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-600 dark:text-slate-300 dark:hover:text-slate-100';

export default function LoginPage() {
  const [error, setError] = useState<string | null>(null);
  const [left, setLeft] = useState<SignedOut | null>(null);

  // Read after hydration: sessionStorage is the browser's, and the server drew none.
  useEffect(() => setLeft(signedOut()), []);

  function onSignIn() {
    setError(null);
    startLogin().catch(() => setError('Could not start sign-in. Check the portal configuration.'));
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col items-center justify-center gap-6 px-4">
      <h1 className="text-2xl font-semibold">Bali</h1>
      {left ? (
        <p role="status" className="text-center text-sm font-medium">
          {SIGNED_OUT[left]}
        </p>
      ) : null}
      <p className="text-center text-sm text-slate-500">
        Teacher portal — sign in to see your classes.
      </p>
      <button
        type="button"
        onClick={onSignIn}
        className="rounded-lg bg-slate-900 px-5 py-2.5 text-sm font-medium text-white hover:bg-slate-700 dark:bg-slate-100 dark:text-slate-900"
      >
        Sign in
      </button>
      {error ? <p className="text-sm text-red-600">{error}</p> : null}
      <nav aria-label="Help and policies">
        <ul className="flex flex-wrap justify-center gap-x-6 gap-y-2 text-sm">
          {PUBLIC_PAGES.map((page) => (
            <li key={page.href}>
              <Link href={page.href} className={PUBLIC_LINK}>
                {page.label}
              </Link>
            </li>
          ))}
        </ul>
      </nav>
    </main>
  );
}
