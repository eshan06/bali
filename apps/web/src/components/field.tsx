import type { ComponentProps, ReactNode } from 'react';

/**
 * A text field (DESIGN.md §4, Inputs): its label above, the input a `surface-sunken` well at
 * `radius-sm` with a `border-input` edge, 3:1 against the card, the page and the well (the owner's
 * ruling of 2026-10-06), its help below in `caption`, the focus ring from globals.css. What is
 * typed is the input size, 16 px (§3, the owner's ruling of 2026-10-05), so iPhone Safari never
 * zooms into the field when it is tapped: every portal input is this one. `mono` sets it in the
 * code style's face and weight (§3), for a code read symbol by symbol. `trailing`, the button that
 * acts on the field (the classes home's Create class), sits on the input's row and wraps under it
 * on a narrow form. A refusal sets `aria-invalid`, which draws the edge in `text-primary`, never
 * red; its words are the page's, said after the help, and reach the input through
 * `aria-describedby`, beside the help. `refusal` says them right under the input instead, before
 * the help, and sets `aria-invalid` itself: the invite code's refusal of the code (Entry & info).
 */
export type FieldProps = Omit<ComponentProps<'input'>, 'className'> & {
  id: string;
  label: string;
  help?: string;
  refusal?: string;
  mono?: boolean;
  trailing?: ReactNode;
};

export function Field({
  id,
  label,
  help,
  refusal,
  mono = false,
  trailing,
  'aria-describedby': describedBy,
  'aria-invalid': invalid,
  ...props
}: FieldProps) {
  const helpId = `${id}-help`;
  const refusalId = `${id}-refusal`;
  const describes = [help ? helpId : null, refusal ? refusalId : null, describedBy]
    .filter(Boolean)
    .join(' ');
  return (
    <div>
      <label htmlFor={id} className="block text-body font-medium">
        {label}
      </label>
      {/* One shape with or without `trailing`, so a button coming or going never remounts the
          input: with one, the input as wide as a name needs (280 to 440 px), the button beside. */}
      <div className={trailing ? 'mt-2 flex flex-wrap items-center gap-3' : 'mt-2'}>
        <div className={trailing ? 'max-w-110 min-w-0 grow basis-70' : undefined}>
          <input
            id={id}
            {...props}
            aria-invalid={refusal ? true : invalid}
            aria-describedby={describes || undefined}
            className={`block h-10 w-full rounded-sm border border-border-input bg-surface-sunken px-3 text-input text-text-primary aria-[invalid=true]:border-text-primary ${mono ? 'font-mono font-medium' : ''}`}
          />
        </div>
        {trailing}
      </div>
      {refusal ? (
        <p id={refusalId} role="alert" className="mt-2 text-body text-pretty">
          {refusal}
        </p>
      ) : null}
      {help ? (
        <p id={helpId} className="mt-2 text-caption text-text-tertiary">
          {help}
        </p>
      ) : null}
    </div>
  );
}
