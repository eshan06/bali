'use client';

import { useEffect, useState } from 'react';

import { Button } from '@/components/button';
import { CARD_ALONE } from '@/components/card';
import { EntryPage } from '@/components/entry-page';
import { TextLink } from '@/components/text-link';
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

export default function LoginPage() {
  const [error, setError] = useState<string | null>(null);
  const [left, setLeft] = useState<SignedOut | null>(null);

  // Read after hydration: sessionStorage is the browser's, and the server drew none.
  useEffect(() => setLeft(signedOut()), []);

  function onSignIn() {
    setError(null);
    startLogin().catch(() => setError("Bali couldn't open the sign-in page. Try again."));
  }

  return (
    <EntryPage>
      {/* A card on its own (DESIGN.md §4): radius-lg, space-6 padding, its own hairline edge. */}
      <div className={CARD_ALONE}>
        <h1 className="text-h1 text-balance">Teacher portal</h1>
        <p className="mt-2 text-body-lg text-pretty text-text-secondary">
          Sign in to see your classes.
        </p>
        {left ? (
          <p role="status" className="mt-6 text-body text-pretty">
            {SIGNED_OUT[left]}
          </p>
        ) : null}
        <Button onClick={onSignIn} className="mt-8 w-full">
          Sign in
        </Button>
        {error ? (
          <p role="alert" className="mt-4 text-body text-pretty">
            {error}
          </p>
        ) : null}
      </div>
      {/* The public pages, under the card and in line with its text: the card keeps to signing in. */}
      <nav aria-label="Help and policies" className="mt-4 px-6">
        <ul className="flex flex-wrap gap-x-5 gap-y-2 text-body">
          {PUBLIC_PAGES.map((page) => (
            <li key={page.href}>
              <TextLink href={page.href}>{page.label}</TextLink>
            </li>
          ))}
        </ul>
      </nav>
    </EntryPage>
  );
}
