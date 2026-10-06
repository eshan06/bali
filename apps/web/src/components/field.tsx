import type { ComponentProps } from 'react';

/**
 * A text field (DESIGN.md §4, Inputs): its label above, the input a `surface-sunken` well at
 * `radius-sm` with a hairline edge, its help below in `caption`, the focus ring from globals.css.
 * `mono` sets what is typed in the code style (§3), for a code read symbol by symbol. A refusal
 * sets `aria-invalid`, which draws the edge in `text-primary`, never red; its words are the
 * page's, said after the help, and reach the input through `aria-describedby`, beside the help.
 */
export type FieldProps = Omit<ComponentProps<'input'>, 'className'> & {
  id: string;
  label: string;
  help?: string;
  mono?: boolean;
};

export function Field({
  id,
  label,
  help,
  mono = false,
  'aria-describedby': describedBy,
  ...props
}: FieldProps) {
  const helpId = `${id}-help`;
  const describes = [help ? helpId : null, describedBy].filter(Boolean).join(' ');
  return (
    <div>
      <label htmlFor={id} className="block text-body font-medium">
        {label}
      </label>
      <input
        id={id}
        {...props}
        aria-describedby={describes || undefined}
        className={`mt-2 block h-10 w-full rounded-sm border border-border-default bg-surface-sunken px-3 text-text-primary aria-[invalid=true]:border-text-primary ${mono ? 'font-mono text-code' : 'text-body'}`}
      />
      {help ? (
        <p id={helpId} className="mt-2 text-caption text-text-tertiary">
          {help}
        </p>
      ) : null}
    </div>
  );
}
