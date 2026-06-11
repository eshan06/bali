'use client';

import clsx from 'clsx';
import { useCallback, useRef, useState } from 'react';
import { X } from 'lucide-react';
import { ICON_STROKE, STATE_ICONS } from './icons';

export interface ToastItem {
  id: string;
  variant: 'emergency' | 'revoked' | 'info';
  title: string;
  sub: string | null;
  /** "Open student" → the page decides what that means. */
  action?: { label: string; onClick: () => void } | null;
}

/** Session-scoped toast stack. Emergency/revoked are sticky; info auto-dismisses (6s). */
export function useToasts() {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());

  const dismiss = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
    const timer = timers.current.get(id);
    if (timer) clearTimeout(timer);
    timers.current.delete(id);
  }, []);

  const push = useCallback(
    (toast: ToastItem) => {
      setToasts((prev) => {
        const existing = prev.find((t) => t.id === toast.id);
        // Emergency subs update in place when the reason arrives.
        if (existing) return prev.map((t) => (t.id === toast.id ? { ...t, ...toast } : t));
        return [toast, ...prev];
      });
      if (toast.variant === 'info') {
        const timer = setTimeout(() => dismiss(toast.id), 6_000);
        timers.current.set(toast.id, timer);
      }
    },
    [dismiss],
  );

  return { toasts, push, dismiss };
}

export function ToastCard({ toast, onDismiss }: { toast: ToastItem; onDismiss: () => void }) {
  const Icon =
    toast.variant === 'emergency'
      ? STATE_ICONS.emergency_unlocked
      : toast.variant === 'revoked'
        ? STATE_ICONS.revoked
        : STATE_ICONS.ended;
  return (
    <div
      role={toast.variant === 'info' ? 'status' : 'alert'}
      className={clsx(
        'toast-in grid w-[380px] grid-cols-[36px_1fr_auto] items-start gap-3 rounded-md border border-line bg-surface-card p-3.5 pl-4 shadow-3',
        toast.variant === 'emergency' && 'border-t-[3px] border-t-orange-400',
        toast.variant === 'revoked' && 'border-t-[3px] border-t-red-400',
      )}
    >
      <span
        className={clsx(
          'flex h-9 w-9 items-center justify-center rounded-sm',
          toast.variant === 'emergency' && 'bg-state-emergency-bg text-state-emergency-fg',
          toast.variant === 'revoked' && 'bg-state-revoked-bg text-state-revoked-fg',
          toast.variant === 'info' && 'bg-surface-sunken text-ink-secondary',
        )}
      >
        <Icon size={18} strokeWidth={ICON_STROKE} />
      </span>
      <div>
        <div className="text-[15px] font-semibold leading-5 text-ink-primary">{toast.title}</div>
        {toast.sub ? <div className="mt-0.5 text-[13px] leading-[18px] text-ink-secondary">{toast.sub}</div> : null}
        {toast.action ? (
          <div className="mt-2 flex gap-3.5">
            <button
              type="button"
              onClick={toast.action.onClick}
              className={clsx(
                'text-[13px] font-semibold leading-[18px]',
                toast.variant === 'emergency' ? 'text-orange-700' : 'text-ink-brand',
              )}
            >
              {toast.action.label}
            </button>
          </div>
        ) : null}
      </div>
      <button
        type="button"
        aria-label="Dismiss"
        onClick={onDismiss}
        className="rounded-md p-0.5 text-ink-tertiary hover:text-ink-secondary"
      >
        <X size={16} strokeWidth={ICON_STROKE} />
      </button>
    </div>
  );
}
