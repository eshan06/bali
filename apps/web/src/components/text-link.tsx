import Link from 'next/link';
import type { ReactNode } from 'react';

/**
 * A link in the page's words (DESIGN.md §2, `text-brand`), underlined so it never rests on colour
 * alone; `TEXT_LINK` alone for a plain `<a>`, such as a mailto.
 */
export const TEXT_LINK =
  'rounded-xs font-medium text-text-brand underline underline-offset-2 hover:decoration-2';

export function TextLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link href={href} className={TEXT_LINK}>
      {children}
    </Link>
  );
}
