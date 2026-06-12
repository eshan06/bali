'use client';

import clsx from 'clsx';
import { useState } from 'react';
import { Check, Copy } from 'lucide-react';
import { ICON_STROKE } from './icons';

/** JoinCodeBadge — mono, 600, letter-spaced, on sunken surface. */
export function JoinCodeBadge({
  code,
  size = 'card',
  className,
}: {
  code: string;
  size?: 'proj' | 'card' | 'row';
  className?: string;
}) {
  return (
    <span
      className={clsx(
        'inline-block rounded-md border border-line bg-surface-sunken font-mono font-semibold tracking-[0.16em] text-ink-primary',
        size === 'proj' && 'px-7 py-[18px] pl-[calc(28px+0.16em)] text-[88px] leading-[96px]',
        size === 'card' && 'px-7 py-[18px] pl-[calc(28px+0.16em)] text-[40px] leading-[48px]',
        size === 'row' && 'rounded-sm px-3.5 py-2 pl-[calc(14px+0.16em)] text-[22px] leading-7',
        className,
      )}
    >
      {code}
    </span>
  );
}

export function CopyButton({ text, label = 'Copy' }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={() => {
        void navigator.clipboard.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 1600);
      }}
      className="inline-flex items-center gap-1.5 rounded-sm border border-line-strong bg-surface-card px-3.5 py-[7px] text-[13px] font-semibold leading-[18px] text-ink-primary hover:bg-surface-sunken"
    >
      {copied ? <Check size={14} strokeWidth={ICON_STROKE} /> : <Copy size={14} strokeWidth={ICON_STROKE} />}
      {copied ? 'Copied' : label}
    </button>
  );
}

/** ReconnectingPill — honest staleness, non-blocking, pinned by the caller. */
export function ReconnectingPill({ className }: { className?: string }) {
  return (
    <span
      className={clsx(
        'inline-flex items-center gap-2 rounded-full border border-line-strong bg-surface-card px-3.5 py-1.5 text-[13px] font-medium leading-[18px] text-ink-secondary shadow-2',
        className,
      )}
      role="status"
    >
      <span className="pulse-dot h-[7px] w-[7px] rounded-full bg-orange-400 motion-reduce:animate-none" />
      Reconnecting — data may be 20s stale
    </span>
  );
}

export function Card({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={clsx('rounded-md border border-line bg-surface-card p-5', className)}>{children}</div>;
}

/** Flat filter pill (W8/W9): active = green-700 bg, white text. */
export function FilterChip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={clsx(
        'rounded-full border px-3.5 py-1.5 text-[13px] font-medium leading-[18px] transition-colors duration-fast',
        active
          ? 'border-transparent bg-green-700 text-white'
          : 'border-line bg-surface-card text-ink-secondary hover:bg-surface-sunken',
      )}
    >
      {children}
    </button>
  );
}
