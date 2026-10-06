import Link from 'next/link';
import type { ReactNode } from 'react';

/**
 * A link in the page's words (DESIGN.md §2, `text-brand`), underlined so it never rests on colour
 * alone; `TEXT_LINK` alone for a plain `<a>`, such as a mailto.
 */
export const TEXT_LINK =
  'rounded-xs font-medium text-text-brand underline underline-offset-2 hover:decoration-2';

/**
 * A link across the portal (DESIGN.md §4, Links): brand ink and semibold beside its 16 px arrow,
 * which carries it at rest, underlined on hover; back to the classes, on to reports, back to the
 * class.
 */
export const NAV_LINK =
  'inline-flex items-center gap-2 rounded-xs text-body font-semibold text-text-brand underline-offset-2 hover:underline';

export function TextLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link href={href} className={TEXT_LINK}>
      {children}
    </Link>
  );
}
