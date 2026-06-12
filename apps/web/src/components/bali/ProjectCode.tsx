'use client';

import { useEffect } from 'react';
import { Monitor, X } from 'lucide-react';
import { JoinCodeBadge } from './bits';
import { ICON_STROKE } from './icons';

/** W5/W3 "Project this": the join code at projector size (88px mono) filling the
 *  screen — readable from the back row. Esc, click, or the close button dismisses. */
export function ProjectCodeOverlay({
  code,
  className,
  onClose,
}: {
  code: string;
  className?: string | null;
  onClose: () => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`Join code ${code.split('').join(' ')}`}
      className="fixed inset-0 z-50 flex cursor-pointer flex-col items-center justify-center gap-9 bg-surface-page"
      onClick={onClose}
    >
      {className ? (
        <div className="text-[28px] font-semibold leading-9 text-ink-secondary">{className}</div>
      ) : null}
      <JoinCodeBadge code={code} size="proj" />
      <div className="text-[19px] leading-7 text-ink-secondary">
        Join from the Bali iOS app with this code
      </div>
      <button
        type="button"
        aria-label="Close"
        onClick={onClose}
        className="absolute right-7 top-7 flex h-11 w-11 items-center justify-center rounded-full border border-line-strong bg-surface-card text-ink-secondary hover:bg-surface-sunken"
      >
        <X size={20} strokeWidth={ICON_STROKE} />
      </button>
    </div>
  );
}

/** The button that opens it — identical chrome on W3's created state and W5's card. */
export function ProjectThisButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex items-center gap-1.5 rounded-sm border border-line-strong bg-surface-card px-3.5 py-[7px] text-[13px] font-semibold leading-[18px] hover:bg-surface-sunken"
    >
      <Monitor size={14} strokeWidth={ICON_STROKE} />
      Project this
    </button>
  );
}
