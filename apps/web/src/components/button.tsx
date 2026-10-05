import type { ButtonHTMLAttributes } from 'react';

/**
 * The portal's buttons (DESIGN.md §4): a pill 40 px tall with space-4 side padding and a body
 * semibold label, the focus ring from globals.css. Primary is the brand's fill; secondary the
 * card colour with a strong stroke, sunken while hovered or pressed; destructive only for
 * removing a student or deleting a class (its tokens name no hover shade, so it has none). Dimmed
 * to 60 % while disabled, or while busy but kept focusable with `aria-disabled`.
 */
const VARIANTS = {
  primary: 'bg-action-primary-bg text-action-primary-fg hover:bg-action-primary-bg-hover',
  secondary:
    'border border-border-strong bg-surface-card text-text-primary hover:bg-surface-sunken active:bg-surface-sunken',
  destructive: 'bg-action-destructive-bg text-action-destructive-fg',
};

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: keyof typeof VARIANTS;
};

export function Button({ variant = 'primary', className = '', ...props }: ButtonProps) {
  return (
    <button
      type="button"
      {...props}
      className={`inline-flex h-10 cursor-pointer items-center justify-center gap-2 rounded-full px-4 text-body font-semibold transition-colors disabled:cursor-default disabled:opacity-60 aria-disabled:cursor-default aria-disabled:opacity-60 motion-reduce:transition-none ${VARIANTS[variant]} ${className}`}
    />
  );
}
