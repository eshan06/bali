'use client';

import clsx from 'clsx';

/** iPhone chrome for the walkthrough — ported from the design handoff's
 *  `pass3/ios-frame.jsx` (IOSDevice) into a real component. Draws the bezel,
 *  Dynamic Island, status bar and home indicator so screen recreations only ever
 *  have to render their own content.
 *
 *  Logical size is a fixed 390×844 (iPhone 14/15/16 Pro points); `scale` shrinks
 *  it for narrow viewports without touching any inner measurement, so every
 *  screen can be written at true iOS point values. */

const W = 390;
const H = 844;
/** Status bar + island occupy the top; the home indicator the bottom. */
export const SAFE_TOP = 59;
export const SAFE_BOTTOM = 34;

function StatusBar({ dark, time }: { dark: boolean; time: string }) {
  const c = dark ? '#fff' : '#000';
  return (
    <div className="demo-ios-status" aria-hidden="true">
      <span className="demo-ios-status-time" style={{ color: c }}>
        {time}
      </span>
      <span className="demo-ios-status-icons">
        <svg width="19" height="12" viewBox="0 0 19 12">
          <rect x="0" y="7.5" width="3.2" height="4.5" rx="0.7" fill={c} />
          <rect x="4.8" y="5" width="3.2" height="7" rx="0.7" fill={c} />
          <rect x="9.6" y="2.5" width="3.2" height="9.5" rx="0.7" fill={c} />
          <rect x="14.4" y="0" width="3.2" height="12" rx="0.7" fill={c} />
        </svg>
        <svg width="17" height="12" viewBox="0 0 17 12">
          <path
            d="M8.5 3.2C10.8 3.2 12.9 4.1 14.4 5.6L15.5 4.5C13.7 2.7 11.2 1.5 8.5 1.5C5.8 1.5 3.3 2.7 1.5 4.5L2.6 5.6C4.1 4.1 6.2 3.2 8.5 3.2Z"
            fill={c}
          />
          <path
            d="M8.5 6.8C9.9 6.8 11.1 7.3 12 8.2L13.1 7.1C11.8 5.9 10.2 5.1 8.5 5.1C6.8 5.1 5.2 5.9 3.9 7.1L5 8.2C5.9 7.3 7.1 6.8 8.5 6.8Z"
            fill={c}
          />
          <circle cx="8.5" cy="10.5" r="1.5" fill={c} />
        </svg>
        <svg width="27" height="13" viewBox="0 0 27 13">
          <rect x="0.5" y="0.5" width="23" height="12" rx="3.5" stroke={c} strokeOpacity="0.35" fill="none" />
          <rect x="2" y="2" width="20" height="9" rx="2" fill={c} />
          <path d="M25 4.5V8.5C25.8 8.2 26.5 7.2 26.5 6.5C26.5 5.8 25.8 4.8 25 4.5Z" fill={c} fillOpacity="0.4" />
        </svg>
      </span>
    </div>
  );
}

export function IOSFrame({
  children,
  dark = false,
  time = '9:55',
  scale = 1,
  label,
  className,
  screenClassName,
}: {
  children: React.ReactNode;
  /** Student surfaces are dark-first; teacher surfaces are light. */
  dark?: boolean;
  time?: string;
  scale?: number;
  /** Accessible name for the whole device, e.g. "Student iPhone — focus active". */
  label?: string;
  className?: string;
  screenClassName?: string;
}) {
  return (
    <div
      className={clsx('demo-phone', className)}
      style={{ width: Math.round(W * scale), height: Math.round(H * scale) }}
      role="img"
      aria-label={label}
    >
      <div className="demo-phone-scale" style={{ width: W, height: H, transform: `scale(${scale})` }}>
        <div className="demo-phone-bezel">
          <div className={clsx('demo-phone-screen', dark ? 'demo-ios-dark' : 'demo-ios-light', screenClassName)}>
            <div className="demo-ios-island" aria-hidden="true" />
            <StatusBar dark={dark} time={time} />
            <div className="demo-phone-content">{children}</div>
            <div className="demo-ios-home" aria-hidden="true">
              <span style={{ background: dark ? 'rgba(255,255,255,0.7)' : 'rgba(0,0,0,0.25)' }} />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
