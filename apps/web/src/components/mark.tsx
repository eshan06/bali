/**
 * The mark (DESIGN.md §4): the session arc as emblem, a green-200 track ring and a green-600 arc
 * open at the upper left, never recoloured and never closed; the same geometry as the icon's
 * (public/icon.svg), without its tile. Decorative beside the word "Bali", so hidden from readers.
 */
export function Mark({ size = 24 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden="true" className="shrink-0">
      <circle cx="32" cy="32" r="24" fill="none" stroke="var(--bali-green-200)" strokeWidth="10" />
      <path
        d="M26.6 8.61A24 24 0 1 1 8.61 26.6"
        fill="none"
        stroke="var(--bali-green-600)"
        strokeWidth="10"
        strokeLinecap="round"
      />
    </svg>
  );
}

/**
 * v2's bar over a page with no side menu (v2.css's `.topbar`: Help, the policy pages and the
 * invite page): white, 60 px tall with its hairline, Bali 32 px in, 16 on a phone, and whatever
 * the page holds at its other end.
 */
export const TOP_BAR =
  'flex h-15 shrink-0 items-center justify-between gap-4 border-b border-border-default bg-surface-card px-8 max-sm:px-4';

/** The lockup in that bar: the mark at 20 px, 9 px from Bali at 16/22 semibold. */
export const LOCKUP = 'flex items-center gap-2.25 text-lockup';

/** The bar over a page read without signing in (Help, the policy pages): the lockup alone. */
export function LockupBar() {
  return (
    <header className={TOP_BAR}>
      <p translate="no" className={LOCKUP}>
        <Mark size={20} />
        Bali
      </p>
    </header>
  );
}
