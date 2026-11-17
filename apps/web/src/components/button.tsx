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
 * page's Reports, Copy and New code) is 34 px tall, 14 px in, its label 13.5/18; large (PV15, the
 * sign-in callback's Back to sign in) 48 px tall, its label 16/20; the pill (the sign-in redesign,
 * 2026-11-12: the sign-in page's Sign in) 52 px tall and round, 24 px in, its label 16/20.
 */
const VARIANTS = {
  primary:
    'border border-transparent bg-action-primary-bg text-action-primary-fg hover:bg-action-primary-bg-hover active:bg-action-primary-bg-hover',
  secondary:
    'border border-border-strong bg-surface-card text-text-primary hover:bg-surface-sunken active:bg-surface-sunken aria-expanded:border-text-primary aria-expanded:bg-surface-sunken aria-pressed:border-text-primary aria-pressed:bg-surface-sunken',
  destructive: 'border border-transparent bg-action-destructive-bg text-action-destructive-fg',
};

const SIZES = {
  md: 'h-10 rounded-sm px-4.5 text-button',
  sm: 'h-8.5 rounded-sm px-3.5 text-button-sm',
  lg: 'h-12 rounded-sm px-4.5 text-button-lg',
  pill: 'h-13 rounded-full px-6 text-button-lg',
};

type Variant = keyof typeof VARIANTS;
type Size = keyof typeof SIZES;

/** A button's look, for a link that leads somewhere as a button would (the callback's way back). */
export function buttonClass(
  variant: Variant = 'primary',
  className = '',
  size: Size = 'md',
): string {
  return `inline-flex ${SIZES[size]} cursor-pointer items-center justify-center gap-2 whitespace-nowrap transition-colors disabled:cursor-default disabled:opacity-55 aria-disabled:cursor-default aria-disabled:opacity-55 motion-reduce:transition-none ${VARIANTS[variant]} ${className}`;
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

/**
 * The lock-only look's buttons (DESIGN.md §1, The lock-only look; LO2), for the pages rebuilt from
 * its canvas, beside v2's, which the rest keep: v2's heights, corners and labels, 16 px in, and a
 * press that scales (`press`); small, 12 px in, its hit area 44 px tall. Primary is the brand's
 * fill; secondary white with the strong edge, grey on hover, and pressed (`aria-pressed`) grey with a
 * primary-ink edge, never by colour alone; an open one (`aria-expanded`) looks as at rest, as Add
 * students and Key are drawn. Held (disabled, or busy and kept focusable with `aria-disabled`),
 * dimmed to 55 %, its cursor not allowed.
 */
const LOCK_VARIANTS = {
  primary:
    'border border-transparent bg-action-primary-bg text-action-primary-fg hover:bg-action-primary-bg-hover',
  secondary:
    'border border-border-strong bg-surface-card text-text-primary hover:bg-surface-sunken aria-pressed:border-text-primary aria-pressed:bg-surface-sunken',
  destructive: VARIANTS.destructive,
};
const LOCK_SIZES = {
  md: 'h-10 px-4 text-button',
  sm: 'h-8.5 px-3 text-button-sm after:absolute after:inset-x-0 after:-inset-y-1.25',
};

export function lockButton(
  variant: Variant = 'primary',
  size: keyof typeof LOCK_SIZES = 'md',
  className = '',
): string {
  return `relative inline-flex ${LOCK_SIZES[size]} cursor-pointer items-center justify-center gap-2 rounded-sm whitespace-nowrap press disabled:cursor-not-allowed disabled:opacity-55 aria-disabled:cursor-not-allowed aria-disabled:opacity-55 ${LOCK_VARIANTS[variant]} ${className}`;
}

export function LockButton({
  variant = 'primary',
  size = 'md',
  className = '',
  ...props
}: ComponentProps<'button'> & { variant?: Variant; size?: keyof typeof LOCK_SIZES }) {
  return <button type="button" {...props} className={lockButton(variant, size, className)} />;
}

/**
 * The lock-only look's icon button (lock.css's `.icon-btn`: Sign out, the menu, a pop-up's
 * Close): 32 px, 8 px corners, the secondary ink, grey and the primary ink on hover, pressed to
 * 0.94, its hit area 44 px; its words its `aria-label`.
 */
export const ICON_BUTTON =
  'relative inline-grid size-8 shrink-0 cursor-pointer place-items-center rounded-item text-text-secondary press [--press-scale:0.94] after:absolute after:-inset-1.5 hover:bg-surface-sunken hover:text-text-primary aria-disabled:cursor-not-allowed aria-disabled:opacity-55';

/**
 * The lock-only look's text on its own: `QUIET`, a link or a button in the brand's ink at 13.5/19
 * semibold (Open, Open the report, Show names); `NAME_BUTTON`, a student's name that opens their
 * record, semibold in the primary ink. Each underlined on hover.
 */
export const QUIET =
  'cursor-pointer rounded-xs text-meta font-semibold whitespace-nowrap text-text-brand underline-offset-3 hover:underline';
export const NAME_BUTTON =
  'cursor-pointer rounded-xs text-left font-semibold text-text-primary underline-offset-3 hover:underline';
