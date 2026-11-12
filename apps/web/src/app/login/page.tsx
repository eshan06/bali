'use client';

import { useEffect, useState } from 'react';

import { Button } from '@/components/button';
import { SessionRingArt } from '@/components/mark';
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
 * Sign in, for teachers and students (the sign-in redesign's "The portal's sign-in page", the
 * owner, 2026-11-12): two panels, side by side from 1024 px. On the art's, green-50, Bali over the
 * session ring and its line; on the other, the card in W3's words for both (decision 13), its Sign
 * in a 52 px pill, the line for students under it, then the public pages. No Sign up: students sign
 * up in the app, where the 13+ question is. A Sign out's word sits over Sign in, a page that didn't
 * open under it (PortalStates). Narrower, the panels stack, the art on top, 240 px wide with its
 * line at 26/32, so Sign in shows on a phone's first screen (PortalPhone; PortalZoom, 200 %).
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
    <main className="flex min-h-dvh flex-col lg:flex-row">
      <div className="flex min-w-0 flex-col gap-4 bg-art-panel px-[clamp(24px,4vw,56px)] py-8 lg:flex-[1_1_560px] lg:gap-8 lg:py-12">
        <p translate="no" className="text-wordmark">
          Bali
        </p>
        <div className="flex flex-auto flex-col items-center justify-center gap-2 lg:pb-12">
          <div className="w-full max-w-60 lg:max-w-125">
            <SessionRingArt />
          </div>
          <p className="text-center text-page-title text-balance lg:text-tagline">
            Quiet until the bell.
          </p>
        </div>
      </div>
      <div className="flex min-w-0 flex-1 flex-col items-center justify-center gap-5 px-6 pt-8 pb-10 lg:flex-[1_1_480px] lg:pt-12 lg:pb-12">
        <section
          aria-labelledby="sign-in-title"
          className="flex w-full max-w-100 flex-col gap-3.5 rounded-sign-in border border-border-default bg-surface-card px-8 py-9 shadow-sign-in"
        >
          <h1 id="sign-in-title" className="text-h1">
            Sign in to Bali
          </h1>
          <p className="mb-2.5 text-body text-text-secondary">
            Teachers and students sign in here to see their classes.
          </p>
          {left ? (
            <p role="status" className="text-body text-pretty">
              {SIGNED_OUT[left]}
            </p>
          ) : null}
          <Button size="pill" onClick={onSignIn} className="w-full">
            Sign in
          </Button>
          {error ? (
            <p role="alert" className="text-body text-pretty">
              {error}
            </p>
          ) : null}
        </section>
        <p className="max-w-100 text-center text-caption text-text-tertiary">
          Students: set up Bali in the app on your iPhone first.
        </p>
        {/* The public pages, under the card: the card keeps to signing in. */}
        <nav aria-label="Help and policies">
          <ul className="flex flex-wrap justify-center gap-x-4.5 gap-y-1.5 text-caption">
            {PUBLIC_PAGES.map((page) => (
              <li key={page.href}>
                <TextLink href={page.href}>{page.label}</TextLink>
              </li>
            ))}
          </ul>
        </nav>
      </div>
    </main>
  );
}
