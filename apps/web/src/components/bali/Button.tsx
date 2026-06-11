'use client';

import clsx from 'clsx';
import { forwardRef } from 'react';

type Variant = 'primary' | 'secondary' | 'ghost' | 'destructive' | 'quiet-destructive';

const VARIANTS: Record<Variant, string> = {
  primary: 'bg-green-700 text-white hover:bg-green-800 active:bg-green-900 border-transparent',
  secondary: 'bg-surface-card text-ink-primary border-line-strong hover:bg-surface-sunken active:bg-stone-200',
  ghost: 'bg-transparent text-ink-brand border-transparent hover:bg-surface-sunken',
  /** red-600 slab — confirms before acting; used only for true destruction */
  destructive: 'bg-red-600 text-white border-transparent hover:bg-red-700',
  /** "End session…" style: secondary chrome, red text */
  'quiet-destructive': 'bg-surface-card text-red-600 border-line-strong hover:bg-surface-sunken',
};

export const Button = forwardRef<
  HTMLButtonElement,
  React.ButtonHTMLAttributes<HTMLButtonElement> & {
    variant?: Variant;
    size?: 'md' | 'sm' | 'lg';
    loading?: boolean;
  }
>(function Button({ variant = 'primary', size = 'md', loading = false, className, children, ...rest }, ref) {
  return (
    <button
      ref={ref}
      className={clsx(
        'relative inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-sm border font-semibold',
        'transition-colors duration-fast ease-standard disabled:pointer-events-none disabled:opacity-45',
        size === 'md' && 'px-[18px] py-[9px] text-[15px] leading-5',
        size === 'sm' && 'px-3.5 py-[7px] text-[13px] leading-[18px]',
        size === 'lg' && 'w-full rounded-md px-6 py-3.5 text-[17px] leading-[22px]',
        VARIANTS[variant],
        loading && 'pointer-events-none',
        className,
      )}
      {...rest}
    >
      <span className={clsx('inline-flex items-center gap-2', loading && 'invisible')}>{children}</span>
      {loading ? (
        <span
          aria-hidden
          className="absolute h-4 w-4 animate-spin rounded-full border-2 border-white/35 border-t-white motion-reduce:animate-none"
        />
      ) : null}
    </button>
  );
});

export function Label({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={clsx('text-[11.5px] font-semibold uppercase leading-[15px] tracking-[0.05em] text-ink-tertiary', className)}>
      {children}
    </div>
  );
}

export const Input = forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement> & { error?: boolean }>(
  function Input({ className, error, ...rest }, ref) {
    return (
      <input
        ref={ref}
        className={clsx(
          'w-full rounded-sm border bg-surface-card px-3 py-[9px] text-[15px] leading-5 text-ink-primary placeholder:text-ink-tertiary',
          error ? 'border-red-500' : 'border-line-strong focus-visible:border-[var(--focus-ring-color)]',
          className,
        )}
        {...rest}
      />
    );
  },
);

export function FieldError({ children }: { children: React.ReactNode }) {
  return <div className="mt-1.5 text-[13px] leading-[18px] text-red-600">{children}</div>;
}

/** 48×29 toggle per spec; locked-on variant renders at 50% + disabled. */
export function Toggle({
  on,
  onChange,
  disabled = false,
  lockedOn = false,
  ariaLabel,
}: {
  on: boolean;
  onChange?: (next: boolean) => void;
  disabled?: boolean;
  lockedOn?: boolean;
  ariaLabel: string;
}) {
  const isOn = lockedOn || on;
  return (
    <button
      type="button"
      role="switch"
      aria-checked={isOn}
      aria-label={ariaLabel}
      disabled={disabled || lockedOn}
      onClick={() => onChange?.(!on)}
      className={clsx(
        'relative h-[29px] w-12 flex-none rounded-full transition-colors duration-base ease-standard',
        isOn ? 'bg-green-600' : 'bg-stone-300',
        (disabled || lockedOn) && 'opacity-50',
      )}
    >
      <span
        className={clsx(
          'absolute top-[2.5px] h-6 w-6 rounded-full bg-white shadow-[0_1px_3px_rgba(0,0,0,0.25)] transition-[left] duration-base ease-standard',
          isOn ? 'left-[21.5px]' : 'left-[2.5px]',
        )}
      />
    </button>
  );
}

/** Segmented control (GrantPassForm presets). */
export function Segmented<T extends string>({
  options,
  value,
  onChange,
}: {
  options: Array<{ value: T; label: string }>;
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <div className="flex rounded-sm bg-surface-sunken p-[3px] gap-0.5">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          onClick={() => onChange(o.value)}
          className={clsx(
            'flex-1 rounded-lg px-4 py-[7px] text-[14px] font-semibold leading-[18px] transition-colors duration-fast',
            o.value === value ? 'bg-surface-card text-ink-primary shadow-1' : 'text-ink-secondary',
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
