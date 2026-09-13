'use client';

import clsx from 'clsx';

/** Browser chrome for the dashboard scenes. Deliberately plain — a title bar, a
 *  URL pill, nothing that competes with the screen inside. The content is laid
 *  out at a fixed logical width so the real dashboard components (StatusChip,
 *  SummaryStrip, Arc) render at their true sizes, then scaled to fit. */

export function BrowserFrame({
  children,
  url = 'app.trybali.com/app/classes/algebra-ii/live',
  width = 1120,
  height = 700,
  scale = 1,
  label,
  className,
}: {
  children: React.ReactNode;
  url?: string;
  width?: number;
  height?: number;
  scale?: number;
  label?: string;
  className?: string;
}) {
  const CHROME = 44;
  return (
    <div
      className={clsx('demo-browser', className)}
      style={{ width: Math.round(width * scale), height: Math.round((height + CHROME) * scale) }}
      role="img"
      aria-label={label}
    >
      <div
        className="demo-browser-scale"
        style={{ width, height: height + CHROME, transform: `scale(${scale})` }}
      >
        <div className="demo-browser-bar" aria-hidden="true">
          <span className="demo-browser-dots">
            <i />
            <i />
            <i />
          </span>
          <span className="demo-browser-url">{url}</span>
        </div>
        <div className="demo-browser-viewport" style={{ height }}>
          {children}
        </div>
      </div>
    </div>
  );
}
