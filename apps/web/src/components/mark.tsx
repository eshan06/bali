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
