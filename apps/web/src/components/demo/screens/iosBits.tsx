'use client';

import clsx from 'clsx';
import { useEffect, useRef, useState } from 'react';

/** Shared pieces of the student app, rebuilt to the exact values in
 *  ios/Bali/Bali/Features/FocusActiveView.swift and JoinView.swift.
 *  Colours come from ios/Bali/BaliCore/Tokens.swift (Tokens.Dark.*). */

/** Hero countdown ring. FocusActiveView.swift: 244pt, 10pt stroke (12 in the
 *  final two minutes), round cap, rotated -90° so it starts at twelve o'clock. */
export function IOSArc({
  size = 244,
  pct,
  final2 = false,
  fill,
  children,
}: {
  size?: number;
  /** Fraction REMAINING (1 → full ring). */
  pct: number;
  final2?: boolean;
  fill?: string;
  children?: React.ReactNode;
}) {
  const stroke = final2 ? 12 : 10;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const clamped = Math.min(1, Math.max(0, pct));
  return (
    <div className="demo-arc" style={{ width: size, height: size }}>
      <svg width={size} height={size} style={{ transform: 'rotate(-90deg)' }} aria-hidden="true">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#2E2B27" strokeWidth={stroke} />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={fill ?? (final2 ? '#92C3A9' : '#62A483')}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={c * (1 - clamped)}
        />
      </svg>
      <div className="demo-arc-stack">{children}</div>
    </div>
  );
}

/** JoinView.swift:231 — verbatim, and the one line that states the full-focus
 *  model honestly. Never reword this without changing the app. */
export function FocusScopeRow() {
  return (
    <div className="demo-scoperow">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" aria-hidden="true">
        <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      <span>Full focus — every app pauses except the few you chose. Calls &amp; Messages always work.</span>
    </div>
  );
}

const IDLE_LABEL = 'Hold to unlock — your teacher will be notified';

/** EmergencyUnlockControl, FocusActiveView.swift:~260. Always visible, never
 *  disabled, never red. 1.0s linear fill in warm orange; releasing early springs
 *  back with no error and no punishment. Keyboard completes in one step. */
export function EmergencyUnlock({
  teacher,
  unlocked,
  onUnlock,
  height = 64,
}: {
  teacher: string;
  unlocked: boolean;
  onUnlock: () => void;
  height?: number;
}) {
  const [phase, setPhase] = useState<'idle' | 'filling' | 'springback'>('idle');
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  const start = (e: React.PointerEvent) => {
    if (unlocked) return;
    e.preventDefault();
    setPhase('filling');
    timer.current = setTimeout(() => {
      timer.current = null;
      setPhase('idle');
      onUnlock();
    }, 1000);
  };

  const cancel = () => {
    if (timer.current === null) return;
    clearTimeout(timer.current);
    timer.current = null;
    setPhase('springback');
  };

  const label = unlocked ? `Unlocked — ${teacher} was notified` : IDLE_LABEL;

  return (
    <div
      className={clsx(
        'demo-unlock',
        unlocked && 'is-unlocked',
        phase === 'filling' && 'is-filling',
        phase === 'springback' && 'is-springback',
      )}
      style={{ height }}
      role="button"
      tabIndex={0}
      aria-label="Emergency unlock. Hold for one second. Your teacher will be notified."
      onPointerDown={start}
      onPointerUp={cancel}
      onPointerLeave={cancel}
      onKeyDown={(e) => {
        if ((e.key === 'Enter' || e.key === ' ') && !unlocked) {
          e.preventDefault();
          onUnlock();
        }
      }}
    >
      <span className="demo-unlock-base">
        <UnlockGlyph unlocked={unlocked} />
        {label}
      </span>
      <span className="demo-unlock-fill" aria-hidden="true">
        <span className="demo-unlock-fill-label">
          <UnlockGlyph unlocked={false} />
          {IDLE_LABEL}
        </span>
      </span>
    </div>
  );
}

function UnlockGlyph({ unlocked }: { unlocked: boolean }) {
  return unlocked ? (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" aria-hidden="true">
      <path d="M20 6 9 17l-5-5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ) : (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" aria-hidden="true">
      <rect x="3" y="11" width="18" height="11" rx="2" />
      <path d="M7 11V7a5 5 0 0 1 9.9-1" strokeLinecap="round" />
    </svg>
  );
}
