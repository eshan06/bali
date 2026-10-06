import type { ComponentProps } from 'react';

/**
 * The portal's buttons (DESIGN.md §4): a pill 40 px tall with space-4 side padding and a body
 * semibold label, the focus ring from globals.css, each with a 1 px edge, so a label is one width
 * whatever the look. Primary is the brand's fill; secondary the card colour with a strong stroke,
 * sunken while hovered or pressed, and pressed (`aria-pressed`, Present) or open
 * (`aria-expanded`, New code) as a sunken fill with a `text-primary` edge, never by colour alone;
 * destructive only for removing a student or deleting a class (its tokens name no hover shade, so
 * it has none). Dimmed to 60 % while disabled, or while busy but kept focusable with
 * `aria-disabled`.
 */
const VARIANTS = {
  primary:
    'border border-transparent bg-action-primary-bg text-action-primary-fg hover:bg-action-primary-bg-hover active:bg-action-primary-bg-hover',
  secondary:
    'border border-border-strong bg-surface-card text-text-primary hover:bg-surface-sunken active:bg-surface-sunken aria-expanded:border-text-primary aria-expanded:bg-surface-sunken aria-pressed:border-text-primary aria-pressed:bg-surface-sunken',
  destructive: 'border border-transparent bg-action-destructive-bg text-action-destructive-fg',
};

type Variant = keyof typeof VARIANTS;

/** A button's look, for a link that leads somewhere as a button would (the callback's way back). */
export function buttonClass(variant: Variant = 'primary', className = ''): string {
  return `inline-flex h-10 cursor-pointer items-center justify-center gap-2 rounded-full px-4 text-body font-semibold transition-colors disabled:cursor-default disabled:opacity-60 aria-disabled:cursor-default aria-disabled:opacity-60 motion-reduce:transition-none ${VARIANTS[variant]} ${className}`;
}

/** A button's own props, its `ref` included (React 19 passes it as one), so focus can come back. */
export type ButtonProps = ComponentProps<'button'> & { variant?: Variant };

export function Button({ variant = 'primary', className = '', ...props }: ButtonProps) {
  return <button type="button" {...props} className={buttonClass(variant, className)} />;
}
