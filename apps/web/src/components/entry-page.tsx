import type { ReactNode } from 'react';

import { Mark } from './mark';

/**
 * An entry page in v2's look (v2.css's stage: SignIn, Invite, AuthCallback): one column 400 px
 * wide at most, its parts 6 px apart, centred in the window. Signed out (/login, the callback), the
 * brand opens it: the mark at 40 px, Bali, and its line. Signed in (the invite page), the shell's
 * bar with Sign out is above it (`PortalBar`, 60 px with its hairline), so it fills the window less
 * the bar and no more, or an empty page would scroll: where SignIn draws the stage as the board's
 * root, v2.css adds its 120 px of padding to the window's height, which a page would scroll by. The
 * window is the one that shows (`dvh`, as the layout's body is): `vh` on iPhone Safari is the
 * window behind its toolbars, taller than what shows. Signed out, it is the page's `<main>`; signed
 * in, it sits in the shell's (`PagePlace`), the page's one.
 */
export function EntryPage({
  signedIn = false,
  children,
}: {
  signedIn?: boolean;
  children: ReactNode;
}) {
  const Root = signedIn ? 'div' : 'main';
  return (
    <Root
      className={`flex flex-col items-center justify-center px-6 pt-12 pb-18 ${signedIn ? 'min-h-[calc(100dvh-60px)]' : 'min-h-dvh'}`}
    >
      <div className="flex w-full max-w-100 flex-col items-center gap-1.5">
        {signedIn ? null : (
          <>
            <Mark size={40} />
            <p translate="no" className="text-h2">
              Bali
            </p>
            <p className="mb-5.5 text-data font-normal text-text-secondary">
              Focus sessions for your classroom
            </p>
          </>
        )}
        {children}
      </div>
    </Root>
  );
}

/**
 * A line under an entry page's card (v2.css's `.stage-foot`): 13.5/19, centred, secondary, 6 px
 * under it as the boards render it (v2.css's `.app p` outranks the foot's own 14 px).
 */
export const STAGE_FOOT = 'w-full text-center text-meta text-text-secondary';
