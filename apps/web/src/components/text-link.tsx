import Link from 'next/link';
import type { ReactNode } from 'react';

/**
 * A link in the page's words (DESIGN.md §2, `text-brand`), underlined so it never rests on colour
 * alone; `TEXT_LINK` alone for a plain `<a>`, such as a mailto.
 */
export const TEXT_LINK =
  'rounded-xs font-medium text-text-brand underline underline-offset-2 hover:decoration-2';

/**
 * A link across the portal (DESIGN.md §4, Links), v2's `back`: 14/20 semibold in the brand's ink
 * beside its 16 px arrow, which carries it at rest, underlined on hover; a session's report back to
 * Reports (PV14, ReportOpened).
 */
export const NAV_LINK =
  'inline-flex items-center gap-1.5 rounded-xs text-data font-semibold text-text-brand underline-offset-2 hover:underline';

/** A link standing on its own in v2's look (DESIGN.md §4, Links): `quiet`, underlined on hover. */
export const QUIET_LINK =
  'rounded-xs text-caption font-semibold text-text-brand underline-offset-2 hover:underline';

export function TextLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link href={href} className={TEXT_LINK}>
      {children}
    </Link>
  );
}
