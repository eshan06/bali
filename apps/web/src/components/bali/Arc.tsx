'use client';

/**
 * SessionCountdown ring (the one signature motif). SVG recipe per the spec:
 * track circle + rounded-cap dasharray fill rotated -90° so progress starts at 12.
 * Ticking updates swap dasharray with no transition (tabular text upstream).
 */
export function Arc({
  size,
  stroke,
  pct,
  final2 = false,
  fill,
  track = 'var(--arc-track)',
  children,
}: {
  size: number;
  stroke: number;
  /** Fraction REMAINING (1 → full ring). */
  pct: number;
  /** Final-2-minutes emphasis: thicker stroke, lighter fill — never red. */
  final2?: boolean;
  fill?: string;
  track?: string;
  children?: React.ReactNode;
}) {
  const sw = final2 ? stroke * 1.2 : stroke;
  const r = (size - sw) / 2;
  const c = 2 * Math.PI * r;
  const clamped = Math.min(1, Math.max(0, pct));
  return (
    <div
      className="relative inline-flex items-center justify-center"
      style={{ width: size, height: size }}
    >
      <svg width={size} height={size} className="block -rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={track} strokeWidth={sw} />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={fill ?? (final2 ? 'var(--arc-final2)' : 'var(--arc-fill)')}
          strokeWidth={sw}
          strokeLinecap="round"
          strokeDasharray={`${c * clamped} ${c * (1 - clamped)}`}
        />
      </svg>
      {children ? (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-0.5">{children}</div>
      ) : null}
    </div>
  );
}
