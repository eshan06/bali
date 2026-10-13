import type { ComponentProps } from 'react';

/**
 * The portal's buttons in v2's look (DESIGN.md §1 and §4): 40 px tall at `radius-sm`, 10 px
 * corners, with 18 px side padding and a 15/20 semibold label on one line, the focus ring from
 * globals.css, each with a 1 px edge, so a label is one width whatever the look. Primary is the
 * brand's fill; secondary the card colour with a strong stroke, sunken while hovered or pressed,
 * and pressed (`aria-pressed`, Present) or open (`aria-expanded`) as a sunken fill with a
 * `text-primary` edge, never by colour alone; destructive only for removing a student or deleting
 * a class (its tokens name no hover shade, so it has none). Dimmed to 55 %, as v2.css draws it,
 * while disabled, or while busy but kept focusable with `aria-disabled`. Small (PV6, the class
 * page's Reports, Copy and New code) is 34 px tall, 14 px in, its label 13.5/18.
 */
const VARIANTS = {
  primary:
    'border border-transparent bg-action-primary-bg text-action-primary-fg hover:bg-action-primary-bg-hover active:bg-action-primary-bg-hover',
  secondary:
    'border border-border-strong bg-surface-card text-text-primary hover:bg-surface-sunken active:bg-surface-sunken aria-expanded:border-text-primary aria-expanded:bg-surface-sunken aria-pressed:border-text-primary aria-pressed:bg-surface-sunken',
  destructive: 'border border-transparent bg-action-destructive-bg text-action-destructive-fg',
};

const SIZES = { md: 'h-10 px-4.5 text-button', sm: 'h-8.5 px-3.5 text-button-sm' };

type Variant = keyof typeof VARIANTS;
type Size = keyof typeof SIZES;

/** A button's look, for a link that leads somewhere as a button would (the callback's way back). */
export function buttonClass(
  variant: Variant = 'primary',
  className = '',
  size: Size = 'md',
): string {
  return `inline-flex ${SIZES[size]} cursor-pointer items-center justify-center gap-2 rounded-sm whitespace-nowrap transition-colors disabled:cursor-default disabled:opacity-55 aria-disabled:cursor-default aria-disabled:opacity-55 motion-reduce:transition-none ${VARIANTS[variant]} ${className}`;
}

/** A button's own props, its `ref` included (React 19 passes it as one), so focus can come back. */
export type ButtonProps = ComponentProps<'button'> & { variant?: Variant; size?: Size };

export function Button({
  variant = 'primary',
  size = 'md',
  className = '',
  ...props
}: ButtonProps) {
  return <button type="button" {...props} className={buttonClass(variant, className, size)} />;
}
