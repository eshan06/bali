/** The brand mark: circle track + ~270° rounded-cap arc from 12 o'clock. */
export function ArcMark({ size = 18 }: { size?: number }) {
  return (
    <svg viewBox="0 0 20 20" fill="none" style={{ width: size, height: size }} aria-hidden="true">
      <circle cx="10" cy="10" r="7.5" stroke="var(--stone-200)" strokeWidth="3" />
      <path
        d="M 10 2.5 A 7.5 7.5 0 1 1 3.5 13.75"
        stroke="var(--green-600)"
        strokeWidth="3"
        strokeLinecap="round"
      />
    </svg>
  );
}
