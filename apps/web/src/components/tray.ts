/*
 * Cards in a soft tray (DESIGN.md §1 and §4, Card and tray), Soft premium's shape for a list: the
 * tray `surface-sunken` at `radius-lg` with a `space-2` inset, each card in it `surface-card` at
 * `radius-md` with `space-4` padding and `shadow-1`, and in dark, where `shadow-1` is none, a
 * `border-default` hairline for its edge.
 */
export const TRAY = 'grid gap-2 rounded-lg bg-surface-sunken p-2';

export const CARD =
  'rounded-md border border-transparent bg-surface-card p-4 shadow-1 dark:border-border-default';

/**
 * A tray with nothing in it yet: what will go there, said in the middle of where its cards will
 * sit, so it never reads as a field; its edge a hairline in dark, where the sunken colour barely
 * shows on the page.
 */
export const EMPTY_TRAY =
  'rounded-lg border border-transparent bg-surface-sunken px-6 py-8 text-center text-text-secondary dark:border-border-default';
