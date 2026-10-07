import type { ReactNode } from 'react';

import { LockupBar } from './mark';

/**
 * An entry page (the approved Entry & info design): one card on its own, 440 px wide at most,
 * centred in the window under a bar, and on a phone at the top. Signed out (/login, the
 * callback), the lockup's bar opens it. Signed in (the invite code), the layout's Sign out bar is
 * above it, 56 px and its hairline (`PortalBar`), so it fills the window less those 57 px. The
 * window is the one that shows (`dvh`, as the layout's body is): `vh` on iPhone Safari is the
 * window behind its toolbars, taller than what shows.
 */
export function EntryPage({
  signedIn = false,
  children,
}: {
  signedIn?: boolean;
  children: ReactNode;
}) {
  const main = (
    <main
      className={`flex flex-col items-center px-4 pt-10 pb-12 sm:justify-center sm:px-10 sm:pt-8 sm:pb-24 ${signedIn ? 'min-h-[calc(100dvh-57px)]' : 'flex-1'}`}
    >
      <div className="w-full max-w-110">{children}</div>
    </main>
  );
  if (signedIn) return main;
  return (
    <div className="flex min-h-dvh flex-col">
      <LockupBar />
      {main}
    </div>
  );
}
