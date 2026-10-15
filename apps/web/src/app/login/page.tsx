'use client';

import { useEffect, useState } from 'react';

import { Button } from '@/components/button';
import { CARD_ENTRY } from '@/components/card';
import { EntryPage, STAGE_FOOT } from '@/components/entry-page';
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

/**
 * Sign in, for teachers and students (SignIn, EntryStates; PV15): v2's stage, its card with the
 * words for both (W3's, decision 13), the line for students under it, then the public pages. A Sign
 * out's word sits over Sign in, a page that didn't open under it, as Entry & info placed them.
 */
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
      <section aria-labelledby="sign-in-title" className={CARD_ENTRY}>
        <h1 id="sign-in-title" className="text-entry-title">
          Sign in to Bali
        </h1>
        <p className="-mt-2.5 text-body text-text-secondary">
          Teachers and students sign in here to see their classes.
        </p>
        {left ? (
          <p role="status" className="text-body text-pretty">
            {SIGNED_OUT[left]}
          </p>
        ) : null}
        <Button size="lg" onClick={onSignIn} className="w-full">
          Sign in
        </Button>
        {error ? (
          <p role="alert" className="text-body text-pretty">
            {error}
          </p>
        ) : null}
      </section>
      <p className={STAGE_FOOT}>Students: set up Bali in the app on your iPhone first.</p>
      {/* The public pages, under the card: the card keeps to signing in. */}
      <nav aria-label="Help and policies" className="w-full pt-2.5">
        <ul className="flex flex-wrap justify-center gap-x-4.5 gap-y-1.5 text-meta">
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
